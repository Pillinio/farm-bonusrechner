-- Erweitert rollback_import(): löscht auch den verknüpften raw_events-Eintrag
-- (falls vorhanden). So kann dieselbe PDF nach einem Rollback ohne
-- „duplicate payload"-Block erneut ingested werden.

create or replace function rollback_import(p_import_id uuid)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_import record;
  v_market_deleted int;
  v_slaughter_deleted int;
  v_lines_deleted int;
  v_raw_event_deleted int := 0;
begin
  select * into v_import from data_imports where id = p_import_id for update;
  if not found then
    return jsonb_build_object('error', 'import not found');
  end if;

  if v_import.status = 'rolled_back' then
    return jsonb_build_object('error', 'import already rolled back');
  end if;

  with d as (
    delete from market_prices where data_import_id = p_import_id returning 1
  )
  select count(*) into v_market_deleted from d;

  select coalesce(sum((select count(*) from slaughter_line_items where report_id = sr.id)), 0)
    into v_lines_deleted
  from slaughter_reports sr
  where sr.data_import_id = p_import_id;

  with d as (
    delete from slaughter_reports where data_import_id = p_import_id returning 1
  )
  select count(*) into v_slaughter_deleted from d;

  -- raw_events (falls verlinkt) entfernen, damit eine Re-Ingestion nicht als Dupe blockiert
  if v_import.raw_event_id is not null then
    delete from raw_events where id = v_import.raw_event_id;
    get diagnostics v_raw_event_deleted = row_count;
  end if;

  update data_imports
     set status = 'rolled_back',
         notes = coalesce(notes, '') ||
                 case when notes is null then '' else E'\n' end ||
                 'Rolled back at ' || now()::text
   where id = p_import_id;

  return jsonb_build_object(
    'import_id', p_import_id,
    'market_prices_deleted', v_market_deleted,
    'slaughter_reports_deleted', v_slaughter_deleted,
    'slaughter_line_items_deleted', v_lines_deleted,
    'raw_events_deleted', v_raw_event_deleted
  );
end;
$$;
