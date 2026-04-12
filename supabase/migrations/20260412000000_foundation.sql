-- Phase 0: Foundation — PostGIS, farms, profiles
create extension if not exists postgis with schema extensions;

create table farms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  parent_entity text,
  active boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

insert into farms (name, parent_entity) values ('Erichsfelde', 'Pommersche Farmgesellschaft');

-- Helper function for default farm_id (PG disallows subqueries in DEFAULT)
create function default_farm_id() returns uuid language sql stable as $$
  select id from farms where name = 'Erichsfelde'
$$;

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  farm_id uuid not null references farms(id) default default_farm_id(),
  role text not null check (role in ('owner', 'manager', 'viewer')) default 'viewer',
  display_name text,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
