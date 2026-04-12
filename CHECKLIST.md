# Production Checklist — Farm Controlling Erichsfelde

Stand: 2026-04-12 | Letzte Prüfung: manuell verifiziert gegen DB + Codebase

---

## LEGENDE
- [x] Erledigt und verifiziert
- [~] Teilweise erledigt — Details siehe Anmerkung  
- [ ] Offen

---

## 1. DATENBANK & INFRASTRUKTUR

- [x] Supabase-Projekt live (eu-central-1)
- [x] 26 Tabellen angelegt (14 Migrations)
- [x] PostGIS aktiviert (extensions.geometry)
- [x] Multi-Entity: farms-Tabelle + farm_id FK überall
- [x] RLS aktiviert auf allen Tabellen
- [x] 80 RLS Policies definiert (farm-scoped, role-based)
- [x] LSU-Trigger auf herd_snapshots (auto-berechnet GVE)
- [x] get_camps_geojson() RPC-Funktion für Leaflet
- [x] app_logs Tabelle für strukturiertes Logging
- [x] GitHub Secrets gesetzt (SUPABASE_URL, SUPABASE_SERVICE_KEY)
- [ ] pg_cron Jobs einrichten (Alerts stündlich, Health-Check stündlich)
- [ ] Supabase Auth: Magic Link Provider aktivieren im Dashboard
- [ ] Supabase Storage Bucket "farm-uploads" für Fotos erstellen

## 2. SEED-DATEN IN DB

- [x] farms: 1 (Erichsfelde) ✓
- [x] farm_camps: 48 (47 Camps + Außengrenze) ✓
- [x] budgets: 174 (2024 Plan + Monats-Ist) ✓
- [x] market_prices: 226 (Auktionen + Meatco-Grades + FX) ✓
- [x] weather_observations: 176 (Excel-Import + Open-Meteo) ✓
- [x] slaughter_reports: 3 + slaughter_line_items: 117 ✓
- [x] category_rules: 66 Pattern-Regeln ✓
- [x] herd_snapshots: 1 Test-Snapshot (April 2026, 631 GVE) ✓
- [x] seasonal_forecasts: 14 (7 Monate × 2 Variablen) ✓
- [x] alert_rules: 8 Regeln geseedet ✓
- [ ] **carrying_capacity_assumptions: 0 — MUSS GESEEDET WERDEN** (LSU/ha für Erichsfelde)
- [ ] **task_templates: 0 — MUSS GESEEDET WERDEN** (~10 wiederkehrende Aufgaben)
- [ ] **farm_assets: 0 — MUSS GESEEDET WERDEN** (Bohrlöcher, Dämme, 20 Regenstationen)
- [ ] bonus_parameters: 0 — Default-Bonus-Config als erster Eintrag

## 3. EDGE FUNCTIONS (6 deployed)

- [x] ingest — Dispatcher für OpenClaw (bank-statement, slaughter-report, market-prices)
- [x] reminder — Telegram-Reminder am 1. des Monats (Africa/Windhoek TZ)
- [x] alerts — KPI-Schwellwert-Prüfung (F1, F2, H3, W1, O2)
- [x] bonus-defaults — Live-Daten für Bonusrechner
- [x] report — Quartals-Report als JSON
- [x] health-check — Daten-Freshness-Prüfung
- [~] Logging-Integration: _shared/logger.ts existiert, Import-Pfad nicht verifiziert
- [ ] **Ingest end-to-end testen** (echte OpenClaw-Payload senden)
- [ ] **Report: PDF-Generierung fehlt** (nur JSON, kein Resend-Email)
- [ ] **Alerts: pg_cron Schedule fehlt** (manuell im Dashboard einrichten)

## 4. GITHUB ACTIONS (5 Workflows)

- [x] fx-prices.yml — Täglich, FX NAD/EUR + NAD/USD ✓ (getestet, Daten in DB)
- [x] chirps.yml — Täglich, Open-Meteo historisch ✓ (getestet, Daten in DB)
- [x] weather-forecast.yml — Täglich, 16-Tage-Forecast ✓ (getestet, Daten in DB)
- [x] seasonal-forecast.yml — Wöchentlich, 6-Monats-Saisonprognose ✓ (getestet, 14 Rows)
- [~] sentinel.yml — **PLACEHOLDER** — fetch-sentinel.py tut nichts (braucht Copernicus-Account)
- [x] Alle: timeout-minutes: 5, Failure-Notification zu alert_history

