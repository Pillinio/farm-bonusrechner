-- Seed-Stammdaten: carrying_capacity_assumptions, task_templates, farm_assets, bonus_parameters
-- Erstellt: 2026-04-12
-- Alle Tabellen nutzen default_farm_id() als farm_id-Default.

BEGIN;

-- ============================================================
-- 1. carrying_capacity_assumptions
-- ============================================================
INSERT INTO carrying_capacity_assumptions (effective_from, rain_year_type, lsu_per_ha, notes) VALUES
  ('2024-01-01', 'poor',   0.05, 'Trockenzeit/Dürre: konservative Besatzdichte'),
  ('2024-01-01', 'normal', 0.07, 'Normales Regenjahr: Standard-Besatzdichte Erichsfelde'),
  ('2024-01-01', 'good',   0.10, 'Gutes Regenjahr: erhöhte Kapazität möglich');

-- ============================================================
-- 2. task_templates
-- ============================================================
INSERT INTO task_templates (name, category, frequency, target_scope, description) VALUES
  ('Lumpy Skin Impfung',   'vaccination',  'annually',   'all_cattle', 'Jährliche Impfung gegen Lumpy Skin Disease, September-Oktober'),
  ('Anthrax Impfung',      'vaccination',  'annually',   'all_cattle', 'Jährliche Milzbrand-Impfung, Oktober vor Regensaison'),
  ('Blackleg Impfung',     'vaccination',  'annually',   'calves',     'Rauschbrand-Impfung für Kälber ab 3 Monaten'),
  ('Botulismus Impfung',   'vaccination',  'annually',   'all_cattle', 'Jährliche Botulismus-Impfung'),
  ('Brucellose-Test',      'vaccination',  'as_needed',  'cows',       'Brucellose-Bluttest alle 24 Monate, Pflicht für EU-Export'),
  ('Entwurmung',           'deworming',    'quarterly',  'all_cattle', 'Quartalsweise Entwurmung der gesamten Herde'),
  ('Zaunkontrolle',        'inspection',   'monthly',    'all_cattle', 'Monatliche Kontrolle aller Camp-Zäune auf Schäden'),
  ('Bohrloch-Inspektion',  'maintenance',  'monthly',    'all_cattle', 'Monatliche Prüfung Durchfluss und Pumpenleistung aller Bohrlöcher'),
  ('Fahrzeug-Service',     'maintenance',  'quarterly',  'all_cattle', 'Quartalsweiser Service für Pickups und Farmfahrzeuge'),
  ('Herdenmusterung',      'inspection',   'monthly',    'all_cattle', 'Monatliche Gesamtzählung und Zustandskontrolle');

-- ============================================================
-- 3. farm_assets  (rain stations, boreholes, dams)
-- ============================================================

-- Regenstationen (aus Excel-Wetterdaten)
INSERT INTO farm_assets (asset_type, name, metadata) VALUES
  ('rain_station', 'Haus',       '{"source": "manual", "notes": "Farmhaus-Regenstation"}'),
  ('rain_station', 'Ubei',       '{"source": "manual"}'),
  ('rain_station', 'Hackl',      '{"source": "manual"}'),
  ('rain_station', 'Berg',       '{"source": "manual", "camp_ref": "Berg-Kamp"}'),
  ('rain_station', 'Schimon',    '{"source": "manual"}'),
  ('rain_station', 'S/Wasser',   '{"source": "cumulative"}'),
  ('rain_station', 'Vernit',     '{"source": "cumulative"}'),
  ('rain_station', 'Oberlaber',  '{"source": "cumulative"}'),
  ('rain_station', 'Springbock', '{"source": "cumulative", "camp_ref": "Springbock-Kamp"}'),
  ('rain_station', 'Onkatsgau',  '{"source": "cumulative"}');

-- Bohrlöcher und Dämme (Platzhalter, wird vom Verwalter verfeinert)
INSERT INTO farm_assets (asset_type, name, metadata) VALUES
  ('borehole', 'Bohrloch Hof',  '{"depth_m": null, "pump_type": "submersible"}'),
  ('borehole', 'Bohrloch Berg', '{"depth_m": null, "pump_type": "submersible"}'),
  ('borehole', 'Bohrloch Kudu', '{"depth_m": null, "pump_type": "wind"}'),
  ('dam',      'Hauptdamm',     '{"capacity_m3": null}'),
  ('dam',      'Viehdamm Süd',  '{"capacity_m3": null}');

-- ============================================================
-- 4. bonus_parameters  (Default-Werte aus bonus-engine.js / bonus-defaults edge function)
-- ============================================================
INSERT INTO bonus_parameters (effective_from, params) VALUES
  ('2024-01-01', '{
    "tier1Rate": 8,
    "tier2Rate": 12,
    "tier3Rate": 15,
    "tier4Rate": 20,
    "tier1Limit": 100000,
    "tier2Limit": 500000,
    "tier3Limit": 2000000,
    "ebitCap": 4,
    "ebitWeight": 70,
    "prodThresholdCritical": 15,
    "prodThresholdOk": 20,
    "prodThresholdGood": 25,
    "prodFactorCritical": 0,
    "prodFactorOk": 1.0,
    "prodFactorGood": 1.5,
    "prodFactorExcellent": 2.0,
    "baseSalary": 700000
  }');

COMMIT;
