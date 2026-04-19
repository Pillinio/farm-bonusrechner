-- Monatsbericht-Refactor: camp_vegetation wird kanonischer Monats-Kamp-Record.
-- Enthält ab jetzt zusätzlich zum Vegetationszustand auch Zaun, Reservoir,
-- Wasserförderung, Regen, Qualität (1-5), snapshot_date-Link zum herd_snapshot.
-- farm_camps.has_rain_station markiert die (5) Kamps mit manueller Regenstation.

-- 1. camp_vegetation erweitern
alter table camp_vegetation
  add column condition_score     smallint check (condition_score between 1 and 5),
  add column rainfall_mm         numeric  check (rainfall_mm >= 0),
  add column fence_status        text     check (fence_status in ('green','yellow','red','na')),
  add column reservoir_level_pct integer  check (reservoir_level_pct between 0 and 100),
  add column water_pump_status   text     check (water_pump_status in
                                             ('solar_ok','solar_issue','wind_ok','wind_issue','na')),
  add column snapshot_date       date;

-- grass_condition darf jetzt NULL sein (Verwalter erfasst evtl. nur Zaun/Regen)
alter table camp_vegetation alter column grass_condition drop not null;

-- mindestens ein erfasster Wert nötig — sonst ist die Row sinnlos
alter table camp_vegetation
  add constraint camp_veg_at_least_one_metric check (
       condition_score is not null
    or rainfall_mm is not null
    or reservoir_level_pct is not null
    or grass_condition is not null
    or fence_status is not null
    or water_pump_status is not null
    or (dominant_species is not null and array_length(dominant_species, 1) > 0)
  );

create index idx_camp_vegetation_snapshot on camp_vegetation(snapshot_date);

-- 2. Regenstation-Flag auf farm_camps
alter table farm_camps add column has_rain_station boolean default false;

-- 3. Backfill: Alt-Daten aus pasture_observations nach camp_vegetation
insert into camp_vegetation
  (farm_id, camp_name, observation_date, condition_score, rainfall_mm, snapshot_date, notes, photos_ref)
select farm_id, camp_name, snapshot_date, condition_score, rainfall_mm, snapshot_date, notes, photos_ref
from pasture_observations
on conflict (farm_id, camp_name, observation_date) do update set
  condition_score = coalesce(excluded.condition_score, camp_vegetation.condition_score),
  rainfall_mm     = coalesce(excluded.rainfall_mm,     camp_vegetation.rainfall_mm),
  snapshot_date   = coalesce(excluded.snapshot_date,   camp_vegetation.snapshot_date);