## 5. APP-SEITEN (10 HTML-Dateien)

### 5a. Cockpit (cockpit.html)
- [x] 8+2 Ampel-Karten (Q1-Q8 + K3 + K4)
- [x] Supabase-Queries für jede Karte
- [x] Auto-Refresh alle 5 Min
- [x] Auth-Guard → Redirect zu login.html
- [x] Shared Nav integriert
- [ ] **Browser-Test nach Auth-Aktivierung** nötig

### 5b. Finanzen (finanzen.html)
- [x] F1-F8 Sektionen mit Supabase-Queries
- [x] Chart.js für F3 (Revenue) und F4 (Cost/kg)
- [x] Budget vs Actual Tabelle
- [x] Memory-Leak-Fix für Charts
- [~] **F1 Cash Runway: saisonale Heuristik fehlt** (nur linear)
- [ ] **Kein dedizierter Markt-Tab** — M1-M4 teilweise hier, M5-M8 fehlen

### 5c. Herde (herde.html)
- [x] H1-H5 Sektionen mit Charts
- [x] Link zu Herd-Entry
- [x] Chart-Cleanup bei Refresh
- [ ] **H6 (Netto-Gewichtszuwachs) und H7 (Absetzgewicht) fehlen** — brauchen Schlachtdaten-Verknüpfung

### 5d. Weide & Klima (weide.html)
- [x] Leaflet-Karte mit Camp-Polygonen (GeoJSON via RPC)
- [x] Veld-Condition Farboverlay pro Camp
- [x] Saisonale Regenprognose (K2) mit Chart + Tabelle
- [x] K3 Consecutive Dry Days KPI
- [x] K4 Heat Stress Risk KPI
- [x] W1 Besatzdichte (Farm-gesamt + per-Camp)
- [x] Rainfall-Chart historisch
- [~] **NDVI-Overlay: nur Button-Placeholder** — braucht Sentinel-Daten
- [ ] **CHIRPS vs. Farm-Ground-Truth Vergleichschart fehlt**
- [ ] **W4 Wasser-Status Aggregation fehlt** (Daten kommen über Herd-Entry)

### 5e. Operativ (operativ.html)
- [x] Task-Coverage (O1) mit Queries
- [x] Offene Wartung (O2)
- [x] Incident-Log (O3) Tabelle
- [x] Asset-Status Grid
- [~] **Compliance C1-C4: nur Placeholder** — Tabelle fehlt im Schema

### 5f. Herd-Entry (herd-entry.html)
- [x] 4 Sektionen: Herde, Weide, Operatives, Fotos
- [x] Magic-Link Auth
- [x] 5 DB-Inserts auf Submit (herd_snapshots, veld_observations, asset_status_reports, task_executions, incidents)
- [x] LocalStorage Auto-Save (30s)
- [x] Double-Submit Prevention
- [x] Offline-Detection Banner
- [x] Mobile-first Design
- [ ] **End-to-end Submit-Test** (braucht Auth + echte Session)

### 5g. Login (login.html)
- [x] Magic-Link-Formular
- [x] Redirect-Support (?redirect=)
- [x] Fehlerbehandlung
- [ ] **Test nach Auth-Aktivierung**

### 5h. Admin (admin.html)
- [x] Budget-Verwaltung (Edit + Save)
- [x] Bonus-Parameter Versionierung
- [x] Tragfähigkeit bearbeiten
- [x] Category-Rules CRUD
- [x] Unkategorisierte Transaktionen Recat-UI
- [x] User-Verwaltung mit Role-Change
- [x] Owner-only Auth-Guard
- [ ] **End-to-end Test** (braucht Owner-Profile in DB)

### 5i. Forecast (forecast.html)
- [x] Jahresendprognose aus Live-Daten
- [x] 3 Szenarien (Konservativ/Basis/Optimistisch)
- [x] Sensitivitäts-Analyse mit Slidern
- [x] Bonus-Prognose per Szenario
- [x] Chart.js Vergleichschart
- [x] Import von bonus-engine.js

