#!/usr/bin/env node
/**
 * parse-meatco.js — Extract slaughter data from Meatco PDF statements
 * and output SQL INSERT statements for slaughter_reports + slaughter_line_items.
 *
 * Uses Python pdfplumber for reliable table extraction.
 *
 * Usage:  node scripts/parse-meatco.js
 *         node scripts/parse-meatco.js path/to/specific.pdf
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, '..', 'Data_Input');
const DEFAULT_FARM_ID = '00000000-0000-0000-0000-000000000001'; // placeholder

const PDF_FILES = [
  'Meatco_Slaughter Statement 03.2023.pdf',
  'Meatco_Slaughter Statement 05.2023.pdf',
  'Meatco_Slaughter Statement 12.2023.pdf',
];

// ---------------------------------------------------------------------------
// Python helper — extracts structured JSON from a Meatco PDF via pdfplumber
// ---------------------------------------------------------------------------
function extractPdfData(pdfPath) {
  const pyScript = `
import json, sys, re
import pdfplumber

pdf_path = sys.argv[1]
pdf = pdfplumber.open(pdf_path)

result = {
    "header": {},
    "line_items": [],
    "deductions_total": 0,
    "vat": 0,
    "total_proceeds": 0,
    "sub_total": 0,
    "payment_amount": 0,
}

# ── Page 1: Header + line items ──────────────────────────────────────────
page1_text = pdf.pages[0].extract_text()
lines = page1_text.split("\\n")

def find_val(pattern, text, group=1):
    m = re.search(pattern, text)
    return m.group(group).strip() if m else None

header_block = "\\n".join(lines[:10])

result["header"]["statement_number"] = find_val(r"Statement Number\\s*:\\s*(\\S+)", header_block)
result["header"]["advice_no"]        = find_val(r"Advice No\\.\\s*:\\s*(\\S+)", header_block)
result["header"]["lot_no"]           = find_val(r"Lot No\\.\\s*:\\s*(\\S+)", header_block)

# Date: Invoice / Slaughter Date
slaughter_date = find_val(r"Invoice\\s*/\\s*Slaughter\\s*Date\\s*:\\s*(\\d{2}/\\d{2}/\\d{4})", header_block)
if slaughter_date:
    dd, mm, yyyy = slaughter_date.split("/")
    result["header"]["report_date"] = f"{yyyy}-{mm}-{dd}"

settlement_date = find_val(r"Settlement\\s*Date\\s*:\\s*(\\d{2}/\\d{2}/\\d{4})", header_block)
if settlement_date:
    dd, mm, yyyy = settlement_date.split("/")
    result["header"]["settlement_date"] = f"{yyyy}-{mm}-{dd}"

date_received = find_val(r"Date\\s*Received\\s*:\\s*(\\d{2}/\\d{2}/\\d{4})", header_block)
if date_received:
    dd, mm, yyyy = date_received.split("/")
    result["header"]["date_received"] = f"{yyyy}-{mm}-{dd}"

qty_received = find_val(r"Qty Received\\s*:\\s*(\\d+)", header_block)
result["header"]["qty_received"] = int(qty_received) if qty_received else None

qty_slaughtered = find_val(r"Qty Slaughtered\\s*:\\s*(\\d+)", header_block)
result["header"]["qty_slaughtered"] = int(qty_slaughtered) if qty_slaughtered else None

agreement = find_val(r"Agreement:\\s*(.+?)$", header_block, 1)
if agreement:
    result["header"]["agreement"] = agreement.strip()

# Extract pricing table from page 1
table = pdf.pages[0].extract_tables()[0]
# Find header row
header_row_idx = None
for i, row in enumerate(table):
    if row and row[0] and "Serial" in str(row[0]):
        header_row_idx = i
        break

