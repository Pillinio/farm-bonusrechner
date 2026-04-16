#!/usr/bin/env node
/**
 * parse-lpo.js — Extract cattle market prices + LABTA auction prices from LPO
 * Weekly Market Information PDF and output SQL INSERT/UPSERT statements for
 * market_prices.
 *
 * Supports two CATTLE table layouts (column 1 differs):
 *   Old (pre-2026-Q2): [Meatco 180-239] [Meatco Fixed 240+] [Beefcor…] [RMAA]
 *   New (2026-Q2+):    [Meatco Fixed 240+] [Savanna Beef Operations] [Beefcor…] [RMAA]
 *
 * Detection: if the OCR text contains "Savanna" (header row), new layout is used.
 *
 * LABTA auction table is extracted via pdfplumber from page 5; only cattle-relevant
 * rows are kept (sheep/goat/game are skipped per requirement).
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

const PDF_FILES = [
  'Gmail - FW_ LPO Weekly Market Information _ 04 March 2026.pdf',
];

const EXPECTED_GRADES = [
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
  'AB0', 'AB1', 'AB2', 'AB3', 'AB4', 'AB5', 'AB6',
  'B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
  'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
];

// LABTA cattle-row whitelist (everything else — sheep/goat — is skipped).
// Keys are lowercased, trimmed versions of the label in the PDF.
// Value = commodity key suffix (we prefix with 'auction_labta_').
const LABTA_CATTLE_TYPES = {
  'tollies/heifers mix':   { suffix: 'tollies_heifers_mix',   basis: 'live' },
  'tollies':               { suffix: 'tollies',               basis: 'live' },
  'tollies nguni':         { suffix: 'tollies_nguni',         basis: 'live' },
  'heifers':               { suffix: 'heifers',               basis: 'live' },
  'heifers nguni':         { suffix: 'heifers_nguni',         basis: 'live' },
  'store oxen':            { suffix: 'store_oxen',            basis: 'live' },
  'store oxen nguni':      { suffix: 'store_oxen_nguni',      basis: 'live' },
  'store heifers':         { suffix: 'store_heifers',         basis: 'live' },
  'store heifers nguni':   { suffix: 'store_heifers_nguni',   basis: 'live' },
  'slaughter oxen':        { suffix: 'slaughter_oxen',        basis: 'live' },
  'slaughter heifers':     { suffix: 'slaughter_heifers',     basis: 'live' },
  'cows fat':              { suffix: 'cows_fat',              basis: 'live' },
  'cows medium':           { suffix: 'cows_medium',           basis: 'live' },
  'cows lean':             { suffix: 'cows_lean',             basis: 'live' },
  'slaughter bulls':       { suffix: 'slaughter_bulls',       basis: 'live' },
  "cow's with calves":     { suffix: 'cow_with_calf',         basis: 'per_head' },
  'cows with calves':      { suffix: 'cow_with_calf',         basis: 'per_head' },
};

// ---------------------------------------------------------------------------
// Python helper — OCR + pdfplumber extraction
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
    "cattle_format": None,
    "auction_prices": [],
    "auction_week_range": None,
}

# ── Week info from page 1 (selectable text) ────────────────────────────────
pdf = pdfplumber.open(pdf_path)
page1_text = pdf.pages[0].extract_text() or ""

from datetime import date, timedelta

week_match = re.search(r'WEEK\\s+(\\d+)\\s*\\|\\s*(\\d{2})[-\\u2013](\\d{2})\\s+(\\w+)\\s+(\\d{4})', page1_text)
if week_match:
    result["week_number"] = int(week_match.group(1))
    week_num = result["week_number"]
    day_start = int(week_match.group(2))
    month_name = week_match.group(4)
    year = int(week_match.group(5))
    # Compute the Monday of ISO week N — this is authoritative, because LPO's
    # printed month name is occasionally a typo (e.g., "March" on a 15-April report).
    try:
        iso_monday = date.fromisocalendar(year, week_num, 1)
        result["price_date"] = iso_monday.isoformat()
        result["week_range"] = f"{week_match.group(2)}-{week_match.group(3)} {month_name} {year}"
        # Warn if printed month disagrees with ISO calculation
        months = {'January':1,'February':2,'March':3,'April':4,'May':5,'June':6,
                  'July':7,'August':8,'September':9,'October':10,'November':11,'December':12}
        printed_month = months.get(month_name, 0)
        if printed_month and printed_month != iso_monday.month:
            sys.stderr.write(
                f"  NOTE: LPO printed month '{month_name}' disagrees with ISO week {week_num} "
                f"({iso_monday.isoformat()}) — using ISO date.\\n"
            )
    except ValueError as e:
        sys.stderr.write(f"  WARN: ISO week computation failed: {e}\\n")
else:
    sys.stderr.write("WARN: Could not extract week info from page 1\\n")

# ── OCR cattle table (image-embedded, pages 2-5) ────────────────────────────
images = convert_from_path(pdf_path, dpi=300)

cattle_text = None
for page_idx in range(1, min(len(images), 6)):
    text = pytesseract.image_to_string(images[page_idx])
    if 'Meatco' in text and re.search(r'\\bA[O0]\\b.*\\d+\\.\\d+', text):
        cattle_text = text
        sys.stderr.write(f"  Found cattle table on PDF page {page_idx + 1}\\n")
        break

if not cattle_text:
    sys.stderr.write("ERROR: Could not find cattle price table\\n")
else:
    # Column-layout detection:
    #   New (2026+): 'Savanna' appears above the price rows (column header)
    #   Old:         no 'Savanna' keyword, two Meatco columns
    if re.search(r'Savanna', cattle_text, re.IGNORECASE):
        result["cattle_format"] = "new"
    else:
        result["cattle_format"] = "old"

    sys.stderr.write(f"  Cattle format: {result['cattle_format']}\\n")

    grade_pattern = re.compile(
        r'^\\s*(A[B]?[0-6]|B[0-6]|C[0-6])\\s+'
        r'((?:\\d+\\.\\d+\\s*)+)',
        re.MULTILINE
    )

    for line in cattle_text.split('\\n'):
        # OCR artifact fixes (letter/digit confusion at grade prefix)
        line = re.sub(r'^(\\s*)AO\\b', r'\\1A0', line)
        line = re.sub(r'^(\\s*)ABO\\b', r'\\1AB0', line)
        line = re.sub(r'^(\\s*)ABI\\b', r'\\1AB1', line)
        line = re.sub(r'^(\\s*)ABl\\b', r'\\1AB1', line)
        line = re.sub(r'^(\\s*)ABS(\\s)', r'\\1AB5\\2', line)
        line = re.sub(r'^(\\s*)ABS5\\b', r'\\1AB5', line)
        line = re.sub(r'^(\\s*)BO\\b', r'\\1B0', line)
        line = re.sub(r'^(\\s*)Bo\\b', r'\\1B6', line)
        line = re.sub(r'^(\\s*)Bl\\b', r'\\1B1', line)
        line = re.sub(r'^(\\s*)CO\\b', r'\\1C0', line)
        line = re.sub(r'^(\\s*)co\\b', r'\\1C0', line)
        line = re.sub(r'^(\\s*)Co\\b', r'\\1C0', line)
        line = re.sub(r'^(\\s*)Cl\\b', r'\\1C1', line)
        line = re.sub(r'^(\\s*)Al\\b', r'\\1A1', line)
        line = re.sub(r'(\\d)L\\.', r'\\g<1>1.', line)
        line = re.sub(r'(\\d+\\.\\d+)\\.(?:\\s|$)', r'\\1 ', line)

        m = grade_pattern.match(line)
        if not m:
            continue

        grade = m.group(1)
        nums = [float(x) for x in re.findall(r'\\d+\\.\\d+', m.group(2))]
        if len(nums) < 2:
            continue

        prices = {"grade": grade}

        # Heuristic: if >=6 remaining beefcor values after deducting first two,
        # the last is RMAA (week 14, separate block).
        rmaa = None
        beefcor_vals = nums[2:]
        if len(beefcor_vals) >= 6:
            rmaa = beefcor_vals[-1]
            beefcor_vals = beefcor_vals[:-1]
        if rmaa is not None:
            prices["rmaa"] = rmaa

        # Column 0/1 meaning depends on format
        if result["cattle_format"] == "new":
            prices["meatco_fixed_240plus"] = nums[0]
            prices["savanna"] = nums[1]
        else:
            prices["meatco_180_239"] = nums[0]
            prices["meatco_fixed_240plus"] = nums[1]

        # Representative Beefcor price = middle column
        if beefcor_vals:
            mid_idx = len(beefcor_vals) // 2
            prices["beefcor_oxen"] = beefcor_vals[mid_idx]

        result["cattle_prices"].append(prices)

    # Fix OCR duplicates by expected-order progression
    expected_order = [
        'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6',
        'AB0', 'AB1', 'AB2', 'AB3', 'AB4', 'AB5', 'AB6',
        'B0', 'B1', 'B2', 'B3', 'B4', 'B5', 'B6',
        'C0', 'C1', 'C2', 'C3', 'C4', 'C5', 'C6',
    ]
    seen = set()
    fixed = []
    for p in result["cattle_prices"]:
        g = p["grade"]
        if g in seen:
            last_idx = max(expected_order.index(x) for x in seen if x in expected_order)
            nxt = expected_order[last_idx + 1] if last_idx + 1 < len(expected_order) else None
            if nxt:
                sys.stderr.write(f"  Fix duplicate {g} -> {nxt}\\n")
                p["grade"] = nxt
                g = nxt
        seen.add(g)
        fixed.append(p)
    result["cattle_prices"] = fixed

    sys.stderr.write(f"  Extracted {len(result['cattle_prices'])} cattle grade rows\\n")

pdf.close()

# ── LABTA auction table — coordinate-based OCR (rows are tall + sparse) ─────
labta_labels = set(json.loads(sys.argv[2]))
labta_page_idx = None
labta_text_preview = None
for page_idx in range(len(images)):
    text = pytesseract.image_to_string(images[page_idx])
    if re.search(r'LABTA|AUCTION\\s+PRICES', text, re.IGNORECASE):
        labta_page_idx = page_idx
        labta_text_preview = text
        sys.stderr.write(f"  Found LABTA auction section on PDF page {page_idx + 1}\\n")
        break

def normalize_label(s):
    s = s.strip().lower()
    s = re.sub(r"[\\u2018\\u2019]", "'", s)      # curly quotes
    s = re.sub(r'\\s+', ' ', s)
    s = re.sub(r"[^\\w\\s/']", '', s)            # strip stray punctuation
    return s.strip()

if labta_page_idx is not None:
    # Re-OCR with PSM 4 (single-column of text, variable sizes) — keeps LABTA
    # table rows intact as "Label Avg Min Max" lines.
    labta_text_psm4 = pytesseract.image_to_string(
        images[labta_page_idx],
        config='--psm 4'
    )

    # Auction period
    dr = re.search(
        r'Price\\s*/\\s*kg:?\\s*(\\d{1,2})\\s*[-\\u2013]\\s*(\\d{1,2})\\s+(\\w+)\\s+(\\d{4})',
        labta_text_psm4
    )
    if dr:
        result["auction_week_range"] = f"{dr.group(1)}-{dr.group(2)} {dr.group(3)} {dr.group(4)}"

    # Simple row-based extraction (PSM 4 keeps each LABTA row on one line).
    # Strategy: for each line, find longest label match; first numeric after it = Avg.
    norm_label_map = {normalize_label(k): k for k in labta_labels}
    num_re = re.compile(r'[\\d,]+\\.\\d{1,2}')

    # OCR typos to normalize before label matching
    OCR_FIXES = [
        (r'\\bToles\\b', 'Tollies'),     # 'Toles' → 'Tollies'
        (r'\\bToll?ies\\b', 'Tollies'),
    ]

    for raw in labta_text_psm4.split('\\n'):
        line = raw.strip()
        if not line:
            continue
        # Apply OCR typo fixes
        for pat, repl in OCR_FIXES:
            line = re.sub(pat, repl, line, flags=re.IGNORECASE)

        # Try to find a label anywhere at start of line (longest match wins)
        lower = normalize_label(line)
        matched_label = None
        # Greedy: try longest candidate in the label set that the line starts with
        sorted_labels = sorted(norm_label_map.keys(), key=len, reverse=True)
        for norm_l in sorted_labels:
            if lower.startswith(norm_l):
                matched_label = norm_label_map[norm_l]
                break
        if not matched_label:
            continue

        # Extract first numeric value after the label
        # Find where label ends in original line, then search numbers
        nums = num_re.findall(line)
        if not nums:
            continue  # "-" row or no-data
        try:
            price_avg = float(nums[0].replace(',', ''))
        except ValueError:
            continue

        result["auction_prices"].append({
            "label": matched_label,
            "price_avg": price_avg,
        })

    sys.stderr.write(f"  LABTA rows extracted: {len(result['auction_prices'])}\\n")
