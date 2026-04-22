// supabase/functions/health-check/index.ts
// Edge Function: checks data freshness across key tables and alerts on staleness.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { verifyAuth } from "../_shared/auth.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface CheckResult {
  table: string;
  status: "ok" | "stale" | "empty";
  latest_record?: string | null;
  max_age_hours: number;
  actual_age_hours?: number | null;
  message: string;
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Auth: service-role only (cron-only endpoint)
  const auth = await verifyAuth(req, supabase, { allow: ["service"] });
  if (!auth) return json({ error: "unauthorized" }, 401);

  const logger = createLogger(supabase, "edge:health-check");
  const now = new Date();
  const results: CheckResult[] = [];

  // --- 1. weather_observations: latest < 2 days old ---
  try {
    const { data: weatherRow, error } = await supabase
      .from("weather_observations")
      .select("observation_date")
      .order("observation_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const maxAgeHours = 48;
    if (!weatherRow) {
      results.push({ table: "weather_observations", status: "empty", max_age_hours: maxAgeHours, message: "No records found" });
    } else {
      const latestDate = new Date(weatherRow.observation_date + "T00:00:00Z");
      const ageHours = (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60);
      const status = ageHours <= maxAgeHours ? "ok" : "stale";
      results.push({
        table: "weather_observations",
        status,
        latest_record: weatherRow.observation_date,
        max_age_hours: maxAgeHours,
        actual_age_hours: Math.round(ageHours * 10) / 10,
        message: status === "ok" ? "Fresh" : `Stale: ${Math.round(ageHours)}h old (max ${maxAgeHours}h)`,
      });
    }
  } catch (err) {
    results.push({ table: "weather_observations", status: "stale", max_age_hours: 48, message: `Error: ${(err as Error).message}` });
  }

  // --- 2. market_prices (fx): latest < 3 days old ---
  try {
    const { data: fxRow, error } = await supabase
      .from("market_prices")
      .select("price_date")
      .order("price_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const maxAgeHours = 72;
    if (!fxRow) {
      results.push({ table: "market_prices", status: "empty", max_age_hours: maxAgeHours, message: "No records found" });
    } else {
      const latestDate = new Date(fxRow.price_date + "T00:00:00Z");
      const ageHours = (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60);
      const status = ageHours <= maxAgeHours ? "ok" : "stale";
      results.push({
        table: "market_prices",
        status,
        latest_record: fxRow.price_date,
        max_age_hours: maxAgeHours,
        actual_age_hours: Math.round(ageHours * 10) / 10,
        message: status === "ok" ? "Fresh" : `Stale: ${Math.round(ageHours)}h old (max ${maxAgeHours}h)`,
      });
    }
  } catch (err) {
    results.push({ table: "market_prices", status: "stale", max_age_hours: 72, message: `Error: ${(err as Error).message}` });
  }

  // --- 3. raw_events: if any exist, latest < 24h old ---
  try {
    const { data: rawRow, error } = await supabase
      .from("raw_events")
      .select("created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const maxAgeHours = 24;
    if (!rawRow) {
      // No raw events is not necessarily a failure — just note it
      results.push({ table: "raw_events", status: "ok", max_age_hours: maxAgeHours, message: "No records yet (not required)" });
    } else {
      const latestDate = new Date(rawRow.created_at);
      const ageHours = (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60);
      const status = ageHours <= maxAgeHours ? "ok" : "stale";
      results.push({
        table: "raw_events",
        status,
        latest_record: rawRow.created_at,
        max_age_hours: maxAgeHours,
        actual_age_hours: Math.round(ageHours * 10) / 10,
        message: status === "ok" ? "Fresh" : `Stale: ${Math.round(ageHours)}h old (max ${maxAgeHours}h)`,
      });
    }
  } catch (err) {
    results.push({ table: "raw_events", status: "stale", max_age_hours: 24, message: `Error: ${(err as Error).message}` });
  }

  // --- 4. herd_snapshots: latest < 35 days old (monthly cadence) ---
  try {
    const { data: herdRow, error } = await supabase
      .from("herd_snapshots")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    const maxAgeHours = 35 * 24; // 840h
    if (!herdRow) {
      results.push({ table: "herd_snapshots", status: "empty", max_age_hours: maxAgeHours, message: "No records found" });
    } else {
      const latestDate = new Date(herdRow.snapshot_date + "T00:00:00Z");
      const ageHours = (now.getTime() - latestDate.getTime()) / (1000 * 60 * 60);
      const status = ageHours <= maxAgeHours ? "ok" : "stale";
      results.push({
        table: "herd_snapshots",
        status,
        latest_record: herdRow.snapshot_date,
        max_age_hours: maxAgeHours,
        actual_age_hours: Math.round(ageHours * 10) / 10,
        message: status === "ok" ? "Fresh" : `Stale: ${Math.round(ageHours / 24)} days old (max 35 days)`,
      });
    }
  } catch (err) {
    results.push({ table: "herd_snapshots", status: "stale", max_age_hours: 840, message: `Error: ${(err as Error).message}` });
  }

  // --- Insert alerts for stale/empty checks ---
  const failures = results.filter((r) => r.status === "stale" || r.status === "empty");
  for (const failure of failures) {
    try {
      await supabase.from("alert_history").insert({
        kpi_id: "SYS",
        severity: "red",
        message: `Health check: ${failure.table} — ${failure.message}`,
        value_current: failure.actual_age_hours != null ? String(failure.actual_age_hours) : null,
      });
    } catch {
      // Best effort
    }
  }

  // Log results
  const allOk = failures.length === 0;
  if (allOk) {
    await logger.info("All health checks passed", { results });
  } else {
    await logger.warn(`${failures.length} health check(s) failed`, { failures: failures.map((f) => f.table) });
  }

  return json({
    status: allOk ? "healthy" : "degraded",
    checked_at: now.toISOString(),
    checks: results,
    failures: failures.length,
  });
});