### 5j. Bonusrechner (farm_bonussystem_komplett.html)
- [x] ES-Modul-Import aus shared/bonus-engine.js
- [x] getDomParams() für alle Aufrufer
- [x] 26 Golden-Master-Tests alle grün
- [x] Browser-verifiziert: EBIT 808.000, Bonus 102.200
- [~] **Live-Daten-Loader (bonus-live-loader.js) existiert, aber nicht in HTML eingebunden**

## 6. SHARED MODULES

- [x] shared/bonus-engine.js — Pure Bonus-Formeln
- [x] shared/bonus-live-loader.js — Fetch + Apply Live-Defaults
- [x] app/shared/config.js — Supabase-URL, Pages, LSU-Faktoren
- [x] app/shared/nav.js — Konsistente Navigation (9 Tabs + Admin)
- [x] app/shared/auth.js — initSupabase() + requireAuth()
- [x] app/shared/logger.js — Client-Logger mit Buffer
- [x] app/shared/states.js + states.css — Loading/Error/Empty Components
- [x] supabase/functions/_shared/logger.ts — Server-Logger

## 7. PARSER-SKRIPTE

- [x] scripts/parse-kml.js — KML → farm_camps SQL ✓
- [x] scripts/parse-dashboard.js — Excel → budgets + market_prices + weather SQL ✓
- [x] scripts/parse-meatco.js — PDF → slaughter_reports + line_items SQL ✓
- [x] scripts/seed-category-rules.js — 66 Kategorisierungs-Regeln ✓
- [x] scripts/fetch-chirps.py — Open-Meteo Archive mit Retry ✓
- [x] scripts/fetch-fx.py — Frankfurter API mit Retry ✓
- [x] scripts/fetch-weather-forecast.py — 16-Tage mit Retry ✓
- [x] scripts/fetch-seasonal-forecast.py — 6-Monats-Ensemble ✓
- [~] scripts/fetch-sentinel.py — **PLACEHOLDER** (Copernicus-Account nötig)

## 8. FEHLENDE FEATURES (priorisiert)

### Kritisch (Production-Blocker)
- [ ] **Supabase Auth aktivieren** (Magic Link Provider im Dashboard)
- [ ] **Carrying Capacity seeden** (ohne diesen Wert ist W1 Besatzdichte sinnlos)
- [ ] **Task Templates seeden** (~10 Einträge: Impfungen, Entwurmung, Zaunkontrolle, etc.)
- [ ] **Farm Assets seeden** (Bohrlöcher, Dämme, Regenstationen aus Data_Input)
- [ ] **bonus-live-loader.js in HTML einbinden** (Script-Tag fehlt)
- [ ] **Cloudflare Pages deployen** (wrangler login + deploy)

### Wichtig (Feature-Gaps)
- [ ] **Markt-Tab fehlt** als eigenständige Seite (M1-M8 KPIs)
- [ ] **LPO-Parser fehlt** (Meatco-Wochenpreise aus Mail)
- [ ] **Compliance-Tracking C1-C4** (FMD, Brucellose, EU-Approval — Schema + UI)
- [ ] **NDVI Sentinel-2** echte Implementierung (Copernicus-Registrierung)
- [ ] **PDF-Report-Generierung** (aktuell nur JSON)
- [ ] **pg_cron einrichten** für Alerts + Health-Check

### Nice-to-have
- [ ] Telegram Bot erstellen und Env Vars setzen
- [ ] CHIRPS vs. Farm-Ground-Truth Vergleichschart
- [ ] F1 saisonale Cash-Runway-Heuristik
- [ ] H6/H7 KPIs (Gewichtszuwachs, Absetzgewicht)
- [ ] Supabase Storage für Foto-Upload konfigurieren
- [ ] Claude-Narrative im Quartals-PDF

---

## 9. QUALITÄTS-CHECKS VOR GO-LIVE

- [ ] Auth-Flow: Login → Cockpit → alle Tabs → Herd-Entry Submit → Logout
- [ ] Mobile-Test: Herd-Entry auf echtem Smartphone (LTE Namibia)
- [ ] Datenqualität: Budget-Summen gegen Excel-Original prüfen
- [ ] Meatco-Summen: 3 Statement-Totals gegen PDF-Originale
- [ ] Camp-Karte: alle 47 Camps sichtbar mit korrekten Namen?
- [ ] Alert-Test: künstlich Schwellwert überschreiten → wird Alert ausgelöst?
- [ ] Bonus-Werte: Live-Defaults vs. manuelle Eingabe → identisches Ergebnis?
