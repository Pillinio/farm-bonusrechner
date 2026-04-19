-- Import-Lineage: verknüpft jede importierte Zeile mit ihrem data_imports-Eintrag.
-- Ermöglicht sauberes Rollback ("Rückgängig machen") eines ganzen Imports.
-- Regel: bei Rollback wird der data_imports-Eintrag behalten (status='rolled_back'),
-- aber alle verknüpften Daten-Zeilen werden physisch gelöscht.

-- ─── FK-Spalten auf den Daten-Tabellen ─────────────────────────────────────
alter table market_prices
  add column if not exists data_import_id uuid references data_imports(id) on delete set null;

alter table slaughter_reports
  add column if not exists data_import_id uuid references data_imports(id) on delete set null;

-- slaughter_line_items erbt via report_id → on delete cascade

create index if not exists idx_market_prices_import   on market_prices(data_import_id);
create index if not exists idx_slaughter_reports_import on slaughter_reports(data_import_id);

-- ─── Unique auf statement_number (partial, für Non-NULL) ───────────────────
-- Verhindert doppelte Schlachtabrechnung mit derselben Statement-Nummer
-- pro Farm. Manuelle Einträge ohne Statement-Nummer bleiben erlaubt.
create unique index if not exists ux_slaughter_statement_per_farm
  on slaughter_reports(farm_id, statement_number)
  where statement_number is not null;

-- ─── Status 'rolled_back' für data_imports erlauben ────────────────────────
alter table data_imports drop constraint if exists data_imports_status_check;
alter table data_imports add constraint data_imports_status_check
  check (status in ('success', 'pending_review', 'failed', 'duplicate', 'rolled_back'));

-- ─── Stored Procedure: rollback_import ─────────────────────────────────────
-- Atomares Rollback: löscht alle verknüpften Daten-Zeilen, markiert den
-- data_imports-Eintrag als rolled_back. Gibt eine Zusammenfassung zurück.
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
begin
  select * into v_import from data_imports where id = p_import_id for update;
  if not found then
    return jsonb_build_object('error', 'import not found');
  end if;

  if v_import.status = 'rolled_back' then
    return jsonb_build_object('error', 'import already rolled back');
  end if;

  -- market_prices
  with d as (
    delete from market_prices where data_import_id = p_import_id returning 1
  )
  select count(*) into v_market_deleted from d;

  -- slaughter_line_items werden durch report_id CASCADE mit den reports gelöscht;
  -- wir zählen sie für die Zusammenfassung
  select coalesce(sum((select count(*) from slaughter_line_items where report_id = sr.id)), 0)
    into v_lines_deleted
  from slaughter_reports sr
  where sr.data_import_id = p_import_id;

  -- slaughter_reports (cascadet auf line_items)
  with d as (
    delete from slaughter_reports where data_import_id = p_import_id returning 1
  )
  select count(*) into v_slaughter_deleted from d;

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
    'slaughter_line_items_deleted', v_lines_deleted
  );
end;
$$;

