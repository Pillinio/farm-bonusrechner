#!/usr/bin/env node
/**
 * parse-lpo.js — Extract cattle market prices from LPO Weekly Market Information PDF
 * and output SQL INSERT/UPSERT statements for market_prices.
 *
 * Uses Python pdf2image + pytesseract for OCR (the price tables in the Gmail-printed
 * PDF are embedded as images, not selectable text).
 *
 * Prerequisites:
 *   pip3 install pdf2image pytesseract pdfplumber
 *   brew install tesseract poppler
 *
 * Usage:  node scripts/parse-lpo.js
 *         node scripts/parse-lpo.js path/to/specific.pdf
 *         node scripts/parse-lpo.js path/to/specific.pdf > output.sql
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const DATA_DIR = path.resolve(__dirname, '..', 'Data_Input');

// All known LPO PDF files (add new ones here or pass as CLI args)
const PDF_FILES = [
  'Gmail - FW_ LPO Weekly Market Information _ 04 March 2026.pdf',
];

// Grades we expect in the cattle table
const EXPECTED_GRADES = [
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
  'AB0', 'AB1', 'AB2', 'AB3', 'AB4', 'AB5', 'AB6',
  'B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
  'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
];

// ---------------------------------------------------------------------------
// Python helper — OCR extraction via pdf2image + pytesseract + pdfplumber
// ---------------------------------------------------------------------------
function extractPdfData(pdfPath) {
  const pyScript = `
import json, sys, re
import pdfplumber
from pdf2image import convert_from_path
import pytesseract

pdf_path = sys.argv[1]

result = {
    "week_number": None,
    "week_range": None,
    "price_date": None,
    "cattle_prices": [],
}

# ── Page 1: Extract week info from selectable text ──────────────────────
pdf = pdfplumber.open(pdf_path)
page1_text = pdf.pages[0].extract_text()
pdf.close()

# Look for "WEEK 10 | 02-06 March 2026" pattern
week_match = re.search(r'WEEK\\s+(\\d+)\\s*\\|\\s*(\\d{2})[-–](\\d{2})\\s+(\\w+)\\s+(\\d{4})', page1_text)
if week_match:
    result["week_number"] = int(week_match.group(1))
    day_start = int(week_match.group(2))
    month_name = week_match.group(4)
    year = int(week_match.group(5))

    # Parse month
    months = {
        'January': 1, 'February': 2, 'March': 3, 'April': 4,
        'May': 5, 'June': 6, 'July': 7, 'August': 8,
        'September': 9, 'October': 10, 'November': 11, 'December': 12,
    }
    month_num = months.get(month_name, 0)
    if month_num:
        result["price_date"] = f"{year}-{month_num:02d}-{day_start:02d}"
        result["week_range"] = f"{week_match.group(2)}-{week_match.group(3)} {month_name} {year}"
else:
    sys.stderr.write("WARN: Could not extract week info from page 1\\n")
    sys.stderr.write(f"  Page 1 text: {page1_text[:300]}\\n")

# ── OCR: Convert PDF pages to images and extract cattle table ───────────
images = convert_from_path(pdf_path, dpi=300)

# The cattle table is typically on page 3 (index 2) of the Gmail PDF printout.
# We scan pages 2-4 looking for the cattle price data.
cattle_text = None
for page_idx in range(1, min(len(images), 5)):
    text = pytesseract.image_to_string(images[page_idx])
    # Look for Meatco + grade rows (cattle indicators)
    # OCR often reads "A0" as "AO" (letter O instead of zero)
    if 'Meatco' in text and re.search(r'\\bA[O0]\\b.*\\d+\\.\\d+', text):
        cattle_text = text
        sys.stderr.write(f"  Found cattle table on PDF page {page_idx + 1}\\n")
        break

if not cattle_text:
    sys.stderr.write("ERROR: Could not find cattle price table in any page\\n")
    print(json.dumps(result))
    sys.exit(0)

# ── Parse the cattle price rows ─────────────────────────────────────────
# Each row looks like (OCR loses empty cells, so column count varies):
#   A0  72.00  75.00  54.00  59.00  64.00  64.00  64.00         (7 values, no RMAA)
#   A2  75.00  78.00  64.00  69.00  74.00  74.00  74.00  61.64  (8 values, with RMAA)
# Columns: Grade | Meatco 180-239 | Meatco Fixed 240+ | Beefcor... | RMAA
# Beefcor has up to 6 sub-columns but empty cells get dropped by OCR.
# We extract all numbers and use position-based logic.

grade_pattern = re.compile(
    r'^\\s*(A[B]?[0-6]|B[0-6]|C[0-6])\\s+'
    r'((?:\\d+\\.\\d+\\s*)+)',
    re.MULTILINE
)

for line in cattle_text.split('\\n'):
    # Normalize OCR artifacts in grade names
    # OCR commonly confuses: 0<->O, 1<->l/I, 5<->S
    # We fix grade prefixes at start of line only
    line = re.sub(r'^(\\s*)AO\\b', r'\\1A0', line)   # AO -> A0
    line = re.sub(r'^(\\s*)ABO\\b', r'\\1AB0', line)  # ABO -> AB0
    line = re.sub(r'^(\\s*)ABI\\b', r'\\1AB1', line)  # ABI -> AB1
    line = re.sub(r'^(\\s*)ABl\\b', r'\\1AB1', line)  # ABl -> AB1
    line = re.sub(r'^(\\s*)ABS(\\s)', r'\\1AB5\\2', line)  # ABS -> AB5
    line = re.sub(r'^(\\s*)ABS5\\b', r'\\1AB5', line)  # ABS5 -> AB5
    line = re.sub(r'^(\\s*)BO\\b', r'\\1B0', line)    # BO -> B0
    line = re.sub(r'^(\\s*)Bo\\b', r'\\1B6', line)    # Bo -> B6 (OCR: lowercase 'o' for '6' after B5)
    line = re.sub(r'^(\\s*)Bl\\b', r'\\1B1', line)    # Bl -> B1
    line = re.sub(r'^(\\s*)CO\\b', r'\\1C0', line)    # CO -> C0
    line = re.sub(r'^(\\s*)co\\b', r'\\1C0', line)    # co -> C0
    line = re.sub(r'^(\\s*)Co\\b', r'\\1C0', line)    # Co -> C0
    line = re.sub(r'^(\\s*)Cl\\b', r'\\1C1', line)    # Cl -> C1
    line = re.sub(r'^(\\s*)Al\\b', r'\\1A1', line)    # Al -> A1
    # Fix OCR "6L.1" -> "61.1", "6L.11" -> "61.11" etc in numbers
    line = re.sub(r'(\\d)L\\.', r'\\g<1>1.', line)
    # Fix trailing period after numbers: "69.00." -> "69.00"
    line = re.sub(r'(\\d+\\.\\d+)\\.(?:\\s|$)', r'\\1 ', line)

    m = grade_pattern.match(line)
    if m:
        grade = m.group(1)
        nums = [float(x) for x in re.findall(r'\\d+\\.\\d+', m.group(2))]

        if len(nums) < 2:
            continue

        prices = {
            "grade": grade,
            "meatco_180_239": nums[0],
            "meatco_fixed_240plus": nums[1],
        }

        # Beefcor columns: positions 2..N after Meatco prices
        # The last value might be RMAA (appears only on some rows, typically
        # in the 40-110 range vs Beefcor prices in the 50-80 range).
        # Heuristic: if there are 8+ values, last one is RMAA.
        # For Beefcor, pick the Oxen price (middle of remaining values).
        beefcor_vals = nums[2:]

        # RMAA detection: if the last beefcor value is significantly different
        # from the others (RMAA is typically lower), and we have enough values
        if len(beefcor_vals) >= 6:
            # 8+ total values -> last is RMAA
            prices["rmaa"] = beefcor_vals[-1]
            beefcor_vals = beefcor_vals[:-1]

        if beefcor_vals:
            # Pick the middle Beefcor value as representative (typically Oxen 3+ 200-229)
            mid_idx = len(beefcor_vals) // 2
            prices["beefcor_oxen"] = beefcor_vals[mid_idx]

        result["cattle_prices"].append(prices)

# Post-process: fix duplicate grades caused by OCR (e.g., "Bo" read as B0 twice)
# The grades should appear in a fixed order. If we see duplicates, the second
# occurrence is likely the next expected grade.
expected_order = [
    'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
    'AB0', 'AB1', 'AB2', 'AB3', 'AB4', 'AB5', 'AB6',
    'B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
    'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
]
seen_grades = set()
fixed_prices = []
for p in result["cattle_prices"]:
    grade = p["grade"]
    if grade in seen_grades:
        # Find the next expected grade after the last seen one
        last_idx = max(expected_order.index(g) for g in seen_grades if g in expected_order)
        next_grade = expected_order[last_idx + 1] if last_idx + 1 < len(expected_order) else None
        if next_grade:
            sys.stderr.write(f"  Fix duplicate {grade} -> {next_grade}\\n")
            p["grade"] = next_grade
            grade = next_grade
    seen_grades.add(grade)
    fixed_prices.append(p)
result["cattle_prices"] = fixed_prices

# Validate: check we found a reasonable number of grades
found_grades = [p["grade"] for p in result["cattle_prices"]]
expected_set = set(['A0', 'A1', 'A2', 'A3', 'B0', 'B1', 'C0', 'C1'])
missing = expected_set - set(found_grades)
if missing:
    sys.stderr.write(f"  WARN: Missing expected grades: {sorted(missing)}\\n")

sys.stderr.write(f"  Extracted {len(result['cattle_prices'])} grade rows\\n")

print(json.dumps(result))
`;

  const jsonStr = execSync(
    `python3 -c ${shellQuote(pyScript)} ${shellQuote(pdfPath)}`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 120000 }
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
  const priceDate = data.price_date;

  if (!priceDate) {
    throw new Error('Could not determine price_date from PDF');
  }

  lines.push(`-- ============================================================`);
  lines.push(`-- ${pdfFilename}`);
  lines.push(`-- Week ${data.week_number || '?'} | ${data.week_range || '?'}`);
  lines.push(`-- Price date: ${priceDate}`);
  lines.push(`-- Grades extracted: ${data.cattle_prices.length}`);
  lines.push(`-- ============================================================`);
  lines.push('');

  for (const p of data.cattle_prices) {
    const grade = p.grade;

    // Meatco 180-239kg
    lines.push(`INSERT INTO market_prices (price_date, commodity, price_nad, unit, source)`);
    lines.push(`VALUES (${sqlStr(priceDate)}, ${sqlStr(`beef_meatco_${grade}`)}, ${sqlNum(p.meatco_180_239)}, 'per_kg', 'lpo-weekly')`);
    lines.push(`ON CONFLICT (price_date, commodity) DO UPDATE SET price_nad = EXCLUDED.price_nad;`);
    lines.push('');

    // Meatco Fixed 240kg+
    lines.push(`INSERT INTO market_prices (price_date, commodity, price_nad, unit, source)`);
    lines.push(`VALUES (${sqlStr(priceDate)}, ${sqlStr(`beef_meatco_fixed_${grade}`)}, ${sqlNum(p.meatco_fixed_240plus)}, 'per_kg', 'lpo-weekly')`);
    lines.push(`ON CONFLICT (price_date, commodity) DO UPDATE SET price_nad = EXCLUDED.price_nad;`);
    lines.push('');

    // Beefcor (representative ox price)
    if (p.beefcor_oxen !== undefined) {
      lines.push(`INSERT INTO market_prices (price_date, commodity, price_nad, unit, source)`);
      lines.push(`VALUES (${sqlStr(priceDate)}, ${sqlStr(`beef_beefcor_${grade}`)}, ${sqlNum(p.beefcor_oxen)}, 'per_kg', 'lpo-weekly')`);
      lines.push(`ON CONFLICT (price_date, commodity) DO UPDATE SET price_nad = EXCLUDED.price_nad;`);
      lines.push('');
    }

    // RMAA (if available)
    if (p.rmaa !== undefined) {
      lines.push(`INSERT INTO market_prices (price_date, commodity, price_nad, unit, source)`);
      lines.push(`VALUES (${sqlStr(priceDate)}, ${sqlStr(`beef_rmaa_${grade}`)}, ${sqlNum(p.rmaa)}, 'per_kg', 'lpo-weekly')`);
      lines.push(`ON CONFLICT (price_date, commodity) DO UPDATE SET price_nad = EXCLUDED.price_nad;`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function shellQuote(s) {
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

  // Check dependencies
  try {
    execSync('python3 -c "import pdfplumber, pdf2image, pytesseract"', { stdio: 'pipe' });
  } catch {
    console.error('ERROR: Python dependencies required. Install with:');
    console.error('  pip3 install pdfplumber pdf2image pytesseract');
    console.error('Also ensure tesseract and poppler are installed:');
    console.error('  brew install tesseract poppler');
    process.exit(1);
  }

  const allSQL = [];
  allSQL.push('-- ==========================================================================');
  allSQL.push('-- LPO Weekly Market Information — Cattle Prices Import');
  allSQL.push(`-- Generated: ${new Date().toISOString()}`);
  allSQL.push('-- ==========================================================================');
  allSQL.push('');
  allSQL.push('BEGIN;');
  allSQL.push('');

  let totalFiles = 0;
  let totalPrices = 0;
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

      if (!data.price_date) {
        throw new Error('Could not extract price date from PDF header');
      }

      const gradeCount = data.cattle_prices.length;
      if (gradeCount < 20) {
        const msg = `${filename}: Only ${gradeCount} grades extracted (expected ~27)`;
        console.error(`  WARN: ${msg}`);
        errors.push(msg);
      }

      // Show sample prices for verification
      const a0 = data.cattle_prices.find(p => p.grade === 'A0');
      if (a0) {
        console.error(`  Sample A0: Meatco=${a0.meatco_180_239}, Fixed=${a0.meatco_fixed_240plus}, Beefcor=${a0.beefcor_oxen || 'N/A'}`);
      }

      allSQL.push(generateSQL(data, filename));
      allSQL.push('');

      // Count total price rows generated
      let priceRows = 0;
      for (const p of data.cattle_prices) {
        priceRows += 2; // meatco + meatco_fixed always
        if (p.beefcor_oxen !== undefined) priceRows++;
        if (p.rmaa !== undefined) priceRows++;
      }

      totalFiles++;
      totalPrices += priceRows;

      console.error(`  Generated ${priceRows} price rows for ${gradeCount} grades`);

    } catch (err) {
      const msg = `${filename}: ${err.message}`;
      console.error(`  ERROR: ${msg}`);
      errors.push(msg);
    }
  }

  allSQL.push('COMMIT;');
  allSQL.push('');
  allSQL.push(`-- Summary: ${totalFiles} files, ${totalPrices} price rows`);

  if (errors.length > 0) {
    allSQL.push('-- WARNINGS/ERRORS:');
    for (const e of errors) {
      allSQL.push(`--   ${e}`);
    }
  }

  // SQL to stdout
  console.log(allSQL.join('\n'));

  // Summary to stderr
  console.error('');
  console.error('=== Summary ===');
  console.error(`Files processed: ${totalFiles}`);
  console.error(`Total price rows: ${totalPrices}`);
  if (errors.length > 0) {
    console.error(`Warnings/Errors: ${errors.length}`);
  }
}

main();
