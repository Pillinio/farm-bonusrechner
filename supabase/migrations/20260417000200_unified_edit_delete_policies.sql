-- Einheitliche Edit/Delete-Rechte über alle im Tool editierbaren/löschbaren Tabellen.
--
-- Regel:
--   - DELETE: ausschliesslich 'owner' (farm-scoped wo möglich).
--   - UPDATE: wie bisher 'owner' oder 'manager' (farm-scoped).
--
-- Hintergrund:
--   Einige Tabellen (herd_snapshots, veld_observations, asset_status_reports,
--   task_executions, incidents) hatten gar keine DELETE-Policy → Supabase
--   blockte stillschweigend und das Frontend meldete trotzdem "gelöscht".
--   Andere (farm_employees, work_entries, herd_movements, cattle_trade_plans,
--   market_prices) erlaubten DELETE für jeden farm-scoped authenticated User;
--   das wird auf 'owner' eingeengt.
--
-- farm_calendar behält seine Sonderregel (Commit 084ef54): owner delete +
-- requester darf eigene 'requested'-Einträge löschen. Das ist Workflow-spezifisch
-- und nicht Teil dieser Vereinheitlichung.

-- =========================================================================
-- 1. herd_snapshots — Monatsmeldung Parent
-- =========================================================================
drop policy if exists "owner_delete" on herd_snapshots;
create policy "owner_delete" on herd_snapshots for delete to authenticated
  using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- =========================================================================
-- 2. veld_observations — Monatsmeldung Child (Weide-Bewertungen)
-- =========================================================================
drop policy if exists "owner_delete" on veld_observations;
create policy "owner_delete" on veld_observations for delete to authenticated
  using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- =========================================================================
-- 3. asset_status_reports — Monatsmeldung Child (Bohrloch-/Damm-Status)
--    Keine farm_id-Spalte; Scope über asset_id → farm_assets.
-- =========================================================================
drop policy if exists "owner_delete" on asset_status_reports;
create policy "owner_delete" on asset_status_reports for delete to authenticated
  using (
    auth_role() = 'owner'
    and exists (
      select 1 from farm_assets fa
      where fa.id = asset_status_reports.asset_id
        and fa.farm_id = auth_farm_id()
    )
  );

-- =========================================================================
-- 4. task_executions — Monatsmeldung Child (Task-Ausführungen)
--    Keine farm_id-Spalte; Scope über template_id → task_templates.
-- =========================================================================
drop policy if exists "owner_delete" on task_executions;
create policy "owner_delete" on task_executions for delete to authenticated
  using (
    auth_role() = 'owner'
    and exists (
      select 1 from task_templates tt
      where tt.id = task_executions.template_id
        and tt.farm_id = auth_farm_id()
    )
  );

-- =========================================================================
-- 5. incidents — Monatsmeldung Child (Vorfälle)
-- =========================================================================
drop policy if exists "owner_delete" on incidents;
create policy "owner_delete" on incidents for delete to authenticated
  using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- =========================================================================
-- 6. farm_employees — Delete tightenen (vorher: alle farm-scoped)
-- =========================================================================
drop policy if exists "farm_delete" on farm_employees;
drop policy if exists "owner_delete" on farm_employees;
create policy "owner_delete" on farm_employees for delete to authenticated
  using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- =========================================================================
-- 7. work_entries — Delete tightenen
-- =========================================================================
drop policy if exists "farm_delete" on work_entries;
drop policy if exists "owner_delete" on work_entries;
create policy "owner_delete" on work_entries for delete to authenticated
  using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- =========================================================================
-- 8. herd_movements — Delete tightenen
-- =========================================================================
drop policy if exists "farm_delete" on herd_movements;
drop policy if exists "owner_delete" on herd_movements;
create policy "owner_delete" on herd_movements for delete to authenticated
  using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- =========================================================================
-- 9. cattle_trade_plans — Delete tightenen
-- =========================================================================
drop policy if exists "farm_delete" on cattle_trade_plans;
drop policy if exists "owner_delete" on cattle_trade_plans;
create policy "owner_delete" on cattle_trade_plans for delete to authenticated
  using (farm_id = auth_farm_id() and auth_role() = 'owner');

-- =========================================================================
-- 10. market_prices — Delete tightenen (vorher: "true", jeder authenticated)
-- =========================================================================
drop policy if exists "authenticated_delete" on market_prices;
drop policy if exists "owner_delete" on market_prices;
create policy "owner_delete" on market_prices for delete to authenticated
  using (auth_role() = 'owner');

-- =========================================================================
-- 11. Edit-Audit auf herd_snapshots (Monatsmeldung)
--     Spalten + Trigger: updated_by, edit_count, updated_at.
-- =========================================================================
alter table herd_snapshots
  add column if not exists updated_by uuid references profiles(id);

alter table herd_snapshots
  add column if not exists edit_count integer not null default 0;

-- updated_at existiert bereits (default now()), wird beim INSERT gesetzt.
-- Trigger: bei UPDATE aktualisieren wir updated_at, updated_by, edit_count.
create or replace function bump_herd_snapshot_audit()
returns trigger
language plpgsql
security definer
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  new.edit_count := coalesce(old.edit_count, 0) + 1;
  return new;
end;
$$;

drop trigger if exists trg_herd_snapshots_audit on herd_snapshots;
create trigger trg_herd_snapshots_audit
  before update on herd_snapshots
  for each row
  execute function bump_herd_snapshot_audit();
