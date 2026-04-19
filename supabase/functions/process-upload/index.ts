// supabase/functions/process-upload/index.ts
// Nimmt Storage-Path eines hochgeladenen PDFs entgegen, extrahiert strukturierte
// Daten via Claude API und liefert ein Preview zurück (KEINE DB-Schreibung).
//
// Ablauf:
//   POST { storage_path, file_name } + Bearer <user JWT>
//   → Auth-Check (User muss eingeloggt sein, Owner-Role erforderlich)
//   → PDF aus Storage laden (service-role)
//   → SHA-256 Hash berechnen
//   → Dedup-Check gegen data_imports.file_hash (ausser status='rolled_back')
//   → Claude API aufrufen mit PDF + EXTRACTION_SYSTEM_PROMPT (prompt-caching)
//   → Response-Shape validieren
//   → Sanity-Checks (Preisbereiche, Grade-Werte, Summen)
//   → { preview, file_hash, file_size, warnings } zurück

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { EXTRACTION_SYSTEM_PROMPT, PROMPT_VERSION } from "../_shared/extract-prompt.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
// Sonnet 4.6 ist für strukturierte Tabellen-Extraktion ausreichend und ~5× günstiger als Opus.
// Via Env-Var auf "claude-opus-4-7" hochstellbar falls Sonnet bei schwierigen PDFs versagt.
const ANTHROPIC_MODEL = Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-6";

interface UploadRequest {
  storage_path: string;
  file_name: string;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, "0")).join("");
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function callClaude(pdfBase64: string) {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 8000,
      system: [{
        type: "text",
        text: EXTRACTION_SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      }],
      messages: [{
        role: "user",
        content: [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
          },
          {
            type: "text",
            text: "Extrahiere strikt nach dem Schema und gib NUR JSON zurück.",
          },
        ],
      }],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text();
    throw new Error(`Claude API ${resp.status}: ${errText.slice(0, 500)}`);
  }

  const body = await resp.json();
  const text = body.content?.[0]?.text;
  if (!text) throw new Error("Claude returned empty content");

  const cleaned = text.trim().replace(/^```json\s*/i, "").replace(/\s*```$/, "");
  try {
    return {
      parsed: JSON.parse(cleaned),
      usage: body.usage ?? null,
      stop_reason: body.stop_reason,
    };
  } catch (e) {
    throw new Error(`Claude returned non-JSON: ${(e as Error).message}. First 400 chars: ${cleaned.slice(0, 400)}`);
  }
}

// ─── Validation ────────────────────────────────────────────────────────────
const GRADE_RE = /^(A|AB|B|C)[0-6]$/;
const VALID_GENDERS = new Set(["COW", "BULL", "OX", "HEIFER", "CALF"]);

function validateLpo(extracted: any, warnings: string[]): void {
  if (!extracted.price_date || !/^\d{4}-\d{2}-\d{2}$/.test(extracted.price_date)) {
    throw new Error("lpo: invalid price_date");
  }
  if (!Array.isArray(extracted.prices) || extracted.prices.length === 0) {
    throw new Error("lpo: prices array empty");
  }

  const seen = new Set<string>();
  for (const p of extracted.prices) {
    if (!p.commodity || typeof p.price_nad !== "number") {
      warnings.push(`Ungültiger Preiseintrag: ${JSON.stringify(p)}`);
      continue;
    }
    const key = `${p.price_date}|${p.commodity}`;
    if (seen.has(key)) warnings.push(`Dupe nach Extraktion: ${key}`);
    seen.add(key);

    if (p.grade && !GRADE_RE.test(p.grade)) warnings.push(`Ungültiges Grade: ${p.grade}`);
    if (p.price_nad <= 0) warnings.push(`Preis ≤ 0 bei ${p.commodity}`);
    if (p.unit === "per_kg" && (p.price_nad < 10 || p.price_nad > 200)) {
      warnings.push(`per_kg-Preis außer Plausibelbereich: ${p.commodity} = ${p.price_nad}`);
    }
    if (p.unit === "per_head" && (p.price_nad < 200 || p.price_nad > 100000)) {
      warnings.push(`per_head-Preis außer Plausibelbereich: ${p.commodity} = ${p.price_nad}`);
    }
  }
}

