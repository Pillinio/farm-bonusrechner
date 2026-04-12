// supabase/functions/ingest/index.ts
// Edge Function: receives parsed data from OpenClaw and dispatches to DB tables.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import schema from "./schema.json" with { type: "json" };
import { createLogger } from "../_shared/logger.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_KINDS = ["bank-statement", "slaughter-report-meatco", "market-prices-lpo"] as const;
type Kind = (typeof VALID_KINDS)[number];

interface IngestPayload {
  kind: Kind;
  source: string;
  data: Record<string, unknown>;
}

/** Compute SHA-256 hash of a string, returned as hex. */
async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Lightweight validation – checks required top-level fields and kind value. */
function validatePayload(body: unknown): IngestPayload {
  if (typeof body !== "object" || body === null) {
    throw new Error("Payload must be a JSON object");
  }
  const obj = body as Record<string, unknown>;

  if (!obj.kind || typeof obj.kind !== "string") {
    throw new Error("Missing or invalid 'kind'");
  }
  if (!VALID_KINDS.includes(obj.kind as Kind)) {
    throw new Error(`Unknown kind '${obj.kind}'. Expected one of: ${VALID_KINDS.join(", ")}`);
  }
  if (!obj.source || typeof obj.source !== "string") {
    throw new Error("Missing or invalid 'source'");
  }
  if (!obj.data || typeof obj.data !== "object") {
    throw new Error("Missing or invalid 'data'");
  }
  return obj as unknown as IngestPayload;
}

/** JSON response helper */
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Handlers per kind
// ---------------------------------------------------------------------------

async function handleBankStatement(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
  rawEventId: string,
): Promise<number> {
  const {
    account_name,
    statement_date,
    closing_balance,
    transactions: txns,
  } = data as {
    account_name: string;
    statement_date: string;
    closing_balance: number;
    transactions: Array<{
      date: string;
      description: string;
      amount: number;
      reference?: string;
    }>;
  };

  // 1. Upsert account balance
  const { error: balErr } = await supabase
    .from("account_balances")
    .upsert(
      {
        balance_date: statement_date,
        account_name,
        balance_nad: closing_balance,
      },
      { onConflict: "farm_id,balance_date,account_name" },
    );
  if (balErr) throw new Error(`account_balances upsert failed: ${balErr.message}`);

  if (!txns || txns.length === 0) return 1; // only balance inserted

  // 2. Load category rules for auto-categorization
  const { data: rules } = await supabase
    .from("category_rules")
    .select("pattern, pattern_type, category_name, confidence");

  // 3. Auto-categorize and insert transactions
  const rows = txns.map((tx) => {
    let category = "uncategorized";
    if (rules && rules.length > 0) {
      const match = rules.find((r: { pattern: string; pattern_type: string; category_name: string }) => {
        if (r.pattern_type === "contains")
          return tx.description.toUpperCase().includes(r.pattern.toUpperCase());
        if (r.pattern_type === "exact")
          return tx.description.toUpperCase() === r.pattern.toUpperCase();
        if (r.pattern_type === "regex")
          return new RegExp(r.pattern, "i").test(tx.description);
        return false;
      });
      if (match) category = match.category_name;
    }

    return {
      transaction_date: tx.date,
      description: tx.description,
      amount_nad: tx.amount,
      category,
      reference: tx.reference ?? null,
      source: "openclaw",
      raw_event_id: rawEventId,
    };
  });

  const { error: txErr } = await supabase.from("transactions").insert(rows);
  if (txErr) throw new Error(`transactions insert failed: ${txErr.message}`);

  return 1 + rows.length; // balance + transactions
}

