// supabase/functions/rollback-import/index.ts
// Löscht alle verknüpften Zeilen eines data_imports-Eintrags via Stored Procedure
// und markiert den Eintrag als 'rolled_back'. PDF im Storage bleibt.

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

  const { data: profile } = await admin
    .from("profiles")
    .select("role")
    .eq("id", userRes.user.id)
    .single();
  if (profile?.role !== "owner") return json({ error: "owner role required" }, 403);

  let body: { import_id?: string };
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }

  if (!body.import_id) return json({ error: "import_id required" }, 400);

  const { data, error } = await admin.rpc("rollback_import", { p_import_id: body.import_id });
  if (error) return json({ error: `rollback failed: ${error.message}` }, 500);
  if (data?.error) return json({ error: data.error }, 404);

  return json({ success: true, ...data });
});
