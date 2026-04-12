-- Phase 0: Financial tables
create table budgets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  fiscal_year integer not null,
  month integer not null check (month between 0 and 12),  -- 0 = annual summary
  category text not null,
  planned_nad numeric not null default 0,
  actual_nad numeric not null default 0,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(farm_id, fiscal_year, month, category)
);

create table account_balances (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  balance_date date not null,
  account_name text not null default 'Main',
  balance_nad numeric not null,
  created_at timestamptz default now(),
  unique(farm_id, balance_date, account_name)
);

create table category_rules (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  pattern text not null,
  pattern_type text not null check (pattern_type in ('exact', 'contains', 'regex')) default 'contains',
  category_name text not null,
  confidence numeric check (confidence between 0 and 1) default 0.9,
  created_by text,
  created_at timestamptz default now(),
  unique(farm_id, pattern, pattern_type)
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  transaction_date date not null,
  description text not null,
  amount_nad numeric not null,
  category text,
  counterparty text,
  reference text,
  source text default 'manual',
  raw_event_id uuid,
  created_at timestamptz default now()
);

alter table budgets enable row level security;
alter table account_balances enable row level security;
alter table category_rules enable row level security;
alter table transactions enable row level security;
