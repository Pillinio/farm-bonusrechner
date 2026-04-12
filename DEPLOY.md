# Deployment-Anleitung — Farm Controlling Erichsfelde

## 1. Supabase Auth aktivieren (2 Minuten)

1. Öffne https://supabase.com/dashboard/project/vhwlcnfxslkftswksqrw/auth/providers
2. Unter **Email** → sicherstellen dass "Enable Email provider" **AN** ist
3. "Confirm email" kann AUS bleiben (Magic Link braucht keine Bestätigung)
4. Unter **URL Configuration** (https://supabase.com/dashboard/project/vhwlcnfxslkftswksqrw/auth/url-configuration):
   - **Site URL**: `https://farm-controlling.pages.dev` (oder deine Cloudflare-Domain)
   - **Redirect URLs**: 
     - `https://farm-controlling.pages.dev/app/cockpit.html`
     - `https://farm-controlling.pages.dev/app/herd-entry.html`
     - `http://localhost:3001/**` (für lokales Testing)

## 2. Cloudflare Pages deployen (5 Minuten)

### Option A: Über Cloudflare Dashboard (einfachste Methode)

1. Gehe zu https://dash.cloudflare.com/ → **Workers & Pages** → **Create**
2. Wähle **Pages** → **Connect to Git**
3. Wähle das Repository **Pillinio/farm-bonusrechner**
4. Build-Einstellungen:
   - **Production branch**: `main`
   - **Build command**: (leer lassen — kein Build nötig)
   - **Build output directory**: `/` (Projekt-Root)
5. Klicke **Save and Deploy**
6. Warte ~1 Minute → deine Seite ist unter `https://farm-bonusrechner.pages.dev` (oder ähnlich)

### Option B: Über CLI (falls du wrangler bevorzugst)

```bash
# 1. Im Terminal (nicht in Claude Code):
wrangler login
# Browser öffnet sich → anmelden

# 2. Deployen:
cd /Users/philipp/Projekte/Farm_Controlling/farm-bonusrechner-1
npx wrangler pages deploy . --project-name=farm-controlling

# 3. Bei der ersten Ausführung fragt er nach dem Production Branch → "main" eingeben
```

### Nach dem Deploy

- Hauptseite: `https://farm-controlling.pages.dev/app/cockpit.html`
- Bonusrechner: `https://farm-controlling.pages.dev/farm_bonussystem_komplett.html`
- Herd-Entry: `https://farm-controlling.pages.dev/app/herd-entry.html`
- Login: `https://farm-controlling.pages.dev/app/login.html`

### Eigene Domain (optional)

1. Cloudflare Dashboard → Pages → dein Projekt → **Custom domains**
2. Domain hinzufügen (z.B. `controlling.erichsfelde.farm`)
3. DNS wird automatisch konfiguriert wenn die Domain bei Cloudflare liegt

## 3. Ersten User anlegen

1. Öffne `https://farm-controlling.pages.dev/app/login.html`
2. Gib deine E-Mail-Adresse ein → "Anmeldelink senden"
3. Prüfe dein Postfach → Magic Link klicken
4. Du wirst zum Cockpit weitergeleitet
5. **WICHTIG**: Dein Profil in der DB anlegen (einmalig):
   
   Im Supabase Dashboard → SQL Editor:
   ```sql
   INSERT INTO profiles (id, farm_id, role, display_name) 
   VALUES (
     (SELECT id FROM auth.users ORDER BY created_at DESC LIMIT 1),
     (SELECT id FROM farms WHERE name = 'Erichsfelde'),
     'owner',
     'Philipp Rocholl'
   );
   ```

## 4. Telegram Bot (optional, 3 Minuten)

1. Öffne Telegram → suche nach **@BotFather**
2. Sende `/newbot` → Name: "Erichsfelde Farm Alert" → Username: `erichsfelde_farm_bot`
3. BotFather gibt dir einen **Token** (z.B. `123456:ABC-DEF...`)
4. Starte eine Gruppe oder sende dem Bot eine Nachricht
5. Finde deine Chat-ID: `https://api.telegram.org/bot<TOKEN>/getUpdates`
6. Im Supabase Dashboard → Edge Functions → Secrets:
   - `TELEGRAM_BOT_TOKEN` = dein Token
   - `TELEGRAM_CHAT_ID` = deine Chat-ID
