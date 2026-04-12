// supabase/functions/alerts/index.ts
// Edge Function: evaluates alert rules against live data, inserts alert_history,
// optionally sends Telegram notifications.
// Trigger via pg_cron (daily) or manual invocation.
// Required env vars: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface AlertRule {
  id: string;
  farm_id: string;
  kpi_id: string;
  name: string;
  condition_sql: string;
  threshold_yellow: string | null;
  threshold_red: string | null;
}

interface CheckResult {
  kpi_id: string;
  rule_id: string;
  rule_name: string;
  severity: "yellow" | "red" | null;
  value: number | null;
  message: string;
  skipped: boolean;
}

type SupabaseClient = ReturnType<typeof createClient>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Determine severity by comparing value against thresholds (ascending = higher is worse). */
function severityAscending(
  value: number,
  yellowStr: string | null,
  redStr: string | null,
): "yellow" | "red" | null {
  const yellow = yellowStr != null ? parseFloat(yellowStr) : null;
  const red = redStr != null ? parseFloat(redStr) : null;

  if (red != null && value >= red) return "red";
  if (yellow != null && value >= yellow) return "yellow";
  return null;
}

/** Determine severity by comparing value against thresholds (descending = lower is worse). */
function severityDescending(
  value: number,
  yellowStr: string | null,
  redStr: string | null,
): "yellow" | "red" | null {
  const yellow = yellowStr != null ? parseFloat(yellowStr) : null;
  const red = redStr != null ? parseFloat(redStr) : null;

  if (red != null && value <= red) return "red";
  if (yellow != null && value <= yellow) return "yellow";
  return null;
}

// ---------------------------------------------------------------------------
// KPI check implementations
// ---------------------------------------------------------------------------

/** F1: Cash Runway — latest balance / avg monthly outflow */
async function checkF1(
  supabase: SupabaseClient,
  rule: AlertRule,
): Promise<CheckResult> {
  const base: Omit<CheckResult, "severity" | "value" | "message" | "skipped"> = {
    kpi_id: rule.kpi_id,
    rule_id: rule.id,
    rule_name: rule.name,
  };

  // Latest balance
  const { data: balRow, error: balErr } = await supabase
    .from("account_balances")
    .select("balance_nad")
    .order("balance_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (balErr || !balRow) {
    return { ...base, severity: null, value: null, message: "Keine Kontostände vorhanden", skipped: true };
  }

  const balance = Number(balRow.balance_nad);

  // Average monthly outflow from budgets (actual_nad < 0, excluding annual summary month=0)
  const { data: budgetRows, error: budErr } = await supabase
    .from("budgets")
    .select("actual_nad")
    .gt("month", 0)
    .lt("actual_nad", 0);

  if (budErr || !budgetRows || budgetRows.length === 0) {
    return { ...base, severity: null, value: null, message: "Keine Budget-Ausgabendaten vorhanden", skipped: true };
  }

  const totalOutflow = budgetRows.reduce((sum, r) => sum + Math.abs(Number(r.actual_nad)), 0);
  const avgMonthly = totalOutflow / budgetRows.length;

  if (avgMonthly === 0) {
    return { ...base, severity: null, value: null, message: "Durchschnittlicher Monatsabfluss ist 0", skipped: true };
  }

  const months = balance / avgMonthly;
  const roundedMonths = Math.round(months * 10) / 10;

  // Lower months = worse → descending severity
  const severity = severityDescending(months, rule.threshold_yellow, rule.threshold_red);
  const message = severity
    ? `Cash Runway: ${roundedMonths} Monate (Schwelle ${severity === "red" ? rule.threshold_red : rule.threshold_yellow})`
    : `Cash Runway: ${roundedMonths} Monate — OK`;

  return { ...base, severity, value: roundedMonths, message, skipped: false };
}

