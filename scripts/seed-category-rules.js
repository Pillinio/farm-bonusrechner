#!/usr/bin/env node
// seed-category-rules.js — Generates SQL INSERT statements for category_rules
// Usage: node scripts/seed-category-rules.js > output.sql
//
// Maps common Namibian farm transaction patterns (bank statement descriptions)
// to budget categories from the Dashboard spreadsheet.

function sqlStr(v) {
  return "'" + String(v).replace(/'/g, "''") + "'";
}

// Each rule: [pattern, pattern_type, category_name, confidence]
const rules = [
  // --- Salaries Farm Workers & Welfare ---
  ['SALARY',          'contains', 'Salaries Farm Workers & Welfare', 0.90],
  ['WAGES',           'contains', 'Salaries Farm Workers & Welfare', 0.90],
  ['LOHN',            'contains', 'Salaries Farm Workers & Welfare', 0.85],
  ['PAYROLL',         'contains', 'Salaries Farm Workers & Welfare', 0.90],

  // --- Social Security ---
  ['SSC',             'contains', 'Social Security',                 0.85],
  ['SOCIAL SECURITY', 'contains', 'Social Security',                 0.95],

  // --- Fodder/Lick ---
  ['FEEDMASTER',      'contains', 'Fodder/Lick',                     0.95],
  ['VOERMOL',         'contains', 'Fodder/Lick',                     0.95],
  ['FEED ',           'contains', 'Fodder/Lick',                     0.80],
  ['LICK',            'contains', 'Fodder/Lick',                     0.85],
  ['ANIMAL FEED',     'contains', 'Fodder/Lick',                     0.90],
  ['AGRA FEED',       'contains', 'Fodder/Lick',                     0.90],

  // --- Fuel, Gas & Oil-Farm (Bulk) ---
  ['ENGEN',           'contains', 'Fuel, Gas & Oil-Farm (Bulk)',     0.90],
  ['SHELL',           'contains', 'Fuel, Gas & Oil-Farm (Bulk)',     0.80],
  ['PUMA ENERGY',     'contains', 'Fuel, Gas & Oil-Farm (Bulk)',     0.95],
  ['DIESEL',          'contains', 'Fuel, Gas & Oil-Farm (Bulk)',     0.90],
  ['FUEL',            'contains', 'Fuel, Gas & Oil-Farm (Bulk)',     0.85],
  ['PETROLEUM',       'contains', 'Fuel, Gas & Oil-Farm (Bulk)',     0.85],

  // --- Veterinary expenses ---
  ['VETERINARY',      'contains', 'Veterinary expenses',             0.95],
  ['VET ',            'contains', 'Veterinary expenses',             0.80],
  ['WINDHOEK VET',    'contains', 'Veterinary expenses',             0.95],
  ['OTJIWARONGO VET', 'contains', 'Veterinary expenses',             0.95],
  ['MEDICATION',      'contains', 'Veterinary expenses',             0.85],

  // --- Insurance ---
  ['INSURANCE',       'contains', 'Insurance',                       0.90],
  ['SANTAM',          'contains', 'Insurance',                       0.95],
  ['OLD MUTUAL',      'contains', 'Insurance',                       0.85],
  ['HOLLARD',         'contains', 'Insurance',                       0.95],

  // --- Electricity & Water ---
  ['NAMPOWER',        'contains', 'Electricity & Water',             0.95],
  ['NORED',           'contains', 'Electricity & Water',             0.95],
  ['ELECTRICITY',     'contains', 'Electricity & Water',             0.90],
  ['WATER AFFAIR',    'contains', 'Electricity & Water',             0.90],
  ['NAMWATER',        'contains', 'Electricity & Water',             0.95],

  // --- Rep. & Main. Vehicles ---
  ['AUTOHAUS',        'contains', 'Rep. & Main. Vehicles',          0.90],
  ['TOYOTA',          'contains', 'Rep. & Main. Vehicles',          0.85],
  ['PUPKEWITZ',       'contains', 'Rep. & Main. Vehicles',          0.80],
  ['TYRES',           'contains', 'Rep. & Main. Vehicles',          0.85],
  ['TYRE',            'contains', 'Rep. & Main. Vehicles',          0.85],

  // --- Repair Fence ---
  ['FENC',            'contains', 'Repair Fence',                    0.90],
  ['KRAAL',           'contains', 'Repair Fence',                    0.80],

  // --- Security Costs ---
  ['SECURITY',        'contains', 'Security Costs',                  0.85],
  ['G4S',             'contains', 'Security Costs',                  0.95],

  // --- Land Tax ---
  ['LAND TAX',        'contains', 'Land Tax',                        0.95],
  ['GRUNDSTEUER',     'contains', 'Land Tax',                        0.95],

  // --- Auditors Remuneration ---
  ['AUDIT',           'contains', 'Auditors Remuneration Erichsfelde & Pommersche', 0.90],
  ['ACCOUNTING',      'contains', 'Auditors Remuneration Erichsfelde & Pommersche', 0.85],

  // --- Consumables ---
  ['AGRA',            'contains', 'Consumables (pipe fittings, electrical etc.)', 0.80],
  ['HARDWARE',        'contains', 'Consumables (pipe fittings, electrical etc.)', 0.80],
  ['CASHBUILD',       'contains', 'Consumables (pipe fittings, electrical etc.)', 0.85],
  ['BUILD IT',        'contains', 'Consumables (pipe fittings, electrical etc.)', 0.85],

  // --- Rations/Store ---
  ['SPAR ',           'contains', 'Rations/Store',                   0.80],
  ['WOERMANN BROCK',  'contains', 'Rations/Store',                   0.85],
  ['SHOPRITE',        'contains', 'Rations/Store',                   0.80],

  // --- Membership Fees & Permits & General Licences ---
  ['MEMBERSHIP',      'contains', 'Membership Fees & Permits & General Licences', 0.90],
  ['NLU',             'contains', 'Membership Fees & Permits & General Licences', 0.85],
  ['PERMIT',          'contains', 'Membership Fees & Permits & General Licences', 0.85],

  // --- Transport ---
  ['TRANSPORT',       'contains', 'Transport',                       0.85],
  ['FREIGHT',         'contains', 'Transport',                       0.85],

  // --- Ammunition ---
  ['AMMUNITION',      'contains', 'Ammunition',                      0.95],
  ['SAFARI DEN',      'contains', 'Ammunition',                      0.85],

  // --- Livestock - Cattle (income / purchases) ---
  ['MEATCO',          'contains', 'Livestock - Cattle',              0.95],
  ['AUCTION',         'contains', 'Livestock - Cattle',              0.80],

  // --- Household Farm und Gäste ---
  ['HOUSEHOLD',       'contains', 'Household Farm und Gäste',       0.85],

  // --- Repair Building ---
  ['BUILDING REPAIR', 'contains', 'Repair Building',                 0.85],

  // --- Legal Fees ---
  ['LEGAL',           'contains', 'Legal Fees',                      0.85],
  ['ATTORNEY',        'contains', 'Legal Fees',                      0.90],
  ['ADVOCATE',        'contains', 'Legal Fees',                      0.90],
];

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const lines = [];
lines.push('-- ==========================================================================');
lines.push('-- category_rules — seed data for auto-categorising bank transactions');
lines.push(`-- Generated at: ${new Date().toISOString()}`);
lines.push('-- ==========================================================================');
lines.push('');

for (const [pattern, patternType, categoryName, confidence] of rules) {
  lines.push(
    `INSERT INTO category_rules (pattern, pattern_type, category_name, confidence, created_by)` +
    ` VALUES (${sqlStr(pattern)}, ${sqlStr(patternType)}, ${sqlStr(categoryName)}, ${confidence}, 'seed');`
  );
}

console.log(lines.join('\n'));
