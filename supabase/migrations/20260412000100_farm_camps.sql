-- Phase 0: Farm camps with PostGIS geometry
create table farm_camps (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  name text not null,
  parent_camp text,
  geom extensions.geometry(MultiPolygon, 4326),
  area_ha numeric generated always as (
    case when geom is not null then extensions.ST_Area(geom::extensions.geography) / 10000 else null end
  ) stored,
  purpose text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique(farm_id, name)
);

alter table farm_camps enable row level security;
create index idx_farm_camps_geom on farm_camps using gist(geom);
