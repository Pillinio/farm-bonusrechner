-- Manuelle Regenmessung pro Kamp, erfasst im Monatsbericht
-- neben der Veld-Condition. condition_score wird nullable, damit
-- auch "nur Regen" (oder "nur Condition") zulässig ist.

alter table veld_observations
  add column rainfall_mm numeric check (rainfall_mm >= 0);

alter table veld_observations
  alter column condition_score drop not null;

alter table veld_observations
  add constraint veld_obs_at_least_one_metric
  check (condition_score is not null or rainfall_mm is not null);
