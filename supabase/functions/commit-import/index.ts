// supabase/functions/commit-import/index.ts
// Atomares Einfügen der extrahierten Daten NACH User-Bestätigung.
// Client sendet das Preview aus process-upload zurück — wir trauen dem User
// was er bestätigt, aber laufen selbst nochmal durch Plausibilitätschecks
// und führen alles in einer DB-Transaktion aus (via Stored Procedures).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { CORS_HEADERS, handlePreflight } from "../_shared/cors.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface CommitRequest {
  storage_path: string;
  file_name: string;
  file_hash: string;
  file_size: number;
  document_type: "lpo-weekly" | "meatco-slaughter" | "other-slaughter" | "bank-statement" | "unknown";
  extracted_data: any;
}

Deno.serve(async (req: Request) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "auth required" }, 401);
  const userJwt = authHeader.replace("Bearer ", "");

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes } = await admin.auth.getUser(userJwt);
  if (!userRes?.user) return json({ error: "invalid auth" }, 401);
  const userId = userRes.user.id;

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();
  if (profile?.role !== "owner") return json({ error: "owner role required" }, 403);

  let body: CommitRequest;
  try {
    body = await req.json() as CommitRequest;
  } catch {
    return json({ error: "invalid json body" }, 400);
  }

  if (!body.storage_path || !body.file_hash || !body.document_type || !body.extracted_data) {
    return json({ error: "missing required fields" }, 400);
  }

  // Dedup-Check nochmals gegen DB (race-condition safety)
  const { data: existing } = await admin
    .from("data_imports")
    .select("id, status")
    .eq("file_hash", body.file_hash)
    .neq("status", "rolled_back")
    .limit(1);
  if (existing && existing.length > 0) {
    return json({
      error: "duplicate",
      message: "Diese Datei wurde bereits importiert",
      existing_import_id: existing[0].id,
    }, 409);
  }

  try {
    if (body.document_type === "lpo-weekly") {
      const d = body.extracted_data;
      const { data, error } = await admin.rpc("commit_market_prices_import", {
        p_file_name:     body.file_name,
        p_file_path:     body.storage_path,
        p_file_hash:     body.file_hash,
        p_file_size:     body.file_size,
        p_source_type:   "lpo",
        p_source_detail: d.week_range || null,
        p_period_start:  d.price_date,
        p_period_end:    d.price_date,
        p_prices:        d.prices,
        p_triggered_by:  "manual-upload",
        p_imported_by:   userId,
      });
      if (error) throw error;
      return json({ success: true, ...data });
    }

    if (body.document_type === "meatco-slaughter" || body.document_type === "other-slaughter") {
      const d = body.extracted_data;
      const { data, error } = await admin.rpc("commit_slaughter_report_import", {
        p_file_name:     body.file_name,
        p_file_path:     body.storage_path,
        p_file_hash:     body.file_hash,
        p_file_size:     body.file_size,
        p_source_type:   body.document_type === "meatco-slaughter" ? "meatco" : "slaughter_other",
        p_statement_number: d.statement_number || null,
        p_report_date:   d.report_date,
        p_totals:        d.totals,
        p_line_items:    d.line_items,
        p_triggered_by:  "manual-upload",
        p_imported_by:   userId,
      });
      if (error) throw error;
      return json({ success: true, ...data });
    }

    return json({ error: `document_type '${body.document_type}' wird noch nicht unterstützt` }, 400);

  } catch (e) {
    const msg = (e as Error).message || String(e);
    return json({ error: `commit failed: ${msg}` }, 500);
  }
});