if header_row_idx is not None:
    for row in table[header_row_idx + 1:]:
        if not row or not row[0]:
            continue
        serial = str(row[0]).strip()
        if not serial or serial.startswith("Sub") or serial.startswith("Pricing"):
            continue
        try:
            ear_tag    = str(row[1]).strip()
            grade      = str(row[3]).strip()
            gender     = str(row[4]).strip()
            cold_mass  = float(str(row[5]).strip())
            ann_price  = float(str(row[6]).strip())
            bruising   = float(str(row[7]).strip())
            condemn    = float(str(row[8]).strip())
            offal      = float(str(row[9]).strip())
            hide       = float(str(row[10]).strip())
            gross_ppkg = float(str(row[12]).strip())
            gross_proc = float(str(row[13]).strip().replace(",", ""))

            result["line_items"].append({
                "serial": int(serial),
                "ear_tag_id": ear_tag,
                "grade": grade,
                "gender": gender,
                "cold_mass_kg": cold_mass,
                "announced_price_per_kg": ann_price,
                "bruising_deduction_nad": bruising,
                "condemnation_deduction_nad": condemn,
                "offal_value_nad": offal,
                "hide_value_nad": hide,
                "gross_price_per_kg": gross_ppkg,
                "gross_proceeds_nad": gross_proc,
            })
        except (ValueError, IndexError) as e:
            sys.stderr.write(f"WARN: skipping row {row}: {e}\\n")

# ── Page 2: Totals ───────────────────────────────────────────────────────
page2_text = pdf.pages[1].extract_text()

sub_total = find_val(r"Sub\\s*Total\\s*:\\s*([\\d,]+\\.\\d+)", page2_text)
if sub_total:
    result["sub_total"] = float(sub_total.replace(",", ""))

vat = find_val(r"V\\.A\\.T\\.\\s*:\\s*([\\d,]+\\.\\d+)", page2_text)
if vat:
    result["vat"] = float(vat.replace(",", ""))

total_proceeds = find_val(r"Total\\s*Proceeds\\s*:\\s*([\\d,]+\\.\\d+)", page2_text)
if total_proceeds:
    result["total_proceeds"] = float(total_proceeds.replace(",", ""))

# ── Last page: Deductions ────────────────────────────────────────────────
last_page_text = pdf.pages[-1].extract_text()

deductions = find_val(r"Deductions\\s*\\(Incl\\s*VAT\\)\\s*-?([\\d,]+\\.\\d+)", last_page_text)
if deductions:
    result["deductions_total"] = float(deductions.replace(",", ""))

payment = find_val(r"Payment\\s*Amount\\s*\\(Incl\\s*VAT\\)\\s*([\\d,]+\\.\\d+)", last_page_text)
if payment:
    result["payment_amount"] = float(payment.replace(",", ""))

# Also extract deduction line items from the invoice table on last page
deduction_table = None
for t in pdf.pages[-1].extract_tables():
    if t and t[0] and t[0][0] and "Description" in str(t[0][0]):
        deduction_table = t
        break

result["deduction_items"] = []
if deduction_table:
    for row in deduction_table[1:]:
        if not row or not row[0]:
            continue
        desc = str(row[0]).strip()
        if desc == "Invoice Total":
            continue
        try:
            amount = float(str(row[6]).strip().replace(",", "")) if row[6] else 0
            vat_amt = float(str(row[7]).strip().replace(",", "")) if row[7] else 0
            total = float(str(row[8]).strip().replace(",", "")) if row[8] else 0
            if amount != 0 or vat_amt != 0 or total != 0:
                result["deduction_items"].append({
                    "description": desc,
                    "amount_nad": amount,
                    "vat_nad": vat_amt,
                    "total_nad": total,
                })
        except (ValueError, IndexError):
            pass

pdf.close()
print(json.dumps(result))
`;

  const jsonStr = execSync(
    `python3 -c ${shellQuote(pyScript)} ${shellQuote(pdfPath)}`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 }
  );
  return JSON.parse(jsonStr);
}

// ---------------------------------------------------------------------------
// SQL generation
// ---------------------------------------------------------------------------
function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return `'${String(v).replace(/'/g, "''")}'`;
}

function sqlNum(v, decimals = 2) {
  if (v === null || v === undefined) return 'NULL';
  return Number(v).toFixed(decimals);
}

