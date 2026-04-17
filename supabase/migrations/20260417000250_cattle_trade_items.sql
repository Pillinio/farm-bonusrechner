-- Kauf-/Verkaufsplanung: mehrere Tierkategorien pro Eintrag.
-- items = [{category, head_count, price_per_head}, ...]
-- Legacy-Einzelfelder werden nullable; neue Einträge nutzen nur items.

alter table cattle_trade_plans
  alter column animal_category drop not null,
  alter column head_count drop not null;

alter table cattle_trade_plans
  add column items jsonb;

alter table cattle_trade_plans
  add constraint cattle_trade_items_array
  check (items is null or jsonb_typeof(items) = 'array');
