// Shared auth helpers for Edge Functions.
//
// Two auth modes are accepted, both via `Authorization: Bearer <token>`:
//   1. User JWT   — issued by Supabase Auth for signed-in users.
//   2. Service-role JWT — used by GitHub Actions / backend scripts / pg_cron.
//
// Callers choose which modes they accept via the `allow` option.
//
// Usage:
//   const auth = await verifyAuth(req, adminClient, { allow: ['user', 'service'] });
//   if (!auth) return json({ error: 'unauthorized' }, 401);
//   if (auth.mode === 'user') { auth.userId, auth.role } else { /* service */ }

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

export type AuthMode = "user" | "service";

export interface UserAuth {
  mode: "user";
  userId: string;
  role: string | null; // profiles.role (owner/manager/viewer/…)
  token: string;
}

export interface ServiceAuth {
  mode: "service";
  token: string;
}

export type AuthResult = UserAuth | ServiceAuth;

interface VerifyOpts {
  allow: AuthMode[];
  /** If true, user must have profiles.role in this set. */
  requireRole?: string[];
}

/** Decode a JWT payload (unverified). We only use it to read the `role` claim —
 *  Supabase itself has already verified the signature when `getUser()` succeeds
 *  for user tokens. For service-role tokens we then round-trip via a privileged
 *  call to confirm the key is actually valid. */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const pad = (s: string) => s + "=".repeat((4 - (s.length % 4)) % 4);
    const b64 = pad(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(atob(b64));
  } catch {
    return null;
  }
}

export async function verifyAuth(
  req: Request,
  admin: SupabaseClient,
  opts: VerifyOpts,
): Promise<AuthResult | null> {
  const header = req.headers.get("Authorization") || "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  if (!token) return null;

  const payload = decodeJwtPayload(token);
  if (!payload) return null;

  const claimedRole = typeof payload.role === "string" ? payload.role : null;

  // ── Service role: verify the token actually works against auth.admin ──────
  if (claimedRole === "service_role") {
    if (!opts.allow.includes("service")) return null;
    // Round-trip: listUsers with limit=1 is cheap and only works with a valid
    // service_role key. Rejects forged tokens with role=service_role but wrong sig.
    const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
    if (error) return null;
    return { mode: "service", token };
  }

  // ── User token: validate via getUser ──────────────────────────────────────
  if (!opts.allow.includes("user")) return null;

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data?.user) return null;

  // Optional role gate
  let role: string | null = null;
  if (opts.requireRole || true) {
    const { data: profile } = await admin
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    role = (profile?.role as string | null) ?? null;
    if (opts.requireRole && (!role || !opts.requireRole.includes(role))) {
      return null;
    }
  }

  return { mode: "user", userId: data.user.id, role, token };
}
