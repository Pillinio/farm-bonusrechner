-- Rename veld_observations → pasture_observations (konsistent mit UI-Sprachgebrauch "Weide")
-- Policies, Indexe und Constraints wandern automatisch mit RENAME TABLE mit.

alter table veld_observations rename to pasture_observations;

alter table pasture_observations
  rename constraint veld_obs_at_least_one_metric to pasture_obs_at_least_one_metric;

-- Budget-Kategorie Umlaut-Fix: "Gaeste" → "Gäste"
update budgets
   set category = 'Household Farm & Gäste'
 where category = 'Household Farm & Gaeste';

update category_rules
   set category_name = 'Household Farm & Gäste'
 where category_name = 'Household Farm & Gaeste';
