-- Add 'private_block' as a valid entry_type on farm_calendar.
-- Erlaubt dem Nutzer, Zeiträume als "privat geblockt" zu markieren — analog zu
-- shareholder_visit als reiner Informations-Eintrag (keine Genehmigung nötig).

ALTER TABLE farm_calendar DROP CONSTRAINT IF EXISTS farm_calendar_entry_type_check;

ALTER TABLE farm_calendar ADD CONSTRAINT farm_calendar_entry_type_check
  CHECK (entry_type IN (
    'leave', 'business_trip', 'sick', 'shareholder_visit', 'private_block'
  ));
