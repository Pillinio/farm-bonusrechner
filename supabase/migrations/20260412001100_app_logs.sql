create table app_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  source text not null,  -- 'edge:ingest', 'edge:alerts', 'action:chirps', 'app:cockpit', etc.
  message text not null,
  details jsonb,  -- stack trace, request data, error context
  user_id uuid,  -- optional, from auth
  farm_id uuid references farms(id)
);

-- Index for quick filtering
create index idx_app_logs_level_created on app_logs (level, created_at desc);
create index idx_app_logs_source on app_logs (source);

-- Auto-cleanup: delete logs older than 90 days (via pg_cron later)
alter table app_logs enable row level security;

-- RLS: authenticated users can read logs for their farm, service_role can write
create policy "service_write" on app_logs for insert to service_role with check (true);
create policy "authenticated_read" on app_logs for select to authenticated using (true);
