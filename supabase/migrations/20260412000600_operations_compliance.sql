-- Phase 0: Operations, compliance, bonus parameters
create table task_templates (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  name text not null,
  category text not null check (category in ('vaccination', 'deworming', 'inspection', 'maintenance', 'other')),
  frequency text,
  target_scope text,
  description text,
  active boolean default true,
  created_at timestamptz default now()
);

create table task_executions (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references task_templates(id) on delete cascade,
  executed_date date not null,
  covered_count integer,
  target_count integer,
  notes text,
  executed_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table incidents (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  incident_date date not null,
  incident_type text not null check (incident_type in ('theft', 'predator', 'accident', 'disease', 'injury', 'other')),
  severity text check (severity in ('low', 'medium', 'high', 'critical')) default 'medium',
  affected_count integer default 0,
  estimated_loss_nad numeric default 0,
  description text,
  resolution text,
  reported_by uuid references profiles(id),
  created_at timestamptz default now()
);

create table bonus_parameters (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  effective_from date not null,
  effective_to date,
  params jsonb not null,
  created_at timestamptz default now(),
  unique(farm_id, effective_from)
);

alter table task_templates enable row level security;
alter table task_executions enable row level security;
alter table incidents enable row level security;
alter table bonus_parameters enable row level security;
