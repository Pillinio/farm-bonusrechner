-- pg_cron scheduling preparation
-- The actual cron.schedule() calls must be run manually in the Supabase SQL Editor
-- because pg_cron requires superuser privileges not available during migrations.

-- Helper schema for internal functions
create schema if not exists internal;

-- Helper: build auth headers from Vault secret
-- Run FIRST: select vault.create_secret('<service-role-key>', 'service_role_key');
create or replace function internal.edge_function_headers()
returns jsonb language sql security definer stable as $$
  select jsonb_build_object(
    'Authorization', 'Bearer ' || coalesce(
      (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
      'missing-key'
    ),
    'Content-Type', 'application/json'
  );
$$;

-- ============================================================
-- MANUAL SETUP: Run these in Supabase SQL Editor after migration
-- ============================================================
--
-- Step 1: Enable pg_cron and pg_net in Dashboard > Database > Extensions
--
-- Step 2: Store service_role_key in Vault:
--   select vault.create_secret(
--     'eyJhbGciOiJIUzI1NiIs...your-key...',
--     'service_role_key',
--     'Service role key for pg_cron Edge Function calls'
--   );
--
-- Step 3: Create cron jobs (paste into SQL Editor):
--
--   select cron.schedule('alerts-hourly', '0 * * * *', $$
--     select net.http_post(
--       url := 'https://vhwlcnfxslkftswksqrw.supabase.co/functions/v1/alerts',
--       headers := internal.edge_function_headers(),
--       body := '{}'::jsonb
--     );
--   $$);
--
--   select cron.schedule('health-check-6h', '0 */6 * * *', $$
--     select net.http_post(
--       url := 'https://vhwlcnfxslkftswksqrw.supabase.co/functions/v1/health-check',
--       headers := internal.edge_function_headers(),
--       body := '{}'::jsonb
--     );
--   $$);
--
--   select cron.schedule('reminder-monthly', '0 8 1 * *', $$
--     select net.http_post(
--       url := 'https://vhwlcnfxslkftswksqrw.supabase.co/functions/v1/reminder',
--       headers := internal.edge_function_headers(),
--       body := '{}'::jsonb
--     );
--   $$);
--
-- Step 4: Verify:
--   select jobid, schedule, command from cron.job;
