# Farm Controlling Erichsfelde

Digitales Steuerungssystem für die Rinderfarm *Erichsfelde* (Pommersche Farmgesellschaft, Namibia). Ersetzt Excel-Tabellen und manuelle Auswertungen durch ein einziges Dashboard: 10 Sekunden für den Direktor-Blick, 10 Minuten pro Monat für die Verwalter-Eingabe, Quartalsreport automatisch für Investoren.

**Vollständiger Projektüberblick:** [`PROJEKTUEBERBLICK.md`](./PROJEKTUEBERBLICK.md)
**Deployment:** [`DEPLOY.md`](./DEPLOY.md)
**Status vor Go-Live:** [`CHECKLIST.md`](./CHECKLIST.md)
**Offene Roadmap:** [`TODO.md`](./TODO.md)

---

## Aufbau

```
app/              12 HTML-Seiten (Cockpit, Finanzen, Herde, Weide, Markt, Operativ, Bonus, Admin, …)
  shared/         Gemeinsame JS-Module (auth, nav, config, logger, states)
shared/           bonus-engine.js (pure) + bonus-live-loader.js
supabase/
  migrations/     45 SQL-Migrations (RLS, PostGIS, Trigger, Views)
  functions/      10 Edge Functions (ingest, alerts, report, health-check, …)
scripts/          Parser (KML, Excel, Meatco-PDF, LPO) + Fetch-Jobs (FX, CHIRPS, Wetter)
tests/            bonus-engine Golden-Master + Edge-Smoke + RLS-Regressionstests
.github/workflows 6 Workflows: Wetter/FX/Saisonprognose täglich, Kalender-Reminder, Tests
```

## Technologie

- **Supabase** — Postgres + Auth (Magic Link) + Edge Functions + Storage. Single-tenant today, multi-tenant schema (`farm_id` überall).
- **Cloudflare Pages** — Hosting für das statische Frontend.
- **GitHub Actions** — Tägliche Satelliten-/Wetter-/Forex-Syncs + CI.

## Lokal entwickeln

```bash
# Tests (Node 20+)
npm test

# Edge-Function-Smoketest gegen Live-Projekt
SUPABASE_URL=https://…  SUPABASE_ANON_KEY=… bash tests/edge-smoke.sh

# Lokaler Webserver (nur statische Files)
python3 -m http.server 3001 --directory .
# → http://localhost:3001/app/cockpit.html
```

Alle Secrets (Supabase Service Key, Telegram, Resend) liegen in Supabase Function Secrets + GitHub Actions Secrets. Lokal: `.env` (gitignored). Der im Repo eingecheckte `app/shared/config.js` enthält nur die öffentliche `sb_publishable_*`-Anon-Key.

## Sicherheit

- Alle 26 Tabellen: RLS aktiv. 80 Policies, farm-scoped, rollenbasiert (`owner` / `manager` / `viewer`).
- Edge Functions: Service-Role-Endpoints (`ingest`, `alerts`, `report`, `health-check`, `reminder`) validieren den Bearer-Token per constant-time-compare gegen `SUPABASE_SERVICE_ROLE_KEY`. User-Endpoints (`commit-import`, `rollback-import`, `process-upload`) verifizieren via Supabase Auth.
- Sensible Datenordner (`Data_Input/`, `Private_Hub/`, `scripts/secrets/`) sind gitignored.

## Roadmap-Phasen

| Phase | Status |
|-------|--------|
| 0 — Datenbank + Stammdaten | ✅ |
| 1 — Dashboard + Finanz-Ingest + Verwalter-Formular | ✅ |
| 2 — Herden-Logik + Telegram-Reminder | ✅ |
| 3 — Wetter + Satellit + Klima-Frühwarnung | ✅ (Sentinel NDVI pending Copernicus-Account) |
| 4 — Betriebsmodul + Alerts + Quartalsberichte | 🚧 PDF-Report pending |
| 5 — Bonus-Integration mit Live-Daten | ✅ |

## Legacy: Standalone Bonusrechner

Der eigenständige Bonusrechner (2-Säulen-Modell mit progressiver EBIT-Staffelung + Produktivitätsindex) ist weiterhin als einzelne HTML-Datei nutzbar:

**Live-Tool:** https://pillinio.github.io/farm-bonusrechner/farm_bonussystem_komplett.html

Features: EBIT-Berechnung, Bonusstaffelung, Skin-in-the-Game-Multiplikator, Auszahlungsstruktur (Sofort vs. 3-Jahres-Bank), LocalStorage Auto-Save, JSON Export/Import, PDF Export. Alle Daten bleiben lokal im Browser — keine Serververbindung.

Innerhalb von Farmcockpit ist dieselbe Logik in [`app/bonus.html`](./app/bonus.html) + [`shared/bonus-engine.js`](./shared/bonus-engine.js) integriert und zieht Defaults aus Live-Farmdaten (Herdenbestand, Schlachterlöse, Betriebskosten).

---

**Entwickelt für Rinderfarmen in Namibia.**
