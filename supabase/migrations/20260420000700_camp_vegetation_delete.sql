-- M12: camp_vegetation hat read/insert/update farm-scoped, aber keine
-- DELETE-Policy — Fehl-Imports lassen sich nicht bereinigen. Einheitliches
-- Muster: DELETE für 'owner', farm-scoped.

drop policy if exists "owner_delete" on camp_vegetation;
create policy "owner_delete" on camp_vegetation for delete to authenticated
  using (farm_id = auth_farm_id() and auth_role() = 'owner');
