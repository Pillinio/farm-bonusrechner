// Telegram reminder for monthly herd count
// Trigger via pg_cron or Supabase scheduled function on the 1st of each month.
// Required env vars: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const FORM_URL = "https://erichsfelde.farm/herd-entry.html";

Deno.serve(async (_req: Request) => {
  const now = new Date();
  const day = now.getUTCDate();

  // Only send reminders on the 1st of the month
  if (day !== 1) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "not 1st of month" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const telegramToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID");

  if (!telegramToken || !chatId) {
    return new Response(
      JSON.stringify({ ok: false, error: "TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if a snapshot for the current month already exists
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const monthStart = `${year}-${month}-01`;
  const nextMonth = now.getUTCMonth() + 1 === 12
    ? `${year + 1}-01-01`
    : `${year}-${String(now.getUTCMonth() + 2).padStart(2, "0")}-01`;

  const { data, error } = await supabase
    .from("herd_snapshots")
    .select("id")
    .gte("snapshot_date", monthStart)
    .lt("snapshot_date", nextMonth)
    .limit(1);

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  if (data && data.length > 0) {
    return new Response(
      JSON.stringify({ ok: true, skipped: true, reason: "snapshot already exists" }),
      { headers: { "Content-Type": "application/json" } },
    );
  }

  // Send Telegram reminder
  const text =
    `🐄 Monatliche Herdenzählung fällig!\n\n` +
    `Bitte die Bestandszählung für ${month}/${year} erfassen:\n${FORM_URL}`;

  const telegramUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
  const telegramRes = await fetch(telegramUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });

  const telegramResult = await telegramRes.json();

  return new Response(
    JSON.stringify({ ok: telegramResult.ok, sent: true }),
    { headers: { "Content-Type": "application/json" } },
  );
});
