-- Phase 0: Auto-calculate total_lsu on herd_snapshots
-- LSU conversion factors (Namibian standard):
--   Cow = 1.0, Bull = 1.2, Heifer = 0.8, Ox = 1.0, Calf = 0.2

create or replace function calculate_lsu()
returns trigger as $$
begin
  new.total_lsu :=
    coalesce(new.cows, 0) * 1.0 +
    coalesce(new.bulls, 0) * 1.2 +
    coalesce(new.heifers, 0) * 0.8 +
    coalesce(new.oxen, 0) * 1.0 +
    coalesce(new.calves, 0) * 0.2;
  return new;
end;
$$ language plpgsql;

create trigger trg_calculate_lsu
  before insert or update on herd_snapshots
  for each row
  execute function calculate_lsu();
