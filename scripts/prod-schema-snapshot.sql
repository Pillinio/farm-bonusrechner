-- Prod schema snapshot for tables NOT created by migrations.
-- Source: live introspection via Supabase MCP, 2026-04-22.
-- Used by Phase 1 (C1) to produce an idempotent create-if-not-exists migration.

-- =========================================================================
-- bank_transactions
-- =========================================================================
-- Status: exists in prod, NEVER created by a migration. Referenced by
--   admin.html, berichte.html, cockpit.html, finanzen.html.
-- RLS: enabled. Policies below mirror farm_id scoping used on `transactions`.
-- Soft-delete: active boolean (true = visible in KPIs, false = hidden).
-- =========================================================================

create table if not exists bank_transactions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null default default_farm_id() references farms(id),
  transaction_date date not null,
  value_date date,
  reference text,
  description text not null,
  debit_nad numeric,
  credit_nad numeric,
  balance_nad numeric,
  bank text not null default 'nedbank',
  category text,
  category_confirmed boolean default false,
  source_file text,
  created_at timestamptz default now(),
  active boolean not null default true,
  unique (farm_id, transaction_date, reference, description, debit_nad, credit_nad)
);

create index if not exists idx_bank_tx_active
  on bank_transactions(active) where active;

alter table bank_transactions enable row level security;

create policy "farm_read" on bank_transactions for select to authenticated
  using (farm_id = (select farm_id from profiles where id = auth.uid()));

create policy "farm_insert" on bank_transactions for insert to authenticated
  with check (farm_id = (select farm_id from profiles where id = auth.uid()));

create policy "farm_update" on bank_transactions for update to authenticated
  using (farm_id = (select farm_id from profiles where id = auth.uid()));

create policy "service_all" on bank_transactions for all to service_role
  using (true);
