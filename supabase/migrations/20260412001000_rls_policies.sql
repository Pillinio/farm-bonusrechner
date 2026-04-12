-- RLS Policies for all tables
-- Ensures authenticated users can access data scoped to their farm.
-- Role hierarchy: owner > manager > viewer (all can read, write varies)

-- Helper: get current user's farm_id from profiles
-- Used in USING/WITH CHECK clauses to scope data per farm.
create or replace function auth_farm_id() returns uuid language sql stable security definer as $$
  select farm_id from profiles where id = auth.uid()
$$;

-- Helper: get current user's role from profiles
create or replace function auth_role() returns text language sql stable security definer as $$
  select role from profiles where id = auth.uid()
$$;

-- =========================================================================
-- A. Public read (any authenticated user) — no farm scoping
-- =========================================================================

-- market_prices: global reference data
create policy "authenticated_read" on market_prices
  for select to authenticated using (true);

create policy "service_insert" on market_prices
  for insert to service_role with check (true);

create policy "service_update" on market_prices
  for update to service_role using (true) with check (true);

-- weather_observations: farm-scoped but readable by authenticated
create policy "authenticated_read" on weather_observations
  for select to authenticated using (true);

create policy "farm_insert" on weather_observations
  for insert to authenticated with check (farm_id = auth_farm_id());

create policy "farm_update" on weather_observations
  for update to authenticated using (farm_id = auth_farm_id()) with check (farm_id = auth_farm_id());

-- carrying_capacity_assumptions: farm-scoped reference data
create policy "authenticated_read" on carrying_capacity_assumptions
  for select to authenticated using (true);

create policy "owner_insert" on carrying_capacity_assumptions
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() = 'owner');

create policy "owner_update" on carrying_capacity_assumptions
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner')
  with check (farm_id = auth_farm_id() and auth_role() = 'owner');

-- alert_rules: farm-scoped but readable
create policy "authenticated_read" on alert_rules
  for select to authenticated using (true);

create policy "owner_insert" on alert_rules
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() = 'owner');

create policy "owner_update" on alert_rules
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner')
  with check (farm_id = auth_farm_id() and auth_role() = 'owner');

create policy "owner_delete" on alert_rules
  for delete to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- =========================================================================
-- B. Farm-scoped read + manager write
-- =========================================================================

-- farm_camps
create policy "farm_read" on farm_camps
  for select to authenticated using (farm_id = auth_farm_id());

create policy "farm_insert" on farm_camps
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'));

create policy "farm_update" on farm_camps
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'))
  with check (farm_id = auth_farm_id());

-- herd_snapshots
create policy "farm_read" on herd_snapshots
  for select to authenticated using (farm_id = auth_farm_id());

create policy "farm_insert" on herd_snapshots
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'));

create policy "farm_update" on herd_snapshots
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'))
  with check (farm_id = auth_farm_id());

-- herd_camp_assignments (no farm_id — join through camp_id)
-- For simplicity, allow authenticated read and manager write
create policy "authenticated_read" on herd_camp_assignments
  for select to authenticated using (true);

create policy "manager_insert" on herd_camp_assignments
  for insert to authenticated with check (auth_role() in ('owner', 'manager'));

create policy "manager_update" on herd_camp_assignments
  for update to authenticated using (auth_role() in ('owner', 'manager'))
  with check (auth_role() in ('owner', 'manager'));

-- veld_observations
create policy "farm_read" on veld_observations
  for select to authenticated using (farm_id = auth_farm_id());

create policy "farm_insert" on veld_observations
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'));

create policy "farm_update" on veld_observations
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'))
  with check (farm_id = auth_farm_id());

-- asset_status_reports (no farm_id — join through asset)
create policy "authenticated_read" on asset_status_reports
  for select to authenticated using (true);

create policy "manager_insert" on asset_status_reports
  for insert to authenticated with check (auth_role() in ('owner', 'manager'));

create policy "manager_update" on asset_status_reports
  for update to authenticated using (auth_role() in ('owner', 'manager'))
  with check (auth_role() in ('owner', 'manager'));

-- task_executions (no farm_id — join through template)
create policy "authenticated_read" on task_executions
  for select to authenticated using (true);

create policy "manager_insert" on task_executions
  for insert to authenticated with check (auth_role() in ('owner', 'manager'));

create policy "manager_update" on task_executions
  for update to authenticated using (auth_role() in ('owner', 'manager'))
  with check (auth_role() in ('owner', 'manager'));

-- incidents
create policy "farm_read" on incidents
  for select to authenticated using (farm_id = auth_farm_id());

