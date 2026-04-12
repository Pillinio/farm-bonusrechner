// supabase/functions/bonus-defaults/index.ts
// Edge Function: returns live farm data as defaults for the bonus calculator.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";

const ALLOWED_ORIGIN = "https://erichsfelde.farm";

/** JSON response helper */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
    },
  });
}

/** Hard-coded fallbacks when no live data is available. */
const FALLBACK = {
  herdSize: 800,
  slaughterWeight: 225,
  salesRate: 26,
  pricePerKg: 60,
  huntingRevenue: 0,
  rentRevenue: 0,
  otherRevenue: 0,
  baseCosts: 2000000,
  baseSalary: 700000,
};

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Headers": "Authorization, X-API-Key, Content-Type",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
      },
    });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  // --- Auth ---
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
    return json({ error: "Missing authentication. Provide Authorization: Bearer <token> or X-API-Key header." }, 401);
  }

  const supabase = createClient(supabaseUrl, clientKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const logger = createLogger(supabase, "edge:bonus-defaults");

  const warnings: string[] = [];
  const now = new Date();
  const currentYear = now.getFullYear();
  const twelveMonthsAgo = new Date(now);
  twelveMonthsAgo.setFullYear(twelveMonthsAgo.getFullYear() - 1);
  const twelveMonthsAgoStr = twelveMonthsAgo.toISOString().split("T")[0];
  const fiscalYearStart = `${currentYear}-01-01`;

  // --- 1. Herd size from latest herd_snapshots ---
  let herdSize = FALLBACK.herdSize;
  try {
    const { data: snapshot, error } = await supabase
      .from("herd_snapshots")
      .select("cows, bulls, heifers, calves, oxen, snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      warnings.push(`herd_snapshots query failed: ${error.message}`);
    } else if (snapshot) {
      herdSize =
        (snapshot.cows ?? 0) +
        (snapshot.bulls ?? 0) +
        (snapshot.heifers ?? 0) +
        (snapshot.calves ?? 0) +
        (snapshot.oxen ?? 0);
      if (herdSize === 0) {
        warnings.push("herd_snapshots: total count is 0, using fallback");
        herdSize = FALLBACK.herdSize;
      }
    } else {
      warnings.push("No herd_snapshots data found, using fallback");
    }
  } catch (e) {
    warnings.push(`herd_snapshots error: ${(e as Error).message}`);
  }

  // --- 2. Slaughter weight and price from slaughter_line_items (last 12 months) ---
  let slaughterWeight = FALLBACK.slaughterWeight;
  let pricePerKg = FALLBACK.pricePerKg;
  try {
    const { data: lineItems, error } = await supabase
      .from("slaughter_line_items")
      .select("cold_mass_kg, gross_price_per_kg, report_id, slaughter_reports!inner(report_date)")
      .gte("slaughter_reports.report_date", twelveMonthsAgoStr);

    if (error) {
      warnings.push(`slaughter_line_items query failed: ${error.message}`);
    } else if (lineItems && lineItems.length > 0) {
      const validWeights = lineItems.filter(
        (li: { cold_mass_kg: number | null }) => li.cold_mass_kg != null && li.cold_mass_kg > 0,
      );
      if (validWeights.length > 0) {
        const avgWeight =
          validWeights.reduce((sum: number, li: { cold_mass_kg: number }) => sum + li.cold_mass_kg, 0) /
          validWeights.length;
        slaughterWeight = Math.round(avgWeight);
      } else {
        warnings.push("No valid cold_mass_kg data, using fallback");
      }

      const validPrices = lineItems.filter(
        (li: { gross_price_per_kg: number | null }) => li.gross_price_per_kg != null && li.gross_price_per_kg > 0,
      );
      if (validPrices.length > 0) {
        const avgPrice =
          validPrices.reduce(
            (sum: number, li: { gross_price_per_kg: number }) => sum + li.gross_price_per_kg,
            0,
          ) / validPrices.length;
        pricePerKg = Math.round(avgPrice);
      } else {
        warnings.push("No valid gross_price_per_kg data, using fallback");
      }
    } else {
      warnings.push("No slaughter data in last 12 months, using fallback");
    }
  } catch (e) {
    warnings.push(`slaughter data error: ${(e as Error).message}`);
  }

  // --- 3. Sales rate: animals sold in last 12M / avg herd size ---
  let salesRate = FALLBACK.salesRate;
  try {
    // Count animals from slaughter reports in last 12 months
    const { data: reports, error } = await supabase
      .from("slaughter_reports")
      .select("total_animals")
      .gte("report_date", twelveMonthsAgoStr);

    if (error) {
      warnings.push(`sales rate query failed: ${error.message}`);
    } else if (reports && reports.length > 0) {
      const totalSold = reports.reduce(
        (sum: number, r: { total_animals: number | null }) => sum + (r.total_animals ?? 0),
        0,
      );
      if (totalSold > 0 && herdSize > 0) {
        salesRate = Math.round((totalSold / herdSize) * 100);
        // Sanity check
        if (salesRate < 5 || salesRate > 60) {
          warnings.push(`Calculated salesRate ${salesRate}% seems unusual`);
        }
      }
    }
  } catch (e) {
    warnings.push(`sales rate error: ${(e as Error).message}`);
  }

  // --- 4. Revenue from transactions (current fiscal year) ---
  let huntingRevenue = FALLBACK.huntingRevenue;
  let rentRevenue = FALLBACK.rentRevenue;
  let otherRevenue = FALLBACK.otherRevenue;
  try {
    const { data: txns, error } = await supabase
      .from("transactions")
      .select("category, amount_nad")
      .gte("transaction_date", fiscalYearStart)
      .gt("amount_nad", 0); // Only positive amounts (revenue)

    if (error) {
      warnings.push(`transactions query failed: ${error.message}`);
    } else if (txns && txns.length > 0) {
      for (const tx of txns as Array<{ category: string | null; amount_nad: number }>) {
        const cat = (tx.category ?? "").toLowerCase();
        if (cat.includes("hunting") || cat.includes("jagd")) {
          huntingRevenue += tx.amount_nad;
        } else if (cat.includes("rent") || cat.includes("miete") || cat.includes("pacht")) {
          rentRevenue += tx.amount_nad;
        } else if (
          cat.includes("other") ||
          cat.includes("sonstig") ||
          // Exclude cattle/slaughter revenue and uncategorized
          (!cat.includes("cattle") &&
            !cat.includes("slaughter") &&
            !cat.includes("vieh") &&
            !cat.includes("schlacht") &&
            cat !== "uncategorized" &&
            cat !== "")
        ) {
          otherRevenue += tx.amount_nad;
        }
      }
      huntingRevenue = Math.round(huntingRevenue);
      rentRevenue = Math.round(rentRevenue);
      otherRevenue = Math.round(otherRevenue);
    }
  } catch (e) {
    warnings.push(`transactions error: ${(e as Error).message}`);
  }

  // --- 5. Base costs from budgets (annual summary, month=0) ---
  let baseCosts = FALLBACK.baseCosts;
  try {
    const { data: budgetRows, error } = await supabase
      .from("budgets")
      .select("actual_nad, planned_nad")
      .eq("fiscal_year", currentYear)
      .eq("month", 0);

    if (error) {
      warnings.push(`budgets query failed: ${error.message}`);
    } else if (budgetRows && budgetRows.length > 0) {
      const totalActual = budgetRows.reduce(
        (sum: number, b: { actual_nad: number }) => sum + (b.actual_nad ?? 0),
        0,
      );
      if (totalActual > 0) {
        baseCosts = Math.round(totalActual);
      } else {
        // Fall back to planned if no actuals yet
        const totalPlanned = budgetRows.reduce(
          (sum: number, b: { planned_nad: number }) => sum + (b.planned_nad ?? 0),
          0,
        );
        if (totalPlanned > 0) {
          baseCosts = Math.round(totalPlanned);
          warnings.push("Using planned budget (no actuals yet)");
        } else {
          warnings.push("No budget data for current year, using fallback");
        }
      }
    } else {
      warnings.push("No budget rows for current year, using fallback");
    }
  } catch (e) {
    warnings.push(`budgets error: ${(e as Error).message}`);
  }

  // --- 6. Base salary from bonus_parameters ---
  let baseSalary = FALLBACK.baseSalary;
  try {
    const { data: bpRow, error } = await supabase
      .from("bonus_parameters")
      .select("params")
      .lte("effective_from", now.toISOString().split("T")[0])
      .order("effective_from", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      warnings.push(`bonus_parameters query failed: ${error.message}`);
    } else if (bpRow?.params) {
      const params = bpRow.params as Record<string, unknown>;
      if (typeof params.baseSalary === "number" && params.baseSalary > 0) {
        baseSalary = params.baseSalary;
      }
    }
  } catch (e) {
    warnings.push(`bonus_parameters error: ${(e as Error).message}`);
  }

  // --- Build response ---
  const hasLiveData = warnings.length < 6; // If most queries succeeded, consider it live
  const response = {
    herdSize,
    slaughterWeight,
    salesRate,
    pricePerKg,
    huntingRevenue,
    rentRevenue,
    otherRevenue,
    baseCosts,
    baseSalary,
    source: hasLiveData ? "live" : "fallback",
    dataDate: now.toISOString().split("T")[0],
    warnings,
  };

  await logger.info(`Bonus defaults served (source: ${response.source})`, {
    source: response.source,
    warnings_count: warnings.length,
    warnings: warnings.length > 0 ? warnings : undefined,
  });

  return json(response);
});
