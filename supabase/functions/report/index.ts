// supabase/functions/report/index.ts
// Edge Function: generates a quarterly farm report as structured JSON.
// GET  /report?quarter=2026-Q1       → returns JSON report
// POST /report?quarter=2026-Q1&send=true → generates and emails via Resend

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface QuarterlyReport {
  farm: string;
  quarter: string;
  generated_at: string;

  finance: {
    cash_runway_months: number | null;
    budget_deviation_top3: Array<{ category: string; deviation_pct: number }>;
    revenue_ytd: number | null;
    costs_ytd: number | null;
    ebit_ytd: number | null;
    cost_per_kg: number | null;
  } | null;

  herd: {
    total_animals: number | null;
    total_lsu: number | null;
    net_growth: number | null;
    calving_rate_pct: number | null;
    mortality_rate_pct: number | null;
  } | null;

  pasture: {
    stocking_rate_pct: number | null;
    avg_pasture_condition: number | null;
    rainfall_vs_normal_pct: number | null;
  } | null;

  operations: {
    vaccination_coverage_pct: number | null;
    open_maintenance_count: number | null;
    incidents_count: number | null;
  } | null;

  alerts: Array<{ kpi_id: string; severity: string; message: string }>;

  bonus_estimate: {
    ebit: number | null;
    total_bonus: number | null;
    productivity_index: number | null;
  } | null;

  data_quality: Array<{ source: string; status: "ok" | "partial" | "missing"; note?: string }>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Parse "2026-Q1" into { year, quarter, startDate, endDate } */
function parseQuarter(q: string): { year: number; quarter: number; startDate: string; endDate: string } {
  const match = q.match(/^(\d{4})-Q([1-4])$/);
  if (!match) throw new Error(`Invalid quarter format '${q}'. Expected YYYY-QN, e.g. 2026-Q1`);

  const year = parseInt(match[1]);
  const quarter = parseInt(match[2]);
  const startMonth = (quarter - 1) * 3 + 1;
  const endMonth = startMonth + 3; // exclusive

  const startDate = `${year}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = endMonth > 12
    ? `${year + 1}-01-01`
    : `${year}-${String(endMonth).padStart(2, "0")}-01`;

  return { year, quarter, startDate, endDate };
}

/** Year-to-date start: January 1 of the given year */
function ytdStart(year: number): string {
  return `${year}-01-01`;
}

// ---------------------------------------------------------------------------
// Section queries
// ---------------------------------------------------------------------------

async function queryFinance(
  sb: SupabaseClient,
  startDate: string,
  endDate: string,
  year: number,
): Promise<{ data: QuarterlyReport["finance"]; quality: QuarterlyReport["data_quality"] }> {
  const quality: QuarterlyReport["data_quality"] = [];
  const ytd = ytdStart(year);

  // 1. Cash runway: latest balance / avg monthly costs
  const { data: balances, error: balErr } = await sb
    .from("account_balances")
    .select("balance_nad")
    .lt("balance_date", endDate)
    .order("balance_date", { ascending: false })
    .limit(1);

  if (balErr || !balances?.length) {
    quality.push({ source: "account_balances", status: "missing", note: "No balance data found" });
  } else {
    quality.push({ source: "account_balances", status: "ok" });
  }

  // 2. Transactions YTD for revenue/costs
  const { data: txns, error: txErr } = await sb
    .from("transactions")
    .select("amount_nad, category")
    .gte("transaction_date", ytd)
    .lt("transaction_date", endDate);

  if (txErr || !txns?.length) {
    quality.push({ source: "transactions", status: txErr ? "missing" : "partial", note: txErr?.message ?? "No transactions in period" });
  } else {
    quality.push({ source: "transactions", status: "ok" });
  }

  // 3. Budget deviations for the quarter
  const { data: budgets, error: budErr } = await sb
    .from("budgets")
    .select("category, planned_nad, actual_nad")
    .eq("fiscal_year", year);

  if (budErr || !budgets?.length) {
    quality.push({ source: "budgets", status: budErr ? "missing" : "partial", note: budErr?.message ?? "No budget data" });
  } else {
    quality.push({ source: "budgets", status: "ok" });
  }

  // 4. Slaughter data for cost_per_kg
  const { data: slaughterItems, error: slErr } = await sb
    .from("slaughter_line_items")
    .select("cold_mass_kg, report_id, slaughter_reports!inner(report_date)")
    .gte("slaughter_reports.report_date", ytd)
    .lt("slaughter_reports.report_date", endDate);

  if (slErr) {
    quality.push({ source: "slaughter_line_items", status: "missing", note: slErr.message });
  } else {
    quality.push({ source: "slaughter_line_items", status: slaughterItems?.length ? "ok" : "partial" });
  }

  // Compute values
  const latestBalance = balances?.[0]?.balance_nad ?? null;

  const revenueYtd = txns
    ?.filter((t: { amount_nad: number }) => t.amount_nad > 0)
    .reduce((sum: number, t: { amount_nad: number }) => sum + Number(t.amount_nad), 0) ?? null;

  const costsYtd = txns
    ?.filter((t: { amount_nad: number }) => t.amount_nad < 0)
    .reduce((sum: number, t: { amount_nad: number }) => sum + Math.abs(Number(t.amount_nad)), 0) ?? null;

  const ebitYtd = revenueYtd != null && costsYtd != null ? revenueYtd - costsYtd : null;

  // Monthly cost average for runway
  const monthsElapsed = Math.max(1, monthsBetween(ytd, endDate));
  const avgMonthlyCost = costsYtd != null ? costsYtd / monthsElapsed : null;
  const cashRunway = latestBalance != null && avgMonthlyCost != null && avgMonthlyCost > 0
    ? Math.round((latestBalance / avgMonthlyCost) * 10) / 10
    : null;

  // Budget deviation top 3
  const deviations = (budgets ?? [])
    .filter((b: { planned_nad: number }) => Number(b.planned_nad) !== 0)
    .map((b: { category: string; planned_nad: number; actual_nad: number }) => ({
      category: b.category,
      deviation_pct: Math.round(((Number(b.actual_nad) - Number(b.planned_nad)) / Number(b.planned_nad)) * 1000) / 10,
    }))
    .sort((a: { deviation_pct: number }, b: { deviation_pct: number }) => Math.abs(b.deviation_pct) - Math.abs(a.deviation_pct))
    .slice(0, 3);

  // Cost per kg
  const totalSlaughterKg = slaughterItems?.reduce(
    (sum: number, li: { cold_mass_kg: number }) => sum + Number(li.cold_mass_kg), 0,
  ) ?? 0;
  const costPerKg = costsYtd != null && totalSlaughterKg > 0
    ? Math.round((costsYtd / totalSlaughterKg) * 100) / 100
    : null;

  if (latestBalance == null && !txns?.length && !budgets?.length) {
    return { data: null, quality };
  }

  return {
    data: {
      cash_runway_months: cashRunway,
      budget_deviation_top3: deviations,
      revenue_ytd: revenueYtd,
      costs_ytd: costsYtd,
      ebit_ytd: ebitYtd,
      cost_per_kg: costPerKg,
    },
    quality,
  };
}

function monthsBetween(start: string, end: string): number {
  const s = new Date(start);
  const e = new Date(end);
  return (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
}

async function queryHerd(
  sb: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<{ data: QuarterlyReport["herd"]; quality: QuarterlyReport["data_quality"] }> {
  const quality: QuarterlyReport["data_quality"] = [];

  // Latest snapshot within or before the quarter end
  const { data: latest, error: latErr } = await sb
    .from("herd_snapshots")
    .select("*")
    .lt("snapshot_date", endDate)
    .order("snapshot_date", { ascending: false })
    .limit(1);

  if (latErr || !latest?.length) {
    quality.push({ source: "herd_snapshots", status: "missing", note: latErr?.message ?? "No herd snapshots found" });
    return { data: null, quality };
  }

  quality.push({ source: "herd_snapshots", status: "ok" });
  const snap = latest[0];
  const totalAnimals = (snap.cows ?? 0) + (snap.bulls ?? 0) + (snap.heifers ?? 0) + (snap.calves ?? 0) + (snap.oxen ?? 0);

  // Previous snapshot for net growth
  const { data: prev } = await sb
    .from("herd_snapshots")
    .select("cows, bulls, heifers, calves, oxen, total_lsu")
    .lt("snapshot_date", startDate)
    .order("snapshot_date", { ascending: false })
    .limit(1);

  let netGrowth: number | null = null;
  if (prev?.length) {
    const prevTotal = (prev[0].cows ?? 0) + (prev[0].bulls ?? 0) + (prev[0].heifers ?? 0) + (prev[0].calves ?? 0) + (prev[0].oxen ?? 0);
    netGrowth = totalAnimals - prevTotal;
  }

  // Aggregate births and deaths from snapshots in the quarter for rates
  const { data: quarterSnaps } = await sb
    .from("herd_snapshots")
    .select("births, deaths, cows")
    .gte("snapshot_date", startDate)
    .lt("snapshot_date", endDate);

  let calvingRate: number | null = null;
  let mortalityRate: number | null = null;

  if (quarterSnaps?.length) {
    const totalBirths = quarterSnaps.reduce((s: number, r: { births: number }) => s + (r.births ?? 0), 0);
    const totalDeaths = quarterSnaps.reduce((s: number, r: { deaths: number }) => s + (r.deaths ?? 0), 0);
    const avgCows = quarterSnaps.reduce((s: number, r: { cows: number }) => s + (r.cows ?? 0), 0) / quarterSnaps.length;

    calvingRate = avgCows > 0 ? Math.round((totalBirths / avgCows) * 1000) / 10 : null;
    mortalityRate = totalAnimals > 0 ? Math.round((totalDeaths / totalAnimals) * 1000) / 10 : null;
  }

  return {
    data: {
      total_animals: totalAnimals,
      total_lsu: snap.total_lsu != null ? Number(snap.total_lsu) : null,
      net_growth: netGrowth,
      calving_rate_pct: calvingRate,
      mortality_rate_pct: mortalityRate,
    },
    quality,
  };
}

async function queryPasture(
  sb: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<{ data: QuarterlyReport["pasture"]; quality: QuarterlyReport["data_quality"] }> {
  const quality: QuarterlyReport["data_quality"] = [];

  // Pasture condition average for the quarter — ab 2026-04 aus camp_vegetation
  const { data: pasture, error: pastureErr } = await sb
    .from("camp_vegetation")
    .select("condition_score")
    .gte("observation_date", startDate)
    .lt("observation_date", endDate);

  if (pastureErr || !pasture?.length) {
    quality.push({ source: "camp_vegetation", status: pastureErr ? "missing" : "partial", note: pastureErr?.message ?? "No camp vegetation observations in period" });
  } else {
    quality.push({ source: "camp_vegetation", status: "ok" });
  }

  // Carrying capacity for stocking rate
  const { data: capacity } = await sb
    .from("carrying_capacity_assumptions")
    .select("lsu_per_ha")
    .lte("effective_from", endDate)
    .order("effective_from", { ascending: false })
    .limit(1);

  // Total farm area
  const { data: camps, error: campErr } = await sb
    .from("farm_camps")
    .select("area_ha")
    .eq("active", true);

  if (campErr || !camps?.length) {
    quality.push({ source: "farm_camps", status: campErr ? "missing" : "partial", note: campErr?.message ?? "No camp data" });
  } else {
    quality.push({ source: "farm_camps", status: "ok" });
  }

  // Rainfall in quarter vs normal (we approximate normal as same-quarter average from all historical data)
  const { data: rainfall, error: rainErr } = await sb
    .from("weather_observations")
    .select("rainfall_mm, observation_date")
    .gte("observation_date", startDate)
    .lt("observation_date", endDate);

  if (rainErr || !rainfall?.length) {
    quality.push({ source: "weather_observations", status: rainErr ? "missing" : "partial", note: rainErr?.message ?? "No weather data in period" });
  } else {
    quality.push({ source: "weather_observations", status: "ok" });
  }

  const pastureScored = (pasture ?? []).filter(
    (v: { condition_score: number | null }) => v.condition_score != null,
  );
  const avgPastureCondition = pastureScored.length
    ? Math.round((pastureScored.reduce((s: number, v: { condition_score: number }) => s + v.condition_score, 0) / pastureScored.length) * 10) / 10
    : null;

  // Stocking rate: (current LSU / max LSU based on capacity) * 100
  let stockingRate: number | null = null;
  if (capacity?.length && camps?.length) {
    const totalHa = camps.reduce((s: number, c: { area_ha: number | null }) => s + (c.area_ha != null ? Number(c.area_ha) : 0), 0);
    const maxLsu = totalHa * Number(capacity[0].lsu_per_ha);

    // Get latest herd LSU
    const { data: latestHerd } = await sb
      .from("herd_snapshots")
      .select("total_lsu")
      .lt("snapshot_date", endDate)
      .order("snapshot_date", { ascending: false })
      .limit(1);

    if (latestHerd?.length && maxLsu > 0) {
      stockingRate = Math.round((Number(latestHerd[0].total_lsu) / maxLsu) * 1000) / 10;
    }
  }

  // Rainfall vs normal: without multi-year historical data, just report total mm
  // When more data accumulates, this can compare against historical averages
  const totalRainfallMm = rainfall?.reduce(
    (s: number, r: { rainfall_mm: number | null }) => s + (r.rainfall_mm != null ? Number(r.rainfall_mm) : 0), 0,
  ) ?? 0;

  // For now, rainfall_vs_normal_pct is null unless we have historical data to compare
  let rainfallVsNormal: number | null = null;

  // Attempt to get historical average for same quarter across years
  const qMonth1 = parseInt(startDate.split("-")[1]);
  const qMonth3 = qMonth1 + 2;
  const { data: allRainfall } = await sb
    .from("weather_observations")
    .select("rainfall_mm, observation_date");

  if (allRainfall?.length && totalRainfallMm > 0) {
    const historicalSameQuarter = allRainfall.filter((r: { observation_date: string }) => {
      const m = parseInt(r.observation_date.split("-")[1]);
      return m >= qMonth1 && m <= qMonth3;
    });

    // Group by year and sum
    const byYear: Record<number, number> = {};
    for (const r of historicalSameQuarter) {
      const y = parseInt(r.observation_date.split("-")[0]);
      byYear[y] = (byYear[y] ?? 0) + (r.rainfall_mm != null ? Number(r.rainfall_mm) : 0);
    }

    const years = Object.keys(byYear).map(Number);
    const currentYear = parseInt(endDate.split("-")[0]);
    const pastYears = years.filter((y) => y < currentYear);

    if (pastYears.length > 0) {
      const avgHistorical = pastYears.reduce((s, y) => s + byYear[y], 0) / pastYears.length;
      if (avgHistorical > 0) {
        rainfallVsNormal = Math.round((totalRainfallMm / avgHistorical) * 1000) / 10;
      }
    }
  }

  if (!pasture?.length && !camps?.length && !rainfall?.length) {
    return { data: null, quality };
  }

  return {
    data: {
      stocking_rate_pct: stockingRate,
      avg_pasture_condition: avgPastureCondition,
      rainfall_vs_normal_pct: rainfallVsNormal,
    },
    quality,
  };
}

async function queryOperations(
  sb: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<{ data: QuarterlyReport["operations"]; quality: QuarterlyReport["data_quality"] }> {
  const quality: QuarterlyReport["data_quality"] = [];

  // Vaccination coverage: task_executions with vaccination templates in the quarter
  const { data: vaccTasks, error: vaccErr } = await sb
    .from("task_executions")
    .select("covered_count, target_count, task_templates!inner(category)")
    .eq("task_templates.category", "vaccination")
    .gte("executed_date", startDate)
    .lt("executed_date", endDate);

  if (vaccErr) {
    quality.push({ source: "task_executions (vaccination)", status: "missing", note: vaccErr.message });
  } else {
    quality.push({ source: "task_executions (vaccination)", status: vaccTasks?.length ? "ok" : "partial" });
  }

  // Open maintenance: templates with category 'maintenance' that have no recent execution
  const { data: maintTemplates, error: maintErr } = await sb
    .from("task_templates")
    .select("id, name")
    .eq("category", "maintenance")
    .eq("active", true);

  let openMaintenance: number | null = null;
  if (maintErr) {
    quality.push({ source: "task_templates (maintenance)", status: "missing", note: maintErr.message });
  } else if (maintTemplates?.length) {
    // Count templates without execution in this quarter
    let openCount = 0;
    for (const tmpl of maintTemplates) {
      const { data: execs } = await sb
        .from("task_executions")
        .select("id")
        .eq("template_id", tmpl.id)
        .gte("executed_date", startDate)
        .lt("executed_date", endDate)
        .limit(1);
      if (!execs?.length) openCount++;
    }
    openMaintenance = openCount;
    quality.push({ source: "task_templates (maintenance)", status: "ok" });
  } else {
    quality.push({ source: "task_templates (maintenance)", status: "partial", note: "No maintenance templates defined" });
  }

  // Incidents count
  const { data: incidents, error: incErr } = await sb
    .from("incidents")
    .select("id")
    .gte("incident_date", startDate)
    .lt("incident_date", endDate);

  if (incErr) {
    quality.push({ source: "incidents", status: "missing", note: incErr.message });
  } else {
    quality.push({ source: "incidents", status: "ok" });
  }

  // Vaccination coverage %
  let vaccCoverage: number | null = null;
  if (vaccTasks?.length) {
    const totalCovered = vaccTasks.reduce((s: number, t: { covered_count: number | null }) => s + (t.covered_count ?? 0), 0);
    const totalTarget = vaccTasks.reduce((s: number, t: { target_count: number | null }) => s + (t.target_count ?? 0), 0);
    vaccCoverage = totalTarget > 0 ? Math.round((totalCovered / totalTarget) * 1000) / 10 : null;
  }

  return {
    data: {
      vaccination_coverage_pct: vaccCoverage,
      open_maintenance_count: openMaintenance,
      incidents_count: incidents?.length ?? null,
    },
    quality,
  };
}

async function queryAlerts(
  sb: SupabaseClient,
  startDate: string,
  endDate: string,
): Promise<Array<{ kpi_id: string; severity: string; message: string }>> {
  const { data: alerts } = await sb
    .from("alert_history")
    .select("kpi_id, severity, message")
    .gte("notified_at", startDate)
    .lt("notified_at", endDate)
    .order("notified_at", { ascending: false });

  return (alerts ?? []).map((a: { kpi_id: string; severity: string; message: string }) => ({
    kpi_id: a.kpi_id,
    severity: a.severity,
    message: a.message,
  }));
}

async function queryBonusEstimate(
  sb: SupabaseClient,
  endDate: string,
  year: number,
): Promise<{ data: QuarterlyReport["bonus_estimate"]; quality: QuarterlyReport["data_quality"] }> {
  const quality: QuarterlyReport["data_quality"] = [];
  const ytd = ytdStart(year);

  // Get transactions YTD for revenue/costs
  const { data: txns } = await sb
    .from("transactions")
    .select("amount_nad")
    .gte("transaction_date", ytd)
    .lt("transaction_date", endDate);

  // Get slaughter weight YTD
  const { data: slaughterItems } = await sb
    .from("slaughter_line_items")
    .select("cold_mass_kg, slaughter_reports!inner(report_date)")
    .gte("slaughter_reports.report_date", ytd)
    .lt("slaughter_reports.report_date", endDate);

  // Get bonus parameters
  const { data: bonusParams } = await sb
    .from("bonus_parameters")
    .select("params")
    .lte("effective_from", endDate)
    .order("effective_from", { ascending: false })
    .limit(1);

  if (!txns?.length) {
    quality.push({ source: "bonus_estimate", status: "partial", note: "No transaction data for bonus calculation" });
    return { data: null, quality };
  }

  quality.push({ source: "bonus_estimate", status: "ok" });

  const revenue = txns.filter((t: { amount_nad: number }) => Number(t.amount_nad) > 0)
    .reduce((s: number, t: { amount_nad: number }) => s + Number(t.amount_nad), 0);
  const costs = txns.filter((t: { amount_nad: number }) => Number(t.amount_nad) < 0)
    .reduce((s: number, t: { amount_nad: number }) => s + Math.abs(Number(t.amount_nad)), 0);
  const ebit = revenue - costs;

  const totalSlaughterKg = slaughterItems?.reduce(
    (s: number, li: { cold_mass_kg: number }) => s + Number(li.cold_mass_kg), 0,
  ) ?? 0;

  // Calculate productivity index: kg per 1000 NAD costs
  const productivityIndex = costs > 0 ? (totalSlaughterKg / costs) * 1000 : 0;

  // Simple bonus calculation using progressive tiers (matching bonus-engine.js logic)
  const params = bonusParams?.[0]?.params ?? {};
  const tier1Rate = ((params.tier1Rate as number) ?? 8) / 100;
  const tier2Rate = ((params.tier2Rate as number) ?? 12) / 100;
  const tier3Rate = ((params.tier3Rate as number) ?? 15) / 100;
  const tier4Rate = ((params.tier4Rate as number) ?? 20) / 100;
  const ebitCap = ((params.ebitCap as number) ?? 4) * 1_000_000;

  const cappedEbit = Math.min(Math.max(ebit, 0), ebitCap);
  let ebitBonus = 0;

  // Progressive tiers
  if (cappedEbit > 0) ebitBonus += Math.min(cappedEbit, 100_000) * tier1Rate;
  if (cappedEbit > 100_000) ebitBonus += Math.min(cappedEbit - 100_000, 400_000) * tier2Rate;
  if (cappedEbit > 500_000) ebitBonus += Math.min(cappedEbit - 500_000, 1_500_000) * tier3Rate;
  if (cappedEbit > 2_000_000) ebitBonus += (cappedEbit - 2_000_000) * tier4Rate;

  // Apply EBIT weight (70% default) + productivity factor
  const ebitWeight = ((params.ebitWeight as number) ?? 70) / 100;
  const prodThresholdCritical = (params.prodThresholdCritical as number) ?? 15;
  const prodThresholdOk = (params.prodThresholdOk as number) ?? 20;
  const prodThresholdGood = (params.prodThresholdGood as number) ?? 25;

  let prodFactor = 0;
  if (productivityIndex >= prodThresholdGood) prodFactor = 2.0;
  else if (productivityIndex >= prodThresholdOk) prodFactor = 1.5;
  else if (productivityIndex >= prodThresholdCritical) prodFactor = 1.0;

  const prodWeight = 1 - ebitWeight;
  const totalBonus = ebitBonus * ebitWeight + ebitBonus * prodWeight * prodFactor;

  return {
    data: {
      ebit: Math.round(ebit * 100) / 100,
      total_bonus: Math.round(totalBonus * 100) / 100,
      productivity_index: Math.round(productivityIndex * 100) / 100,
    },
    quality,
  };
}

// ---------------------------------------------------------------------------
// Email via Resend (optional)
// ---------------------------------------------------------------------------

async function sendReportEmail(report: QuarterlyReport): Promise<{ sent: boolean; error?: string }> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const recipientEmail = Deno.env.get("REPORT_RECIPIENT_EMAIL");

  if (!resendKey || !recipientEmail) {
    return { sent: false, error: "RESEND_API_KEY or REPORT_RECIPIENT_EMAIL not configured" };
  }

  const senderEmail = Deno.env.get("REPORT_SENDER_EMAIL") ?? "reports@erichsfelde.farm";

  const body = {
    from: senderEmail,
    to: recipientEmail,
    subject: `Quartalsbericht ${report.quarter} — ${report.farm}`,
    html: `<h1>Quartalsbericht ${report.quarter}</h1>
<p>Generiert: ${report.generated_at}</p>
<pre>${JSON.stringify(report, null, 2)}</pre>
<p><em>Detaillierter PDF-Report folgt in einer zukünftigen Version.</em></p>`,
  };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${resendKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { sent: false, error: `Resend API error: ${res.status} ${errText}` };
    }

    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return json({ error: "Method not allowed. Use GET or POST." }, 405);
  }

  // Auth
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  let clientKey: string;
  if (authHeader?.startsWith("Bearer ")) {
    clientKey = authHeader.replace("Bearer ", "");
  } else if (apiKey) {
    clientKey = apiKey;
  } else {
    return json({ error: "Missing authentication. Provide Authorization: Bearer <key> or X-API-Key header." }, 401);
  }

  const supabase = createClient(supabaseUrl, clientKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const logger = createLogger(supabase, "edge:report");

  // Parse quarter param
  const url = new URL(req.url);
  const quarterParam = url.searchParams.get("quarter");
  if (!quarterParam) {
    return json({ error: "Missing 'quarter' query parameter. Format: YYYY-QN, e.g. 2026-Q1" }, 400);
  }

  let qInfo: ReturnType<typeof parseQuarter>;
  try {
    qInfo = parseQuarter(quarterParam);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }

  const { year, startDate, endDate } = qInfo;

  // Query all sections in parallel
  const [financeResult, herdResult, pastureResult, opsResult, alerts, bonusResult] = await Promise.all([
    queryFinance(supabase, startDate, endDate, year),
    queryHerd(supabase, startDate, endDate),
    queryPasture(supabase, startDate, endDate),
    queryOperations(supabase, startDate, endDate),
    queryAlerts(supabase, startDate, endDate),
    queryBonusEstimate(supabase, endDate, year),
  ]);

  // Consolidate data quality
  const dataQuality = [
    ...financeResult.quality,
    ...herdResult.quality,
    ...pastureResult.quality,
    ...opsResult.quality,
    ...bonusResult.quality,
  ];

  const report: QuarterlyReport = {
    farm: "Erichsfelde",
    quarter: `Q${qInfo.quarter} ${year}`,
    generated_at: new Date().toISOString(),

    finance: financeResult.data,
    herd: herdResult.data,
    pasture: pastureResult.data,
    operations: opsResult.data,
    alerts,
    bonus_estimate: bonusResult.data,

    data_quality: dataQuality,
  };

  const sectionsLoaded = [
    report.finance ? "finance" : null,
    report.herd ? "herd" : null,
    report.pasture ? "pasture" : null,
    report.operations ? "operations" : null,
  ].filter(Boolean);

  await logger.info(`Report generated: ${quarterParam}`, {
    quarter: quarterParam,
    sections_loaded: sectionsLoaded,
    alerts_count: report.alerts.length,
    data_quality_issues: dataQuality.filter((d) => d.status !== "ok").length,
  });

  // POST with send=true → also email
  if (req.method === "POST" && url.searchParams.get("send") === "true") {
    const emailResult = await sendReportEmail(report);
    if (emailResult.sent) {
      await logger.info(`Report email sent: ${quarterParam}`);
    } else {
      await logger.error(`Report email failed: ${quarterParam}`, { error: emailResult.error });
    }
    return json({ report, email: emailResult });
  }

  return json(report);
});