/** F2: Budget deviation — max absolute deviation % from annual budget (month=0) */
async function checkF2(
  supabase: SupabaseClient,
  rule: AlertRule,
): Promise<CheckResult> {
  const base: Omit<CheckResult, "severity" | "value" | "message" | "skipped"> = {
    kpi_id: rule.kpi_id,
    rule_id: rule.id,
    rule_name: rule.name,
  };

  const { data: rows, error } = await supabase
    .from("budgets")
    .select("category, planned_nad, actual_nad")
    .eq("month", 0)
    .gt("planned_nad", 0);

  if (error || !rows || rows.length === 0) {
    return { ...base, severity: null, value: null, message: "Keine Jahresbudget-Daten (month=0) vorhanden", skipped: true };
  }

  let maxDeviation = 0;
  let worstCategory = "";
  for (const row of rows) {
    const planned = Number(row.planned_nad);
    const actual = Number(row.actual_nad);
    if (planned === 0) continue;
    const deviation = Math.abs((actual - planned) / planned) * 100;
    if (deviation > maxDeviation) {
      maxDeviation = deviation;
      worstCategory = row.category;
    }
  }

  const rounded = Math.round(maxDeviation * 10) / 10;
  // Higher deviation = worse → ascending severity
  const severity = severityAscending(maxDeviation, rule.threshold_yellow, rule.threshold_red);
  const message = severity
    ? `Budget-Abweichung: ${rounded}% in "${worstCategory}" (Schwelle ${severity === "red" ? rule.threshold_red : rule.threshold_yellow}%)`
    : `Budget-Abweichung: max ${rounded}% — OK`;

  return { ...base, severity, value: rounded, message, skipped: false };
}

/** H3: Mortality rate — deaths / total from latest herd snapshot */
async function checkH3(
  supabase: SupabaseClient,
  rule: AlertRule,
): Promise<CheckResult> {
  const base: Omit<CheckResult, "severity" | "value" | "message" | "skipped"> = {
    kpi_id: rule.kpi_id,
    rule_id: rule.id,
    rule_name: rule.name,
  };

  const { data: snap, error } = await supabase
    .from("herd_snapshots")
    .select("cows, bulls, heifers, calves, oxen, deaths")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !snap) {
    return { ...base, severity: null, value: null, message: "Keine Herdensnapshots vorhanden", skipped: true };
  }

  const total = Number(snap.cows) + Number(snap.bulls) + Number(snap.heifers) +
    Number(snap.calves) + Number(snap.oxen);
  const deaths = Number(snap.deaths ?? 0);

  if (total === 0) {
    return { ...base, severity: null, value: null, message: "Herdenbestand ist 0", skipped: true };
  }

  const mortalityPct = (deaths / total) * 100;
  const rounded = Math.round(mortalityPct * 100) / 100;

  const severity = severityAscending(mortalityPct, rule.threshold_yellow, rule.threshold_red);
  const message = severity
    ? `Mortalitätsrate: ${rounded}% (${deaths}/${total}) — Schwelle ${severity === "red" ? rule.threshold_red : rule.threshold_yellow}%`
    : `Mortalitätsrate: ${rounded}% — OK`;

  return { ...base, severity, value: rounded, message, skipped: false };
}

