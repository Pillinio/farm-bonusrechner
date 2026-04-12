-- KPI targets table (from masterplan: KPI_Bonus sheet → production targets for H6/H7)
create table kpi_targets (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references farms(id) default default_farm_id(),
  kpi_id text not null,  -- e.g. 'H6', 'H7', 'F4'
  target_value numeric not null,
  unit text not null,  -- e.g. 'kg/day', 'kg', 'NAD/kg'
  description text,
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz default now(),
  unique(farm_id, kpi_id, effective_from)
);

alter table kpi_targets enable row level security;
create policy "authenticated_read" on kpi_targets for select to authenticated using (true);
create policy "owner_write" on kpi_targets for insert to authenticated
  with check (exists (select 1 from profiles where id = auth.uid() and role = 'owner'));
create policy "owner_update" on kpi_targets for update to authenticated
  using (exists (select 1 from profiles where id = auth.uid() and role = 'owner'));

-- Seed with targets from KPI_Bonus sheet (masterplan specifies these values)
INSERT INTO kpi_targets (kpi_id, target_value, unit, description) VALUES
  ('H6', 0.5, 'kg/day', 'Nettogewichtszuwachs — Ziel 0,5 kg pro Tag pro Tier'),
  ('H7', 200, 'kg', 'Durchschnittliches Absetzgewicht — Ziel 200 kg Lebendmasse'),
  ('F4', 45, 'NAD/kg', 'Kosten pro kg Schlachtgewicht — Ziel unter 45 NAD/kg'),
  ('H2', 75, 'percent', 'Kalbungsrate — Ziel 75% rollend 12 Monate'),
  ('H3', 3, 'percent', 'Mortalitätsrate — Ziel unter 3% gesamt'),
  ('W1', 85, 'percent', 'Besatzdichte — Ziel max. 85% der Tragfähigkeit');

-- Storage bucket for farm photo uploads (herd-entry.html uses 'farm-uploads')
-- Note: Supabase Storage buckets must be created via Dashboard or API, not SQL.
-- Go to: Supabase Dashboard > Storage > New Bucket > Name: "farm-uploads" > Public: No
