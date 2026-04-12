-- Phase 0: Weather, carrying capacity, farm assets
create table weather_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  station_name text not null,
  observation_date date not null,
  rainfall_mm numeric,
  temperature_max_c numeric,
  temperature_min_c numeric,
  source text default 'manual',
  created_at timestamptz default now(),
  unique(farm_id, station_name, observation_date)
);

create table carrying_capacity_assumptions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  effective_from date not null,
  effective_to date,
  rain_year_type text check (rain_year_type in ('poor', 'normal', 'good')) default 'normal',
  lsu_per_ha numeric not null,
  notes text,
  created_at timestamptz default now()
);

create table farm_assets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  asset_type text not null check (asset_type in ('borehole', 'dam', 'fence', 'vehicle', 'rain_station', 'other')),
  name text not null,
  location extensions.geometry(Point, 4326),
  metadata jsonb,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(farm_id, asset_type, name)
);

create table asset_status_reports (
  id uuid primary key default gen_random_uuid(),
  asset_id uuid not null references farm_assets(id) on delete cascade,
  report_date date not null,
  status text not null check (status in ('green', 'yellow', 'red', 'offline')),
  metric_value numeric,
  notes text,
  created_at timestamptz default now(),
  unique(asset_id, report_date)
);

alter table weather_observations enable row level security;
alter table carrying_capacity_assumptions enable row level security;
alter table farm_assets enable row level security;
alter table asset_status_reports enable row level security;