/** W1: Stocking density — total_lsu / (sum area_ha × carrying_capacity lsu_per_ha) */
async function checkW1(
  supabase: SupabaseClient,
  rule: AlertRule,
): Promise<CheckResult> {
  const base: Omit<CheckResult, "severity" | "value" | "message" | "skipped"> = {
    kpi_id: rule.kpi_id,
    rule_id: rule.id,
    rule_name: rule.name,
  };

  // Latest herd snapshot for total_lsu
  const { data: snap, error: snapErr } = await supabase
    .from("herd_snapshots")
    .select("total_lsu")
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (snapErr || !snap || snap.total_lsu == null) {
    return { ...base, severity: null, value: null, message: "Keine LSU-Daten in Herdensnapshots", skipped: true };
  }

  const totalLsu = Number(snap.total_lsu);

  // Sum of camp areas
  const { data: camps, error: campErr } = await supabase
    .from("farm_camps")
    .select("area_ha")
    .eq("active", true);

  if (campErr || !camps || camps.length === 0) {
    return { ...base, severity: null, value: null, message: "Keine aktiven Camps mit Flächenangabe", skipped: true };
  }

  const totalAreaHa = camps.reduce((sum, c) => sum + (Number(c.area_ha) || 0), 0);
  if (totalAreaHa === 0) {
    return { ...base, severity: null, value: null, message: "Gesamtfläche der Camps ist 0", skipped: true };
  }

  // Latest carrying capacity assumption
  const { data: ccRow, error: ccErr } = await supabase
    .from("carrying_capacity_assumptions")
    .select("lsu_per_ha")
    .order("effective_from", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (ccErr || !ccRow) {
    return { ...base, severity: null, value: null, message: "Keine Tragfähigkeitsannahmen vorhanden", skipped: true };
  }

  const lsuPerHa = Number(ccRow.lsu_per_ha);
  if (lsuPerHa === 0) {
    return { ...base, severity: null, value: null, message: "LSU/ha ist 0", skipped: true };
  }

  const maxCapacity = totalAreaHa * lsuPerHa;
  const stockingRatio = (totalLsu / maxCapacity) * 100;
  const rounded = Math.round(stockingRatio * 10) / 10;

  const severity = severityAscending(stockingRatio, rule.threshold_yellow, rule.threshold_red);
  const message = severity
    ? `Besatzdichte: ${rounded}% (${totalLsu} LSU / ${Math.round(maxCapacity)} max) — Schwelle ${severity === "red" ? rule.threshold_red : rule.threshold_yellow}%`
    : `Besatzdichte: ${rounded}% — OK`;

  return { ...base, severity, value: rounded, message, skipped: false };
}

/** O2: Open maintenance — unresolved incidents older than 30 days */
async function checkO2(
  supabase: SupabaseClient,
  rule: AlertRule,
): Promise<CheckResult> {
  const base: Omit<CheckResult, "severity" | "value" | "message" | "skipped"> = {
    kpi_id: rule.kpi_id,
    rule_id: rule.id,
    rule_name: rule.name,
  };

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const cutoff = thirtyDaysAgo.toISOString().split("T")[0];

  // Incidents without resolution (resolution IS NULL) and older than 30 days
  const { data: rows, error, count } = await supabase
    .from("incidents")
    .select("id", { count: "exact", head: true })
    .is("resolution", null)
    .lt("incident_date", cutoff);

  if (error) {
    return { ...base, severity: null, value: null, message: `Fehler beim Abrufen offener Incidents: ${error.message}`, skipped: true };
  }

  const openCount = count ?? 0;

  const severity = severityAscending(openCount, rule.threshold_yellow, rule.threshold_red);
  const message = severity
    ? `Offene Incidents (>30 Tage): ${openCount} — Schwelle ${severity === "red" ? rule.threshold_red : rule.threshold_yellow}`
    : `Offene Incidents (>30 Tage): ${openCount} — OK`;

  return { ...base, severity, value: openCount, message, skipped: false };
}

// ---------------------------------------------------------------------------
// KPI dispatcher
// ---------------------------------------------------------------------------

const KPI_CHECKERS: Record<string, (s: SupabaseClient, r: AlertRule) => Promise<CheckResult>> = {
  F1: checkF1,
  F2: checkF2,
  H3: checkH3,
  W1: checkW1,
  O2: checkO2,
};

// ---------------------------------------------------------------------------
// Deduplication: don't re-alert if same KPI+severity was alerted in last 24h
// ---------------------------------------------------------------------------

async function wasRecentlyAlerted(
  supabase: SupabaseClient,
  farmId: string,
  kpiId: string,
  severity: string,
): Promise<boolean> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("alert_history")
    .select("id")
    .eq("farm_id", farmId)
    .eq("kpi_id", kpiId)
    .eq("severity", severity)
    .gte("notified_at", since)
    .limit(1);

  if (error) return false; // on error, allow re-alert
  return (data?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Telegram notification
// ---------------------------------------------------------------------------

interface TelegramResult {
  sent: boolean;
  error?: string;
}

async function sendTelegramNotification(results: CheckResult[]): Promise<TelegramResult> {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

  if (!token || !chatId) {
    const msg = "Telegram not configured: " + (!token ? "TELEGRAM_BOT_TOKEN" : "TELEGRAM_CHAT_ID") + " missing";
    console.error(msg);
    return { sent: false, error: msg };
  }

  const triggered = results.filter((r) => r.severity != null && !r.skipped);
  if (triggered.length === 0) {
    return { sent: false };
  }

  const redAlerts = triggered.filter((r) => r.severity === "red");
  const yellowAlerts = triggered.filter((r) => r.severity === "yellow");

  let text = "Farm Alert Report\n\n";

  if (redAlerts.length > 0) {
    text += "ROT:\n";
    for (const a of redAlerts) {
      text += `  [${a.kpi_id}] ${a.message}\n`;
    }
    text += "\n";
  }

  if (yellowAlerts.length > 0) {
    text += "GELB:\n";
    for (const a of yellowAlerts) {
      text += `  [${a.kpi_id}] ${a.message}\n`;
    }
  }

  try {
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const result = await res.json();
    if (result.ok === true) {
      return { sent: true };
    }
    const errorMsg = `Telegram API error: ${result.error_code} — ${result.description}`;
    console.error(errorMsg);
    return { sent: false, error: errorMsg };
  } catch (err) {
    const errorMsg = `Telegram fetch failed: ${(err as Error).message}`;
    console.error(errorMsg);
    return { sent: false, error: errorMsg };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const logger = createLogger(supabase, "edge:alerts");

  // Load active alert rules
  const { data: rules, error: rulesErr } = await supabase
    .from("alert_rules")
    .select("*")
    .eq("active", true);

  if (rulesErr) {
    return json({ error: `Failed to load alert rules: ${rulesErr.message}` }, 500);
  }

  if (!rules || rules.length === 0) {
    return json({ status: "ok", message: "No active alert rules found", checked: 0, triggered: 0 });
  }

  const results: CheckResult[] = [];

  for (const rule of rules as AlertRule[]) {
    const checker = KPI_CHECKERS[rule.kpi_id];
    if (!checker) {
      // KPI not yet implemented — skip gracefully
      results.push({
        kpi_id: rule.kpi_id,
        rule_id: rule.id,
        rule_name: rule.name,
        severity: null,
        value: null,
        message: `KPI ${rule.kpi_id} check not yet implemented — skipped`,
        skipped: true,
      });
      continue;
    }

    try {
      const result = await checker(supabase, rule);
      results.push(result);

      // If alert triggered and not recently alerted, insert into history
      if (result.severity && !result.skipped) {
        const duplicate = await wasRecentlyAlerted(
          supabase,
          rule.farm_id,
          rule.kpi_id,
          result.severity,
        );

        if (!duplicate) {
          await supabase.from("alert_history").insert({
            farm_id: rule.farm_id,
            rule_id: rule.id,
            kpi_id: rule.kpi_id,
            severity: result.severity,
            message: result.message,
            value_current: result.value != null ? String(result.value) : null,
          });
        } else {
          result.message += " (dedupliziert, bereits in den letzten 24h gemeldet)";
        }
      }
    } catch (err) {
      results.push({
        kpi_id: rule.kpi_id,
        rule_id: rule.id,
        rule_name: rule.name,
        severity: null,
        value: null,
        message: `Error checking ${rule.kpi_id}: ${(err as Error).message}`,
        skipped: true,
      });
    }
  }

  // Send Telegram notification for any new alerts
  const telegramResult = await sendTelegramNotification(
    results.filter((r) => !r.message.includes("dedupliziert")),
  );

  const triggered = results.filter((r) => r.severity != null && !r.skipped);

  // Log each check result
  for (const r of results) {
    if (r.severity) {
      await logger.warn(`Alert triggered: ${r.kpi_id} = ${r.severity}`, {
        kpi_id: r.kpi_id,
        severity: r.severity,
        value: r.value,
        telegram_sent: telegramResult.sent,
      });
    } else {
      await logger.info(`Alert check OK: ${r.kpi_id}`, { kpi_id: r.kpi_id, message: r.message });
    }
  }

  return json({
    status: "ok",
    checked: results.length,
    triggered: triggered.length,
    skipped: results.filter((r) => r.skipped).length,
    telegram: telegramResult,
    details: results,
  });
});
