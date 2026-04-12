-- Phase 0: Raw event log for ingest audit trail
create table raw_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  kind text not null,
  source text not null,
  payload jsonb not null,
  status text not null check (status in ('ok', 'error', 'duplicate')) default 'ok',
  error_message text,
  records_inserted integer default 0,
  created_at timestamptz default now()
);

create index idx_raw_events_kind on raw_events(kind);
create index idx_raw_events_created_at on raw_events(created_at);

alter table raw_events enable row level security;
