# Farm Controlling Erichsfelde — Projektüberblick

## Was bauen wir?

Ein digitales Steuerungssystem für die Rinderfarm "Erichsfelde" (Pommersche Farmgesellschaft, Namibia). Es ersetzt Excel-Tabellen, manuelle Auswertungen und das Bauchgefühl durch ein einziges Dashboard, das alle wichtigen Kennzahlen der Farm auf einen Blick zeigt.

## Warum?

Ein Direktor, der aus dem Urlaub zurückkommt, soll in **10 Sekunden** sehen, ob auf der Farm etwas kritisch ist. Ein Verwalter vor Ort soll mit **10 Minuten pro Monat** alle nötigen Daten erfassen. Investoren sollen quartalsweise einen professionellen Report bekommen — automatisch.

## Die 8 Kernfragen, die das System beantwortet

| # | Frage | Beispiel-Antwort |
|---|-------|-----------------|
| 1 | **Können wir die nächsten 6 Monate Gehälter und Rechnungen bezahlen?** | "Cash reicht für 8 Monate — alles grün." |
| 2 | **Sind wir im Budget, wo laufen Kosten aus dem Ruder?** | "Futterkosten 18% über Plan — gelbe Ampel." |
| 3 | **Wächst die Herde nachhaltig oder schrumpft sie?** | "Netto +12 Tiere dieses Quartal — grün." |
| 4 | **Kann das Land die aktuelle Tiermenge tragen?** | "Besatzdichte bei 85% der Kapazität — grün." |
| 5 | **Sind wir profitabel pro verkauftem Kilogramm?** | "42 NAD/kg Kosten bei 62 NAD/kg Erlös — grün." |
| 6 | **Wie sieht die Regensaison aus?** | "Saisonprognose 65% unter Normal — rot, Destocking prüfen!" |
| 7 | **Läuft der Farmbetrieb zuverlässig?** | "3 offene Wartungstickets, Impfabdeckung 97% — grün." |
| 8 | **Ist die EU-Exportzertifizierung gesichert?** | "FMD-Zertifikat läuft in 45 Tagen ab — gelb." |

## Woher kommen die Daten?

| Quelle | Aufwand | Wie oft |
|--------|---------|---------|
| **Bankkontoauszüge** | Automatisch (Mail-Bot "OpenClaw") | Täglich |
| **Meatco-Schlachtberichte** | Automatisch (Mail-Bot + PDF-Parser) | Nach jedem Schlachtzyklus |
| **Wetter & Satellit** | Vollautomatisch (CHIRPS-Regen, Sentinel-NDVI) | Täglich |
| **Wechselkurse** | Vollautomatisch (EZB-API) | Täglich |
| **Marktpreise** | Halbautomatisch (LPO-Mails) | Wöchentlich |
| **Herdenzählung & Farmzustand** | Verwalter-Formular, 10 Min/Monat | Monatlich |

## Was der Verwalter einmal pro Monat eingibt

- **Herde**: Aktuelle Zählung (Kühe, Bullen, Färsen, Ochsen, Kälber) + Bewegungen (Geburten, Tode, Verkäufe)
- **Weide**: Zustandsbewertung 1-5 pro Camp
- **Wasser**: Status der Bohrlöcher und Dämme
- **Aufgaben**: Erledigte Impfungen, Kontrollen, Wartungen
- **Vorfälle**: Diebstahl, Raubtierverluste, Unfälle
- **Fotos**: 1-3 Bilder vom Farmzustand (optional)

## Das Dashboard

- **Cockpit**: Eine Seite, 8 Ampeln — die Zusammenfassung in 10 Sekunden
- **Finanzen**: Cashflow, Budget-Kontrolle, Kosten pro Kilogramm
- **Herde**: Bestandsentwicklung, Kalbungsrate, Mortalität
- **Weide & Klima**: Karte mit Camp-Zuständen, Regenvergleich, Wettervorhersage
- **Markt**: Fleischpreise, Margen, Wechselkurse
- **Operativ**: Aufgaben-Abdeckung, offene Probleme, Infrastruktur-Status
- **Bonus**: Der bestehende Bonusrechner, jetzt mit echten Daten statt Schätzwerten
- **Admin**: Budget pflegen, Parameter anpassen (nur für Direktor)

## Technologie

- **Supabase** (gehostete Datenbank mit Authentifizierung) — keine eigenen Server nötig
- **Cloudflare Pages** (Webhosting) — schnell, kostenlos, automatisches Deployment
- **GitHub Actions** (Satellitendaten-Verarbeitung) — läuft im Hintergrund
- Keine App-Installation nötig — alles funktioniert im Browser, auch auf dem Handy

## Der bestehende Bonusrechner

Bleibt erhalten und funktioniert wie bisher. Am Ende des Projekts wird er automatisch die echten Farmzahlen als Ausgangswerte verwenden — die Slider bleiben für "Was-wäre-wenn"-Simulationen.

## Zeitplan

| Phase | Was | Ungefähr |
|-------|-----|----------|
| 0 | Fundament: Datenbank, Stammdaten importieren | erledigt |
| 1 | Dashboard, Verwalter-Formular, Finanz-Ingest | erledigt |
| 2 | Herden-Logik, Telegram-Erinnerungen | als nächstes |
| 3 | Wetter, Satellit, Klima-Frühwarnung | als nächstes |
| 4 | Betriebsmodul, automatische Alerts, Quartalsberichte | danach |
| 5 | Bonus-Integration mit echten Daten | zum Schluss |

Geschätzter Gesamtaufwand: **~130 Stunden** (6-10 Wochen bei 10-15 h/Woche).

## Wert ab wann?

Bereits nach Phase 1 hat das System Nutzen: Finanzübersicht live, Budget-Kontrolle, Schlachterlöse automatisch erfasst. Jede weitere Phase fügt einen Bereich hinzu, ohne dass die vorherigen Phasen davon abhängen.
