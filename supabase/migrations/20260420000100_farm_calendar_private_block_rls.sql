-- private_block-Einträge werden beim Anlegen direkt auf status='approved' gesetzt
-- (kein Genehmigungs-Workflow, reiner Informations-Eintrag). Die bestehende RLS
-- erlaubt Requestern jedoch nur Update/Delete solange status='requested' —
-- wodurch private_block nach dem Anlegen sofort für den Eigentümer gesperrt war.
--
-- Fix: Requester darf eigene private_block-Einträge immer bearbeiten/löschen.
-- Für alle anderen entry_types bleibt der bisherige Genehmigungs-Workflow.

drop policy if exists "farm_update" on farm_calendar;
create policy "farm_update" on farm_calendar for update to authenticated
  using (
    (select role from profiles where id = auth.uid()) = 'owner'
    or (
      farm_id = (select farm_id from profiles where id = auth.uid())
      and requested_by = auth.uid()
      and (status = 'requested' or entry_type = 'private_block')
    )
  );

drop policy if exists "farm_delete" on farm_calendar;
create policy "farm_delete" on farm_calendar for delete to authenticated
  using (
    (select role from profiles where id = auth.uid()) = 'owner'
    or (
      farm_id = (select farm_id from profiles where id = auth.uid())
      and requested_by = auth.uid()
      and (status = 'requested' or entry_type = 'private_block')
    )
  );
