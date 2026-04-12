-- Phase 0: Herd management
create table herd_snapshots (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  snapshot_date date not null,
  cows integer not null default 0,
  bulls integer not null default 0,
  heifers integer not null default 0,
  calves integer not null default 0,
  oxen integer not null default 0,
  total_lsu numeric,
  births integer default 0,
  deaths integer default 0,
  sales integer default 0,
  purchases integer default 0,
  photos_ref jsonb,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(farm_id, snapshot_date)
);

create table herd_camp_assignments (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references herd_snapshots(id) on delete cascade,
  camp_id uuid not null references farm_camps(id),
  estimated_animals integer,
  estimated_days integer,
  created_at timestamptz default now(),
  unique(snapshot_id, camp_id)
);

create table veld_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  snapshot_date date not null,
  camp_name text not null,
  condition_score integer not null check (condition_score between 1 and 5),
  notes text,
  photos_ref jsonb,
  created_at timestamptz default now(),
  unique(farm_id, snapshot_date, camp_name)
);

alter table herd_snapshots enable row level security;
alter table herd_camp_assignments enable row level security;
alter table veld_observations enable row level security;