else:
    sys.stderr.write("  No LABTA auction section detected\\n")

print(json.dumps(result))
`;

  const labtaLabelsJSON = JSON.stringify(Object.keys(LABTA_CATTLE_TYPES));

  const jsonStr = execSync(
    `python3 -c ${shellQuote(pyScript)} ${shellQuote(pdfPath)} ${shellQuote(labtaLabelsJSON)}`,
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, timeout: 180000 }
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

function insertLine(priceDate, commodity, price, unit, provider, grade, weightBasis, source = 'lpo-weekly') {
  return [
    `INSERT INTO market_prices (price_date, commodity, price_nad, unit, source, provider, grade, weight_basis)`,
    `VALUES (${sqlStr(priceDate)}, ${sqlStr(commodity)}, ${sqlNum(price)}, ${sqlStr(unit)}, ${sqlStr(source)}, ${sqlStr(provider)}, ${grade ? sqlStr(grade) : 'NULL'}, ${sqlStr(weightBasis)})`,
    `ON CONFLICT (price_date, commodity) DO UPDATE SET`,
    `  price_nad = EXCLUDED.price_nad,`,
    `  provider = EXCLUDED.provider,`,
    `  grade = EXCLUDED.grade,`,
    `  weight_basis = EXCLUDED.weight_basis;`,
    ''
  ].join('\n');
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
  lines.push(`-- Cattle price date: ${priceDate}`);
  lines.push(`-- Cattle format: ${data.cattle_format || 'unknown'}`);
  lines.push(`-- Cattle grades: ${data.cattle_prices.length}`);
  lines.push(`-- LABTA auction (${data.auction_week_range || '?'}): ${data.auction_prices.length} cattle rows`);
  lines.push(`-- ============================================================`);
  lines.push('');

  // ── Cattle prices ────────────────────────────────────────────────────
  for (const p of data.cattle_prices) {
    const grade = p.grade;

    if (p.meatco_180_239 !== undefined) {
      lines.push(insertLine(priceDate, `beef_meatco_${grade}`, p.meatco_180_239,
        'per_kg', 'meatco', grade, 'carcass'));
    }
    if (p.meatco_fixed_240plus !== undefined) {
      lines.push(insertLine(priceDate, `beef_meatco_fixed_${grade}`, p.meatco_fixed_240plus,
        'per_kg', 'meatco_fixed', grade, 'carcass'));
    }
    if (p.savanna !== undefined) {
      lines.push(insertLine(priceDate, `beef_savanna_${grade}`, p.savanna,
        'per_kg', 'savanna', grade, 'carcass'));
    }
    if (p.beefcor_oxen !== undefined) {
      lines.push(insertLine(priceDate, `beef_beefcor_${grade}`, p.beefcor_oxen,
        'per_kg', 'beefcor', grade, 'carcass'));
    }
    if (p.rmaa !== undefined) {
      lines.push(insertLine(priceDate, `beef_rmaa_${grade}`, p.rmaa,
        'per_kg', 'rmaa', grade, 'carcass'));
    }
  }

  // ── LABTA auction prices ─────────────────────────────────────────────
  // Use the cattle price_date as the anchor date for auction rows (report issued same week).
  for (const a of data.auction_prices) {
    const typeDef = LABTA_CATTLE_TYPES[a.label];
    if (!typeDef) continue;
    const commodity = `auction_labta_${typeDef.suffix}`;
    const unit = typeDef.basis === 'per_head' ? 'per_head' : 'per_kg';
    lines.push(insertLine(priceDate, commodity, a.price_avg,
      unit, 'labta', null, typeDef.basis, 'lpo-weekly-labta'));
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
  allSQL.push('-- LPO Weekly Market Information — Cattle + LABTA Auction Import');
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

      const a2 = data.cattle_prices.find(p => p.grade === 'A2');
      if (a2) {
        const parts = [];
        if (a2.meatco_180_239 !== undefined) parts.push(`Meatco=${a2.meatco_180_239}`);
        if (a2.meatco_fixed_240plus !== undefined) parts.push(`Fixed=${a2.meatco_fixed_240plus}`);
        if (a2.savanna !== undefined) parts.push(`Savanna=${a2.savanna}`);
        if (a2.beefcor_oxen !== undefined) parts.push(`Beefcor=${a2.beefcor_oxen}`);
        if (a2.rmaa !== undefined) parts.push(`RMAA=${a2.rmaa}`);
        console.error(`  Sample A2: ${parts.join(', ')}`);
      }

      console.error(`  LABTA auction rows: ${data.auction_prices.length}`);

      allSQL.push(generateSQL(data, filename));
      allSQL.push('');

      let priceRows = 0;
      for (const p of data.cattle_prices) {
        if (p.meatco_180_239 !== undefined) priceRows++;
        if (p.meatco_fixed_240plus !== undefined) priceRows++;
        if (p.savanna !== undefined) priceRows++;
        if (p.beefcor_oxen !== undefined) priceRows++;
        if (p.rmaa !== undefined) priceRows++;
      }
      priceRows += data.auction_prices.length;

      totalFiles++;
      totalPrices += priceRows;

      console.error(`  Generated ${priceRows} price rows`);

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
    for (const e of errors) allSQL.push(`--   ${e}`);
  }

  console.log(allSQL.join('\n'));

  console.error('');
  console.error('=== Summary ===');
  console.error(`Files processed: ${totalFiles}`);
  console.error(`Total price rows: ${totalPrices}`);
  if (errors.length > 0) console.error(`Warnings/Errors: ${errors.length}`);
}

main();