-- ─── Stored Procedure: commit_market_prices_import ─────────────────────────
-- Atomar: legt data_imports-Row an und fügt die Preise mit FK-Link ein.
-- Unique-Constraint (price_date, commodity) greift als letztes Sicherheitsnetz.
-- Gibt die generierte data_import_id + Anzahl eingefügter Zeilen zurück.
create or replace function commit_market_prices_import(
  p_file_name     text,
  p_file_path     text,
  p_file_hash     text,
  p_file_size     integer,
  p_source_type   text,
  p_source_detail text,
  p_period_start  date,
  p_period_end    date,
  p_prices        jsonb,
  p_triggered_by  text default 'manual',
  p_imported_by   uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_import_id uuid;
  v_count int;
begin
  insert into data_imports (
    source_type, source_detail, file_name, file_path, file_hash, file_size_bytes,
    period_start, period_end, records_count, status, triggered_by, imported_by
  ) values (
    p_source_type, p_source_detail, p_file_name, p_file_path, p_file_hash, p_file_size,
    p_period_start, p_period_end, 0, 'success', p_triggered_by, p_imported_by
  ) returning id into v_import_id;

  insert into market_prices (
    data_import_id, price_date, commodity, price_nad, unit, source,
    provider, grade, weight_basis
  )
  select
    v_import_id,
    (p->>'price_date')::date,
    p->>'commodity',
    (p->>'price_nad')::numeric,
    p->>'unit',
    coalesce(p->>'source', p_source_detail),
    nullif(p->>'provider', ''),
    nullif(p->>'grade', ''),
    nullif(p->>'weight_basis', '')
  from jsonb_array_elements(p_prices) as p
  on conflict (price_date, commodity) do update set
    price_nad       = excluded.price_nad,
    unit            = excluded.unit,
    source          = excluded.source,
    provider        = excluded.provider,
    grade           = excluded.grade,
    weight_basis    = excluded.weight_basis,
    data_import_id  = excluded.data_import_id;

  get diagnostics v_count = row_count;

  update data_imports set records_count = v_count where id = v_import_id;

  return jsonb_build_object(
    'import_id', v_import_id,
    'records_inserted', v_count
  );
end;
$$;

-- ─── Stored Procedure: commit_slaughter_report_import ──────────────────────
create or replace function commit_slaughter_report_import(
  p_file_name     text,
  p_file_path     text,
  p_file_hash     text,
  p_file_size     integer,
  p_source_type   text,
  p_statement_number text,
  p_report_date   date,
  p_totals        jsonb,
  p_line_items    jsonb,
  p_triggered_by  text default 'manual',
  p_imported_by   uuid default null
)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_import_id uuid;
  v_report_id uuid;
  v_line_count int;
begin
  insert into data_imports (
    source_type, source_detail, file_name, file_path, file_hash, file_size_bytes,
    period_start, period_end, records_count, status, triggered_by, imported_by
  ) values (
    p_source_type, p_statement_number, p_file_name, p_file_path, p_file_hash, p_file_size,
    p_report_date, p_report_date, 0, 'success', p_triggered_by, p_imported_by
  ) returning id into v_import_id;

  insert into slaughter_reports (
    data_import_id, report_date, statement_number,
    total_animals, total_cold_mass_kg, total_gross_nad,
    total_deductions_nad, total_net_nad,
    source, raw_pdf_ref
  ) values (
    v_import_id, p_report_date, p_statement_number,
    (p_totals->>'total_animals')::int,
    (p_totals->>'total_cold_mass_kg')::numeric,
    (p_totals->>'total_gross_nad')::numeric,
    (p_totals->>'total_deductions_nad')::numeric,
    (p_totals->>'total_net_nad')::numeric,
    'ingest-upload', p_file_name
  ) returning id into v_report_id;

  insert into slaughter_line_items (
    report_id, ear_tag_id, grade, gender,
    cold_mass_kg, announced_price_per_kg,
    bruising_deduction_nad, condemnation_deduction_nad,
    hide_value_nad, gross_price_per_kg, gross_proceeds_nad
  )
  select
    v_report_id,
    nullif(li->>'ear_tag_id', ''),
    nullif(li->>'grade', ''),
    nullif(li->>'gender', ''),
    (li->>'cold_mass_kg')::numeric,
    (li->>'announced_price_per_kg')::numeric,
    coalesce((li->>'bruising_deduction_nad')::numeric, 0),
    coalesce((li->>'condemnation_deduction_nad')::numeric, 0),
    coalesce((li->>'hide_value_nad')::numeric, 0),
    (li->>'gross_price_per_kg')::numeric,
    (li->>'gross_proceeds_nad')::numeric
  from jsonb_array_elements(p_line_items) as li;

  get diagnostics v_line_count = row_count;

  update data_imports
     set records_count = v_line_count + 1  -- 1 report + N line items
   where id = v_import_id;

  return jsonb_build_object(
    'import_id', v_import_id,
    'report_id', v_report_id,
    'line_items_inserted', v_line_count
  );
end;
$$;

-- Erlaube authentifizierten Usern den Aufruf der Commit/Rollback-Procedures
grant execute on function rollback_import(uuid) to authenticated;
grant execute on function commit_market_prices_import(text, text, text, integer, text, text, date, date, jsonb, text, uuid) to authenticated;
grant execute on function commit_slaughter_report_import(text, text, text, integer, text, text, date, jsonb, jsonb, text, uuid) to authenticated;