async function handleSlaughterReport(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<number> {
  const {
    statement_number,
    report_date,
    line_items,
    totals,
  } = data as {
    statement_number?: string;
    report_date: string;
    line_items: Array<Record<string, unknown>>;
    totals: Record<string, unknown>;
  };

  // 1. Insert report header
  const { data: report, error: rptErr } = await supabase
    .from("slaughter_reports")
    .insert({
      report_date,
      statement_number: statement_number ?? null,
      total_animals: totals.total_animals ?? null,
      total_cold_mass_kg: totals.total_cold_mass_kg ?? null,
      total_gross_nad: totals.total_gross_nad ?? null,
      total_deductions_nad: totals.total_deductions_nad ?? null,
      total_net_nad: totals.total_net_nad ?? null,
      source: "openclaw",
    })
    .select("id")
    .single();

  if (rptErr) throw new Error(`slaughter_reports insert failed: ${rptErr.message}`);

  // 2. Insert line items
  if (line_items && line_items.length > 0) {
    const rows = line_items.map((li) => ({
      report_id: report.id,
      ear_tag_id: li.ear_tag_id ?? null,
      grade: li.grade ?? null,
      gender: li.gender ?? null,
      cold_mass_kg: li.cold_mass_kg,
      announced_price_per_kg: li.announced_price_per_kg ?? null,
      bruising_deduction_nad: li.bruising_deduction_nad ?? 0,
      condemnation_deduction_nad: li.condemnation_deduction_nad ?? 0,
      hide_value_nad: li.hide_value_nad ?? 0,
      gross_price_per_kg: li.gross_price_per_kg ?? null,
      gross_proceeds_nad: li.gross_proceeds_nad ?? null,
    }));

    const { error: liErr } = await supabase.from("slaughter_line_items").insert(rows);
    if (liErr) throw new Error(`slaughter_line_items insert failed: ${liErr.message}`);

    return 1 + rows.length;
  }

  return 1;
}

async function handleMarketPrices(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<number> {
  const { price_date, prices } = data as {
    price_date: string;
    prices: Array<{ commodity: string; price_nad: number; unit: string }>;
  };

  const rows = prices.map((p) => ({
    price_date,
    commodity: p.commodity,
    price_nad: p.price_nad,
    unit: p.unit,
    source: "openclaw",
  }));

  // Upsert to handle duplicates gracefully
  const { error } = await supabase
    .from("market_prices")
    .upsert(rows, { onConflict: "price_date,commodity" });

  if (error) throw new Error(`market_prices upsert failed: ${error.message}`);
  return rows.length;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // Only accept POST
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // --- Auth: require Authorization header with service_role key or X-API-Key ---
  const authHeader = req.headers.get("Authorization");
  const apiKey = req.headers.get("X-API-Key");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Determine which key to use for the Supabase client
  let clientKey: string;

  if (authHeader?.startsWith("Bearer ")) {
    clientKey = authHeader.replace("Bearer ", "");
  } else if (apiKey) {
    clientKey = apiKey;
  } else {
    return json({ error: "Missing authentication. Provide Authorization: Bearer <key> or X-API-Key header." }, 401);
  }

  // Create Supabase client with the provided key
  const supabase = createClient(supabaseUrl, clientKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const logger = createLogger(supabase, "edge:ingest");

  // --- Parse & validate ---
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  let payload: IngestPayload;
  try {
    payload = validatePayload(body);
  } catch (err) {
    return json({ error: (err as Error).message }, 400);
  }

  // --- Idempotency: compute SHA-256 hash and check for duplicates ---
  const payloadHash = await sha256(JSON.stringify(body));

  const { data: existingEvent } = await supabase
    .from("raw_events")
    .select("id")
    .eq("payload_hash", payloadHash)
    .limit(1)
    .maybeSingle();

  if (existingEvent) {
    return json({
      status: "duplicate",
      raw_event_id: existingEvent.id,
      payload_hash: payloadHash,
    });
  }

  // --- Store raw event ---
  const { data: rawEvent, error: rawErr } = await supabase
    .from("raw_events")
    .insert({
      kind: payload.kind,
      source: payload.source,
      payload: body,
      payload_hash: payloadHash,
      status: "ok",
    })
    .select("id")
    .single();

  if (rawErr) {
    return json({ error: `Failed to store raw event: ${rawErr.message}` }, 500);
  }

  const rawEventId = rawEvent.id;

  // --- Dispatch to handler ---
  try {
    let recordsInserted = 0;

    switch (payload.kind) {
      case "bank-statement":
        recordsInserted = await handleBankStatement(supabase, payload.data, rawEventId);
        break;
      case "slaughter-report-meatco":
        recordsInserted = await handleSlaughterReport(supabase, payload.data);
        break;
      case "market-prices-lpo":
        recordsInserted = await handleMarketPrices(supabase, payload.data);
        break;
    }

    // Update raw event with record count
    await supabase
      .from("raw_events")
      .update({ records_inserted: recordsInserted })
      .eq("id", rawEventId);

    await logger.info(`Ingest complete: ${payload.kind}`, {
      kind: payload.kind,
      raw_event_id: rawEventId,
      records_inserted: recordsInserted,
    });

    return json({
      status: "ok",
      kind: payload.kind,
      raw_event_id: rawEventId,
      records_inserted: recordsInserted,
    });
  } catch (err) {
    const message = (err as Error).message;

    // Mark raw event as errored
    await supabase
      .from("raw_events")
      .update({ status: "error", error_message: message })
      .eq("id", rawEventId);

    await logger.error(`Ingest failed: ${payload.kind}`, {
      kind: payload.kind,
      raw_event_id: rawEventId,
      error: message,
    });

    return json({
      status: "error",
      kind: payload.kind,
      raw_event_id: rawEventId,
      error: message,
    }, 500);
  }
});