function validateMeatco(extracted: any, warnings: string[]): void {
  if (!extracted.report_date || !/^\d{4}-\d{2}-\d{2}$/.test(extracted.report_date)) {
    throw new Error("meatco: invalid report_date");
  }
  const totals = extracted.totals;
  if (!totals) throw new Error("meatco: totals missing");
  const items = extracted.line_items;
  if (!Array.isArray(items) || items.length === 0) throw new Error("meatco: no line items");

  let sumGross = 0;
  for (const li of items) {
    if (li.grade && !GRADE_RE.test(li.grade)) warnings.push(`Ungültiges Grade: ${li.grade}`);
    if (li.gender && !VALID_GENDERS.has(li.gender)) warnings.push(`Ungültiges Gender: ${li.gender}`);
    if (typeof li.cold_mass_kg !== "number" || li.cold_mass_kg <= 0) warnings.push(`cold_mass_kg fehlt oder ≤ 0 bei ${li.ear_tag_id ?? "?"}`);
    sumGross += Number(li.gross_proceeds_nad ?? 0);
  }

  if (typeof totals.total_gross_nad === "number" && Math.abs(sumGross - totals.total_gross_nad) > 0.1) {
    warnings.push(`Summenabweichung brutto: Zeilen=${sumGross.toFixed(2)} vs. Statement=${totals.total_gross_nad.toFixed(2)}`);
  }
  const netExpected = Number(totals.total_gross_nad ?? 0) - Number(totals.total_deductions_nad ?? 0);
  if (typeof totals.total_net_nad === "number" && Math.abs(netExpected - totals.total_net_nad) > 0.1) {
    warnings.push(`Netto-Berechnung stimmt nicht: ${netExpected.toFixed(2)} vs. ${totals.total_net_nad}`);
  }
}

// ─── Main handler ──────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization") || "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "auth required" }, 401);
  const userJwt = authHeader.replace("Bearer ", "");

  // Client mit User-JWT: prüft auth und Rolle
  const userClient = createClient(SUPABASE_URL, userJwt, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userRes } = await userClient.auth.getUser();
  if (!userRes?.user) return json({ error: "invalid auth" }, 401);

  const { data: profile } = await userClient
    .from("profiles")
    .select("role")
    .eq("id", userRes.user.id)
    .single();
  if (profile?.role !== "owner") return json({ error: "owner role required" }, 403);

  // Body parsen
  let body: UploadRequest;
  try {
    body = await req.json() as UploadRequest;
  } catch {
    return json({ error: "invalid json body" }, 400);
  }
  if (!body.storage_path || !body.file_name) {
    return json({ error: "storage_path + file_name required" }, 400);
  }

  // Service-Role Client: kann aus Storage laden und data_imports lesen
  const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // PDF laden
  const { data: blob, error: dlErr } = await adminClient.storage
    .from("incoming-pdfs")
    .download(body.storage_path);
  if (dlErr || !blob) return json({ error: `download failed: ${dlErr?.message}` }, 404);

  const buf = await blob.arrayBuffer();
  const fileSize = buf.byteLength;
  const fileHash = await sha256Hex(buf);

  // Dedup gegen data_imports (nur nicht-rolled_back)
  const { data: existing } = await adminClient
    .from("data_imports")
    .select("id, status, file_name, imported_at, records_count")
    .eq("file_hash", fileHash)
    .neq("status", "rolled_back")
    .limit(1);
  if (existing && existing.length > 0) {
    return json({
      duplicate: true,
      existing_import: existing[0],
      file_hash: fileHash,
      file_size: fileSize,
    });
  }

  // Claude aufrufen
  let claude;
  try {
    claude = await callClaude(toBase64(buf));
  } catch (e) {
    return json({ error: `extraction failed: ${(e as Error).message}` }, 502);
  }

  const extracted = claude.parsed;
  const warnings: string[] = Array.isArray(extracted.warnings) ? [...extracted.warnings] : [];

  // Validation per Typ
  try {
    if (extracted.document_type === "lpo-weekly") {
      validateLpo(extracted.extracted_data, warnings);
    } else if (extracted.document_type === "meatco-slaughter") {
      validateMeatco(extracted.extracted_data, warnings);
    } else if (extracted.document_type === "unknown") {
      warnings.push("Dokumenttyp nicht erkannt");
    } else {
      warnings.push(`Dokumenttyp '${extracted.document_type}' wird aktuell nicht importiert`);
    }
  } catch (e) {
    return json({
      error: `validation failed: ${(e as Error).message}`,
      preview: extracted,
      warnings,
    }, 422);
  }

  return json({
    preview: {
      document_type: extracted.document_type,
      confidence: extracted.confidence,
      summary_for_user: extracted.summary_for_user,
      extracted_data: extracted.extracted_data,
    },
    warnings,
    file_hash: fileHash,
    file_size: fileSize,
    prompt_version: PROMPT_VERSION,
    usage: claude.usage,
  });
});