create policy "farm_insert" on incidents
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'));

create policy "farm_update" on incidents
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'))
  with check (farm_id = auth_farm_id());

-- farm_assets
create policy "farm_read" on farm_assets
  for select to authenticated using (farm_id = auth_farm_id());

create policy "farm_insert" on farm_assets
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'));

create policy "farm_update" on farm_assets
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() in ('owner', 'manager'))
  with check (farm_id = auth_farm_id());

-- =========================================================================
-- C. Farm-scoped read + owner-only write
-- =========================================================================

-- budgets
create policy "farm_read" on budgets
  for select to authenticated using (farm_id = auth_farm_id());

create policy "owner_insert" on budgets
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() = 'owner');

create policy "owner_update" on budgets
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner')
  with check (farm_id = auth_farm_id());

create policy "owner_delete" on budgets
  for delete to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- bonus_parameters
create policy "farm_read" on bonus_parameters
  for select to authenticated using (farm_id = auth_farm_id());

create policy "owner_insert" on bonus_parameters
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() = 'owner');

create policy "owner_update" on bonus_parameters
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner')
  with check (farm_id = auth_farm_id());

create policy "owner_delete" on bonus_parameters
  for delete to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- category_rules
create policy "farm_read" on category_rules
  for select to authenticated using (farm_id = auth_farm_id());

create policy "owner_insert" on category_rules
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() = 'owner');

create policy "owner_update" on category_rules
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner')
  with check (farm_id = auth_farm_id());

create policy "owner_delete" on category_rules
  for delete to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- task_templates
create policy "farm_read" on task_templates
  for select to authenticated using (farm_id = auth_farm_id());

create policy "owner_insert" on task_templates
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() = 'owner');

create policy "owner_update" on task_templates
  for update to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner')
  with check (farm_id = auth_farm_id());

create policy "owner_delete" on task_templates
  for delete to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- alert_history
create policy "farm_read" on alert_history
  for select to authenticated using (farm_id = auth_farm_id());

create policy "owner_insert" on alert_history
  for insert to authenticated with check (farm_id = auth_farm_id() and auth_role() = 'owner');

-- Service role also needs to insert alert_history (from alerts edge function)
create policy "service_insert" on alert_history
  for insert to service_role with check (true);

create policy "owner_delete" on alert_history
  for delete to authenticated using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- profiles: users can read/update only their own row
create policy "own_read" on profiles
  for select to authenticated using (id = auth.uid());

create policy "own_update" on profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- =========================================================================
-- D. Service-role only write (ingested data)
-- =========================================================================

-- raw_events
create policy "farm_read" on raw_events
  for select to authenticated using (farm_id = auth_farm_id());

create policy "service_insert" on raw_events
  for insert to service_role with check (true);

create policy "service_update" on raw_events
  for update to service_role using (true) with check (true);

-- transactions
create policy "farm_read" on transactions
  for select to authenticated using (farm_id = auth_farm_id());

create policy "service_insert" on transactions
  for insert to service_role with check (true);

create policy "service_update" on transactions
  for update to service_role using (true) with check (true);

-- account_balances
create policy "farm_read" on account_balances
  for select to authenticated using (farm_id = auth_farm_id());

create policy "service_insert" on account_balances
  for insert to service_role with check (true);

create policy "service_update" on account_balances
  for update to service_role using (true) with check (true);

-- slaughter_reports
create policy "farm_read" on slaughter_reports
  for select to authenticated using (farm_id = auth_farm_id());

create policy "service_insert" on slaughter_reports
  for insert to service_role with check (true);

create policy "service_update" on slaughter_reports
  for update to service_role using (true) with check (true);

-- slaughter_line_items (no farm_id — join through report)
create policy "authenticated_read" on slaughter_line_items
  for select to authenticated using (true);

create policy "service_insert" on slaughter_line_items
  for insert to service_role with check (true);

create policy "service_update" on slaughter_line_items
  for update to service_role using (true) with check (true);

-- =========================================================================
-- Special: farms table
-- =========================================================================

-- farms: any authenticated user can read, no user-facing write
create policy "authenticated_read" on farms
  for select to authenticated using (true);

-- Note: farms table did not have RLS enabled in foundation migration.
-- Enable it now for consistency.
alter table farms enable row level security;

-- =========================================================================
-- payload_hash column for idempotency (used by ingest edge function)
-- =========================================================================

alter table raw_events add column if not exists payload_hash text;
create unique index if not exists raw_events_payload_hash_idx on raw_events (payload_hash) where payload_hash is not null;
