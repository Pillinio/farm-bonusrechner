#!/usr/bin/env node
// parse-dashboard.js — Parses 00_Dashboard.xlsx and outputs SQL INSERTs
// Usage: node scripts/parse-dashboard.js > output.sql
//
// Delegates Excel reading to Python (openpyxl) via child_process,
// then maps the extracted JSON into SQL INSERT statements for:
//   - budgets            (from "Kosten 2024" sheet)
//   - market_prices      (from "Absatzmarkt 2024" sheet)
//   - weather_observations (from "regenjahr-2020-2021-csv" sheet)

const { execSync } = require('child_process');
const path = require('path');

const XLSX_PATH = path.join(__dirname, '..', 'Data_Input', '00_Dashboard.xlsx');

// ---------------------------------------------------------------------------
// Python extraction — returns parsed JSON for all three sheets
// ---------------------------------------------------------------------------

function extractFromExcel() {
  const pyScript = `
import json, sys, datetime
import openpyxl

wb = openpyxl.load_workbook(${JSON.stringify(XLSX_PATH)}, data_only=True)

result = {"kosten": [], "absatzmarkt_auktionen": [], "absatzmarkt_meatco": [], "regen": []}

# --- Kosten 2024 ---
ws = wb["Kosten 2024"]
months = ["Januar","Februar","März","April","Mai","Juni","Juli","August","September","Oktober","November","Dezember"]
month_cols = list(range(8, 20))  # H=8 .. S=19 (1-indexed in openpyxl)

for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
    category = row[1].value  # column B = Budget category
    if not category:
        continue
    planned = row[3].value   # column D = Summe Plan Budget
    actual  = row[4].value   # column E = Summe Kosten
    if planned is None and actual is None:
        continue
    # Monthly actuals
    monthly = {}
    for i, col_idx in enumerate(month_cols):
        v = row[col_idx - 1].value  # row is 0-indexed tuple
        if v is not None and isinstance(v, (int, float)):
            monthly[i + 1] = v  # month number -> value
    result["kosten"].append({
        "category": category,
        "planned": planned if isinstance(planned, (int, float)) else 0,
        "actual": actual if isinstance(actual, (int, float)) else 0,
        "monthly": monthly
    })

# --- Absatzmarkt 2024 (Auktionen) ---
ws2 = wb["Absatzmarkt 2024"]

# Auction date ranges (columns B-L, row 2)
auction_dates = []
for col in range(2, 13):  # B=2 .. L=12
    v = ws2.cell(row=2, column=col).value
    if v:
        auction_dates.append({"col": col, "label": str(v)})

for row in ws2.iter_rows(min_row=3, max_row=16):
    commodity = row[0].value  # column A
    if not commodity:
        continue
    for ad in auction_dates:
        v = row[ad["col"] - 1].value
        if v is not None and isinstance(v, (int, float)):
            result["absatzmarkt_auktionen"].append({
                "commodity": commodity,
                "week_label": ad["label"],
                "price": v
            })

# Meatco prices (columns W-Z)
meatco_header = ws2.cell(row=3, column=23).value or ""  # W3
weight_cols = []
for col in range(24, 27):  # X=24, Y=25, Z=26
    v = ws2.cell(row=4, column=col).value
    if v:
        weight_cols.append({"col": col, "label": str(v)})

for row in ws2.iter_rows(min_row=5, max_row=32):
    grade = row[22].value  # column W (0-indexed = 22)
    if not grade:
        continue
    for wc in weight_cols:
        v = row[wc["col"] - 1].value
        if v is not None:
            try:
                price = float(v)
                result["absatzmarkt_meatco"].append({
                    "grade": str(grade),
                    "weight_class": wc["label"],
                    "price": price
                })
            except (ValueError, TypeError):
                pass

# --- Regenjahr 2020-2021 ---
ws3 = wb["regenjahr-2020-2021-csv"]

# Station names from row 1 (columns B-K)
stations = {}
for col in range(2, 12):  # B=2 .. K=11
    v = ws3.cell(row=1, column=col).value
    if v:
        stations[col] = str(v)

for row in ws3.iter_rows(min_row=2, max_row=ws3.max_row):
    date_val = row[0].value
    if not date_val:
        continue
    if isinstance(date_val, datetime.datetime):
        date_str = date_val.strftime("%Y-%m-%d")
    else:
        # Parse German date format dd.mm.yyyy or d.m.yyyy
        date_str = str(date_val)

    for col_idx, station_name in stations.items():
        v = row[col_idx - 1].value
        if v is not None and isinstance(v, (int, float)):
            result["regen"].append({
                "station": station_name,
                "date": date_str,
                "rainfall_mm": v
            })

print(json.dumps(result))
`;

  const raw = execSync(`python3 -c ${shellEscape(pyScript)}`, {
    maxBuffer: 10 * 1024 * 1024,
    encoding: 'utf-8'
  });
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// SQL generation helpers
// ---------------------------------------------------------------------------

function sqlStr(v) {
  if (v === null || v === undefined) return 'NULL';
  return "'" + String(v).replace(/'/g, "''") + "'";
}

function sqlNum(v) {
  if (v === null || v === undefined) return 'NULL';
  const n = Number(v);
  return isNaN(n) ? 'NULL' : String(n);
}

function shellEscape(s) {
  // Use base64 to avoid any quoting issues
  const b64 = Buffer.from(s).toString('base64');
  return `"$(echo ${b64} | base64 -d)"`;
}

// ---------------------------------------------------------------------------
// Parse auction week label into a date (use Monday of the week)
// ---------------------------------------------------------------------------

function auctionWeekToDate(label) {
  // Examples: "08-12 Jan", "29 Jan-02 Feb", "26 Feb-01 Mar"
  const monthMap = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12'
  };

  // Try "DD-DD Mon" pattern
  let m = label.match(/^(\d{1,2})-\d{1,2}\s+(\w+)$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const mon = monthMap[m[2]] || '01';
    return `2024-${mon}-${day}`;
  }

  // Try "DD Mon-DD Mon" pattern
  m = label.match(/^(\d{1,2})\s+(\w+)-\d{1,2}\s+\w+$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const mon = monthMap[m[2]] || '01';
    return `2024-${mon}-${day}`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Parse German date string to ISO
// ---------------------------------------------------------------------------

function germanDateToISO(dateStr) {
  // Already ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;

  // d.m.yyyy or dd.mm.yyyy
  const m = dateStr.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  return dateStr;
}

// ---------------------------------------------------------------------------
// Rainfall station notes
// ---------------------------------------------------------------------------

// Based on data analysis the rain gauge spreadsheet contains 10 named stations.
// Some stations appear to record cumulative season totals at their gauge
// (S/Wasser, Vernit, Oberlaber, Springbock, Onkatsgau) while others record
// periodic point-in-time readings (Haus, Ubei, Hackl, Berg, Schimon).
// The columns do NOT form clean daily/cumulative pairs — they are independent
// stations. We import all raw values and tag cumulative stations so downstream
// consumers can interpret them correctly.
const CUMULATIVE_STATIONS = new Set([
  'S/Wasser', 'Vernit', 'Oberlaber', 'Springbock', 'Onkatsgau'
]);

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const data = extractFromExcel();
  const lines = [];

  lines.push('-- ==========================================================================');
  lines.push('-- Generated by parse-dashboard.js from Data_Input/00_Dashboard.xlsx');
  lines.push(`-- Generated at: ${new Date().toISOString()}`);
  lines.push('-- ==========================================================================');
  lines.push('');

  // --- budgets ---
  lines.push('-- --------------------------------------------------------------------------');
  lines.push('-- budgets (Kosten 2024)');
  lines.push('-- --------------------------------------------------------------------------');
  lines.push('');

  const FISCAL_YEAR = 2024;

  for (const row of data.kosten) {
    // Annual summary row (planned vs actual)
    lines.push(
      `INSERT INTO budgets (fiscal_year, month, category, planned_nad, actual_nad)` +
      ` VALUES (${FISCAL_YEAR}, 0, ${sqlStr(row.category)}, ${sqlNum(row.planned)}, ${sqlNum(row.actual)});`
    );

    // Monthly actuals (only where data exists)
    for (const [monthStr, amount] of Object.entries(row.monthly)) {
      const month = parseInt(monthStr, 10);
      lines.push(
        `INSERT INTO budgets (fiscal_year, month, category, planned_nad, actual_nad)` +
        ` VALUES (${FISCAL_YEAR}, ${month}, ${sqlStr(row.category)}, 0, ${sqlNum(amount)});`
      );
    }
  }

  lines.push('');

  // --- market_prices (Auktionen) ---
  lines.push('-- --------------------------------------------------------------------------');
  lines.push('-- market_prices (Absatzmarkt 2024 — Auktionen / WHKLA)');
  lines.push('-- --------------------------------------------------------------------------');
  lines.push('');

  for (const row of data.absatzmarkt_auktionen) {
    const priceDate = auctionWeekToDate(row.week_label);
    if (!priceDate) continue;

    // Cows with calves are N$/unit, everything else is N$/kg
    const unit = row.commodity.includes('unit') ? 'NAD/unit' : 'NAD/kg';

    lines.push(
      `INSERT INTO market_prices (price_date, commodity, price_nad, unit, source)` +
      ` VALUES (${sqlStr(priceDate)}, ${sqlStr(row.commodity)}, ${sqlNum(row.price)}, ${sqlStr(unit)}, 'WHKLA-Auktion');`
    );
  }

  lines.push('');

  // --- market_prices (Meatco) ---
  lines.push('-- --------------------------------------------------------------------------');
  lines.push('-- market_prices (Absatzmarkt 2024 — Meatco Schlachtpreise, March 2024)');
  lines.push('-- --------------------------------------------------------------------------');
  lines.push('');

  for (const row of data.absatzmarkt_meatco) {
    const commodity = `Meatco Grade ${row.grade} (${row.weight_class})`;
    lines.push(
      `INSERT INTO market_prices (price_date, commodity, price_nad, unit, source)` +
      ` VALUES ('2024-03-01', ${sqlStr(commodity)}, ${sqlNum(row.price)}, 'NAD/kg', 'Meatco');`
    );
  }

  lines.push('');

  // --- weather_observations ---
  lines.push('-- --------------------------------------------------------------------------');
  lines.push('-- weather_observations (Regenjahr 2020-2021)');
  lines.push('-- --------------------------------------------------------------------------');
  lines.push('-- Stations with periodic/daily readings: Haus, Ubei, Hackl, Berg, Schimon');
  lines.push('-- Stations with cumulative season totals: S/Wasser, Vernit, Oberlaber, Springbock, Onkatsgau');
  lines.push('-- Cumulative stations are tagged with source = "excel-import-cumulative".');
  lines.push('');

  for (const row of data.regen) {
    const isoDate = germanDateToISO(row.date);
    const source = CUMULATIVE_STATIONS.has(row.station)
      ? 'excel-import-cumulative'
      : 'excel-import';
    lines.push(
      `INSERT INTO weather_observations (station_name, observation_date, rainfall_mm, source)` +
      ` VALUES (${sqlStr(row.station)}, ${sqlStr(isoDate)}, ${sqlNum(row.rainfall_mm)}, ${sqlStr(source)});`
    );
  }

  // Output
  console.log(lines.join('\n'));
}

main();
