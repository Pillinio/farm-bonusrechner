-- Phase 4: Alert rules and history
create table alert_rules (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  kpi_id text not null,  -- e.g. 'F1', 'H3', 'W1'
  name text not null,
  condition_sql text not null,  -- SQL snippet that returns true/false
  threshold_yellow text,
  threshold_red text,
  active boolean default true,
  created_at timestamptz default now()
);

create table alert_history (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  rule_id uuid references alert_rules(id),
  kpi_id text not null,
  severity text not null check (severity in ('yellow', 'red')),
  message text not null,
  value_current text,
  acknowledged boolean default false,
  notified_at timestamptz default now(),
  acknowledged_at timestamptz
);

alter table alert_rules enable row level security;
alter table alert_history enable row level security;

-- Seed default alert rules for all KPIs
INSERT INTO alert_rules (kpi_id, name, condition_sql, threshold_yellow, threshold_red) VALUES
  ('F1', 'Cash Runway', 'months_coverage < threshold', '6', '3'),
  ('F2', 'Budget-Abweichung', 'max_deviation_pct > threshold', '10', '20'),
  ('H3', 'Mortalitätsrate', 'mortality_pct > threshold', '3', '5'),
  ('H4', 'Netto-Herdenwachstum', 'net_growth < threshold', '0', '-10'),
  ('W1', 'Besatzdichte', 'stocking_ratio > threshold', '85', '100'),
  ('K3', 'Consecutive Dry Days', 'dry_days > threshold', '45', '60'),
  ('O2', 'Offene Wartung', 'open_tickets > threshold', '3', '5'),
  ('C1', 'FMD-Zertifikat', 'days_until_expiry < threshold', '90', '60');
