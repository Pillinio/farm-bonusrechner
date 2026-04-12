-- Phase 0: Slaughter reports and market prices
create table slaughter_reports (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  report_date date not null,
  statement_number text,
  total_animals integer,
  total_cold_mass_kg numeric,
  total_gross_nad numeric,
  total_deductions_nad numeric,
  total_net_nad numeric,
  source text default 'manual',
  raw_pdf_ref text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table slaughter_line_items (
  id uuid primary key default gen_random_uuid(),
  report_id uuid not null references slaughter_reports(id) on delete cascade,
  ear_tag_id text,
  grade text,
  gender text check (gender in ('COW', 'BULL', 'OX', 'HEIFER', 'CALF')),
  cold_mass_kg numeric not null,
  announced_price_per_kg numeric,
  bruising_deduction_nad numeric default 0,
  condemnation_deduction_nad numeric default 0,
  hide_value_nad numeric default 0,
  gross_price_per_kg numeric,
  gross_proceeds_nad numeric,
  created_at timestamptz default now()
);

create table market_prices (
  id uuid primary key default gen_random_uuid(),
  price_date date not null,
  commodity text not null,
  price_nad numeric not null,
  unit text not null,
  source text,
  created_at timestamptz default now(),
  unique(price_date, commodity)
);

alter table slaughter_reports enable row level security;
alter table slaughter_line_items enable row level security;
alter table market_prices enable row level security;