function generateSQL(data, pdfFilename) {
  const lines = [];
  const h = data.header;

  const totalAnimals = data.line_items.length;
  const totalColdMass = data.line_items.reduce((s, li) => s + li.cold_mass_kg, 0);
  const totalGross = data.sub_total;
  const totalDeductions = data.deductions_total;
  const totalNet = data.payment_amount;

  // Sum check
  const sumLineItemGross = data.line_items.reduce((s, li) => s + li.gross_proceeds_nad, 0);
  const diff = Math.abs(sumLineItemGross - totalGross);

  lines.push(`-- ============================================================`);
  lines.push(`-- ${pdfFilename}`);
  lines.push(`-- Statement: ${h.statement_number}  |  Date: ${h.report_date}`);
  lines.push(`-- Sum check: line items gross = ${sumLineItemGross.toFixed(2)}, statement total = ${totalGross.toFixed(2)}, diff = ${diff.toFixed(2)}`);
  if (diff > 0.02) {
    lines.push(`-- *** WARNING: SUM MISMATCH > 0.02 NAD ***`);
  } else {
    lines.push(`-- Sum check PASSED`);
  }
  lines.push(`-- ============================================================`);
  lines.push('');

  // Use DO block with variable to capture report_id for line items
  lines.push(`DO $$`);
  lines.push(`DECLARE`);
  lines.push(`  v_report_id uuid;`);
  lines.push(`BEGIN`);
  lines.push(`  INSERT INTO slaughter_reports (`);
  lines.push(`    farm_id, report_date, statement_number,`);
  lines.push(`    total_animals, total_cold_mass_kg,`);
  lines.push(`    total_gross_nad, total_deductions_nad, total_net_nad,`);
  lines.push(`    source, raw_pdf_ref`);
  lines.push(`  ) VALUES (`);
  lines.push(`    default_farm_id(),`);
  lines.push(`    ${sqlStr(h.report_date)},`);
  lines.push(`    ${sqlStr(h.statement_number)},`);
  lines.push(`    ${sqlNum(totalAnimals)},`);
  lines.push(`    ${sqlNum(totalColdMass.toFixed(1))},`);
  lines.push(`    ${sqlNum(totalGross.toFixed(2))},`);
  lines.push(`    ${sqlNum(totalDeductions.toFixed(2))},`);
  lines.push(`    ${sqlNum(totalNet.toFixed(2))},`);
  lines.push(`    'meatco-import',`);
  lines.push(`    ${sqlStr(pdfFilename)}`);
  lines.push(`  ) RETURNING id INTO v_report_id;`);
  lines.push('');

  for (const li of data.line_items) {
    lines.push(`  INSERT INTO slaughter_line_items (`);
    lines.push(`    report_id, ear_tag_id, grade, gender,`);
    lines.push(`    cold_mass_kg, announced_price_per_kg,`);
    lines.push(`    bruising_deduction_nad, condemnation_deduction_nad,`);
    lines.push(`    hide_value_nad, gross_price_per_kg, gross_proceeds_nad`);
    lines.push(`  ) VALUES (`);
    lines.push(`    v_report_id,`);
    lines.push(`    ${sqlStr(li.ear_tag_id)},`);
    lines.push(`    ${sqlStr(li.grade)},`);
    lines.push(`    ${sqlStr(li.gender)},`);
    lines.push(`    ${sqlNum(li.cold_mass_kg, 1)},`);
    lines.push(`    ${sqlNum(li.announced_price_per_kg)},`);
    lines.push(`    ${sqlNum(li.bruising_deduction_nad)},`);
    lines.push(`    ${sqlNum(li.condemnation_deduction_nad)},`);
    lines.push(`    ${sqlNum(li.hide_value_nad)},`);
    lines.push(`    ${sqlNum(li.gross_price_per_kg)},`);
    lines.push(`    ${sqlNum(li.gross_proceeds_nad)}`);
    lines.push(`  );`);
    lines.push('');
  }

  lines.push(`END $$;`);

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shellQuote(s) {
  // Use single quotes, escaping any embedded single quotes
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const args = process.argv.slice(2);
  let pdfPaths;

  if (args.length > 0) {
    pdfPaths = args.map(a => path.resolve(a));
  } else {
    pdfPaths = PDF_FILES.map(f => path.join(DATA_DIR, f));
  }

  // Check that pdfplumber is available
  try {
    execSync('python3 -c "import pdfplumber"', { stdio: 'pipe' });
  } catch {
    console.error('ERROR: Python pdfplumber is required. Install with: pip3 install pdfplumber');
    process.exit(1);
  }

  let allSQL = [];
  allSQL.push('-- ==========================================================================');
  allSQL.push('-- Meatco Slaughter Statement Import');
  allSQL.push(`-- Generated: ${new Date().toISOString()}`);
  allSQL.push('-- ==========================================================================');
  allSQL.push('');
  allSQL.push('BEGIN;');
  allSQL.push('');

  let totalFiles = 0;
  let totalAnimals = 0;
  let totalGross = 0;
  const errors = [];

  for (const pdfPath of pdfPaths) {
    const filename = path.basename(pdfPath);

    if (!fs.existsSync(pdfPath)) {
      console.error(`WARN: File not found: ${pdfPath}`);
      errors.push(`File not found: ${filename}`);
      continue;
    }

    console.error(`Processing: ${filename}`);

    try {
      const data = extractPdfData(pdfPath);
      const h = data.header;

      // Validation
      const itemCount = data.line_items.length;
      const expectedQty = h.qty_slaughtered;
      if (expectedQty && itemCount !== expectedQty) {
        const msg = `${filename}: Expected ${expectedQty} animals, found ${itemCount} line items`;
        console.error(`  WARN: ${msg}`);
        errors.push(msg);
      }

      // Sum check
      const sumGross = data.line_items.reduce((s, li) => s + li.gross_proceeds_nad, 0);
      const diff = Math.abs(sumGross - data.sub_total);
      if (diff > 0.02) {
        const msg = `${filename}: Gross proceeds mismatch: line items sum ${sumGross.toFixed(2)} vs statement ${data.sub_total.toFixed(2)} (diff: ${diff.toFixed(2)})`;
        console.error(`  *** ${msg}`);
        errors.push(msg);
      } else {
        console.error(`  Sum check PASSED (${itemCount} animals, ${data.sub_total.toFixed(2)} NAD)`);
      }

      // Verify cold mass total
      const sumColdMass = data.line_items.reduce((s, li) => s + li.cold_mass_kg, 0);
      console.error(`  Cold mass: ${sumColdMass.toFixed(1)} kg`);
      console.error(`  Deductions: ${data.deductions_total.toFixed(2)} NAD`);
      console.error(`  Net payment: ${data.payment_amount.toFixed(2)} NAD`);

      allSQL.push(generateSQL(data, filename));
      allSQL.push('');

      totalFiles++;
      totalAnimals += itemCount;
      totalGross += data.sub_total;

    } catch (err) {
      const msg = `${filename}: ${err.message}`;
      console.error(`  ERROR: ${msg}`);
      errors.push(msg);
    }
  }

  allSQL.push('COMMIT;');
  allSQL.push('');
  allSQL.push(`-- Summary: ${totalFiles} files, ${totalAnimals} animals, ${totalGross.toFixed(2)} NAD gross`);

  if (errors.length > 0) {
    allSQL.push('-- WARNINGS/ERRORS:');
    for (const e of errors) {
      allSQL.push(`--   ${e}`);
    }
  }

  // Output SQL to stdout
  console.log(allSQL.join('\n'));

  // Summary to stderr
  console.error('');
  console.error('=== Summary ===');
  console.error(`Files processed: ${totalFiles}`);
  console.error(`Total animals:   ${totalAnimals}`);
  console.error(`Total gross:     ${totalGross.toFixed(2)} NAD`);
  if (errors.length > 0) {
    console.error(`Warnings/Errors: ${errors.length}`);
  }
}

main();
