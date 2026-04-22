-- Tighten SELECT policies from `using (true)` to farm-scoped.
-- Single-tenant today, but "jeder eingeloggte User sieht alle Farms" ist die
-- falsche Default-Haltung.
--
-- Betroffene Tabellen:
--   - compliance_certificates (hat farm_id) → direkt scopen
--   - herd_camp_assignments   (kein farm_id) → via herd_snapshots.farm_id
--   - slaughter_line_items    (kein farm_id) → via slaughter_reports.farm_id
--   - asset_status_reports    (kein farm_id) → via farm_assets.farm_id
--   - task_executions         (kein farm_id) → via task_templates.farm_id
--
-- Zusatz: farm_calendar owner_delete/update war nicht farm-scoped — Owner
-- könnten Einträge anderer Farms löschen. Jetzt: farm_id = auth_farm_id().

-- =========================================================================
-- compliance_certificates — direct farm_id
-- =========================================================================
drop policy if exists "authenticated_read" on compliance_certificates;
create policy "farm_read" on compliance_certificates for select to authenticated
  using (farm_id = auth_farm_id());

-- =========================================================================
-- herd_camp_assignments — via herd_snapshots
-- =========================================================================
drop policy if exists "authenticated_read" on herd_camp_assignments;
create policy "farm_read" on herd_camp_assignments for select to authenticated
  using (
    exists (
      select 1 from herd_snapshots hs
      where hs.id = herd_camp_assignments.snapshot_id
        and hs.farm_id = auth_farm_id()
    )
  );

-- =========================================================================
-- slaughter_line_items — via slaughter_reports
-- =========================================================================
drop policy if exists "authenticated_read" on slaughter_line_items;
create policy "farm_read" on slaughter_line_items for select to authenticated
  using (
    exists (
      select 1 from slaughter_reports sr
      where sr.id = slaughter_line_items.report_id
        and sr.farm_id = auth_farm_id()
    )
  );

-- =========================================================================
-- asset_status_reports — via farm_assets
-- =========================================================================
drop policy if exists "authenticated_read" on asset_status_reports;
create policy "farm_read" on asset_status_reports for select to authenticated
  using (
    exists (
      select 1 from farm_assets fa
      where fa.id = asset_status_reports.asset_id
        and fa.farm_id = auth_farm_id()
    )
  );

-- =========================================================================
-- task_executions — via task_templates
-- =========================================================================
drop policy if exists "authenticated_read" on task_executions;
create policy "farm_read" on task_executions for select to authenticated
  using (
    exists (
      select 1 from task_templates tt
      where tt.id = task_executions.template_id
        and tt.farm_id = auth_farm_id()
    )
  );

-- =========================================================================
-- M6: farm_calendar owner delete/update — farm-scoped
-- =========================================================================
-- Owner-Zweig bisher: nur Role-Check, kein farm_id. Ein Owner kann Einträge
-- anderer Farms löschen/updaten. Wir scopen Owner-Aktionen jetzt auf die
-- eigene Farm und lassen den Requester-Zweig unverändert (inkl. private_block-
-- Ausnahme aus 20260420000100).
drop policy if exists "farm_update" on farm_calendar;
create policy "farm_update" on farm_calendar for update to authenticated
  using (
    (
      (select role from profiles where id = auth.uid()) = 'owner'
      and farm_id = (select farm_id from profiles where id = auth.uid())
    )
    or (
      farm_id = (select farm_id from profiles where id = auth.uid())
      and requested_by = auth.uid()
      and (status = 'requested' or entry_type = 'private_block')
    )
  );

drop policy if exists "farm_delete" on farm_calendar;
create policy "farm_delete" on farm_calendar for delete to authenticated
  using (
    (
      (select role from profiles where id = auth.uid()) = 'owner'
      and farm_id = (select farm_id from profiles where id = auth.uid())
    )
    or (
      farm_id = (select farm_id from profiles where id = auth.uid())
      and requested_by = auth.uid()
      and (status = 'requested' or entry_type = 'private_block')
    )
  );
