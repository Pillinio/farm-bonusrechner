-- Post-Audit: Supabase Security-Advisor-Findings bereinigen.
--
-- 1. grass_species: RLS war nie aktiviert (Referenztabelle, 12 Zeilen, via
--    PostgREST öffentlich). Read für authenticated; Writes nur service_role.
-- 2. camp_occupancy: View mit SECURITY DEFINER — RLS des Aufrufers wird
--    ignoriert. Auf SECURITY INVOKER umstellen, damit Abfragen die Policies
--    von herd_movements respektieren.
-- 3. market_prices: INSERT/UPDATE-Policies für authenticated mit
--    using/with check (true) — jeder eingeloggte User konnte Referenzpreise
--    überschreiben. DELETE wurde in 20260417000200 bereits auf owner
--    eingeschränkt; INSERT/UPDATE folgt jetzt.
-- 4. Mutable search_path auf 13 SECURITY-DEFINER-Funktionen: Angreifbar für
--    search-path-hijacking, wenn eine malicious-schema-Tabelle im Suchpfad
--    landet. Fix: search_path explizit festpinnen.
-- 5. Auth: leaked-password-protection (HIBP-Lookup) ist ein Dashboard-Toggle,
--    nicht per Migration setzbar — muss in Supabase UI aktiviert werden.

-- ───────────────────────────────────────────────────────────────
-- 1. grass_species
-- ───────────────────────────────────────────────────────────────
alter table grass_species enable row level security;

do $$
begin
  if not exists (select 1 from pg_policy where polname = 'authenticated_read'
                   and polrelid = 'public.grass_species'::regclass) then
    create policy "authenticated_read" on grass_species for select to authenticated
      using (true);
  end if;
  if not exists (select 1 from pg_policy where polname = 'service_all'
                   and polrelid = 'public.grass_species'::regclass) then
    create policy "service_all" on grass_species for all to service_role
      using (true);
  end if;
end $$;

-- ───────────────────────────────────────────────────────────────
-- 2. camp_occupancy view
-- ───────────────────────────────────────────────────────────────
alter view camp_occupancy set (security_invoker = true);

-- ───────────────────────────────────────────────────────────────
-- 3. market_prices INSERT/UPDATE auf owner einengen
-- ───────────────────────────────────────────────────────────────
drop policy if exists "authenticated_insert" on market_prices;
drop policy if exists "owner_insert"         on market_prices;
create policy "owner_insert" on market_prices for insert to authenticated
  with check (auth_role() = 'owner');

drop policy if exists "authenticated_update" on market_prices;
drop policy if exists "owner_update"         on market_prices;
create policy "owner_update" on market_prices for update to authenticated
  using (auth_role() = 'owner')
  with check (auth_role() = 'owner');

-- ───────────────────────────────────────────────────────────────
-- 4. search_path auf allen SECURITY DEFINER Funktionen fixieren
-- ───────────────────────────────────────────────────────────────
alter function public.auth_farm_id()                  set search_path = public, pg_catalog;
alter function public.auth_role()                     set search_path = public, pg_catalog;
alter function public.default_farm_id()               set search_path = public, pg_catalog;
alter function public.assert_import_allowed()         set search_path = public, pg_catalog;
alter function public.rollback_import(uuid)           set search_path = public, pg_catalog;
alter function public.commit_slaughter_report_import(text, text, text, integer, text, text, date, jsonb, jsonb, text, uuid)
                                                      set search_path = public, pg_catalog;
alter function public.commit_market_prices_import(text, text, text, integer, text, text, date, date, jsonb, text, uuid)
                                                      set search_path = public, pg_catalog;
alter function public.calculate_lsu()                 set search_path = public, pg_catalog;
alter function public.get_camps_geojson()             set search_path = public, pg_catalog;
alter function public.update_cert_status()            set search_path = public, pg_catalog;
alter function public.get_farm_assets_with_coords()   set search_path = public, pg_catalog;
alter function public.bump_herd_snapshot_audit()      set search_path = public, pg_catalog;
alter function internal.edge_function_headers()       set search_path = public, pg_catalog, vault;
