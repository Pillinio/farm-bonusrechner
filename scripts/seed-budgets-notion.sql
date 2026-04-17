-- Budget plan data from Notion export (Kosten Budget)
-- Source: Erichsfelde 2023 budget, imported as baseline for 2026
-- Only plan values (Ist-Zahlen kommen aus Kontoauszügen)

BEGIN;

-- Clear existing budget plans for current year (month=0 = annual plan)
DELETE FROM budgets WHERE fiscal_year = 2026 AND month = 0;

-- Insert budget plan categories
-- Format: (fiscal_year, month, category, planned_nad, actual_nad)
-- month=0 means annual total plan
INSERT INTO budgets (fiscal_year, month, category, planned_nad, actual_nad) VALUES
  (2026, 0, 'Ammunition',                          7000,    0),
  (2026, 0, 'Auditors Remuneration',             150000,    0),
  (2026, 0, 'Bank Charges',                       13200,    0),
  (2026, 0, 'Bookkeeping Fees',                   48000,    0),
  (2026, 0, 'Bullen einkaufen',                   50000,    0),
  (2026, 0, 'Bush Clearing / Eradication',       410000,    0),
  (2026, 0, 'Consumables & Small Tools',          18000,    0),
  (2026, 0, 'Electricity & Water',                72000,    0),
  (2026, 0, 'Farm Management Equipment',          47900,    0),
  (2026, 0, 'Fodder & Lick',                     330000,    0),
  (2026, 0, 'Fuel, Gas & Oil (Bulk)',            300000,    0),
  (2026, 0, 'Household Farm & Gäste',             18000,    0),
  (2026, 0, 'Insurance',                          40000,    0),
  (2026, 0, 'Land Tax',                           70000,    0),
  (2026, 0, 'Livestock - Cattle Purchase',       855000,    0),
  (2026, 0, 'Membership Fees & Permits',          15000,    0),
  (2026, 0, 'Rations / Store',                     3000,    0),
  (2026, 0, 'Repair Building',                     5000,    0),
  (2026, 0, 'Repair Fence',                       80000,    0),
  (2026, 0, 'Repair Machine & Plant',             45000,    0),
  (2026, 0, 'Repairs Water Installation',         70000,    0),
  (2026, 0, 'Rep. & Maint. Vehicles',            96000,    0),
  (2026, 0, 'Salaries Farm Workers & Welfare',   378300,    0),
  (2026, 0, 'Salaries Jacobi Family',            324000,    0),
  (2026, 0, 'Security Costs',                     43200,    0),
  (2026, 0, 'Small Tools',                        10000,    0),
  (2026, 0, 'Social Security',                     6000,    0),
  (2026, 0, 'Staff Training & Consulting',        15000,    0),
  (2026, 0, 'Transport',                          14000,    0),
  (2026, 0, 'Unexpected',                         40000,    0),
  (2026, 0, 'Veterinary Expenses',                48000,    0);

COMMIT;

-- Total budget: N$ 3,247,600
-- 31 categories (Gemeinkosten + Einzelkosten)
