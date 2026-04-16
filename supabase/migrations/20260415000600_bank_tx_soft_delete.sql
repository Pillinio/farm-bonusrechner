-- Soft-delete for bank_transactions: preserves audit trail, hides from KPI queries
-- when active=false. Finanz-KPIs (Cashflow, Budget-Ist, EBIT, Kosten/LSU) filter
-- eq('active', true). Admin-Kontoauszug zeigt auch deaktivierte an (mit Toggle).

alter table bank_transactions add column if not exists active boolean not null default true;

create index if not exists idx_bank_tx_active on bank_transactions(active) where active;
