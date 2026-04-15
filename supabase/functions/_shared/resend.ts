// Shared Resend email helper
// Usage: import { sendEmail } from "../_shared/resend.ts";

const RESEND_API_URL = "https://api.resend.com/emails";

export async function sendEmail(options: {
  to: string | string[];
  subject: string;
  html: string;
  from?: string;
}): Promise<{ sent: boolean; error?: string }> {
  // DRY RUN MODE: Set RESEND_DRY_RUN=true to log emails without sending
  const dryRun = Deno.env.get("RESEND_DRY_RUN") === "true";
  if (dryRun) {
    const to = Array.isArray(options.to) ? options.to.join(", ") : options.to;
    console.log(`[DRY RUN] Email NOT sent — To: ${to} | Subject: ${options.subject}`);
    return { sent: true, error: "dry_run" };
  }

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return { sent: false, error: "RESEND_API_KEY not set" };

  const from =
    options.from ||
    Deno.env.get("CALENDAR_NOTIFY_FROM") ||
    "kalender@erichsfelde.farm";

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(options.to) ? options.to : [options.to],
        subject: options.subject,
        html: options.html,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return { sent: false, error: `Resend ${res.status}: ${errText}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}
