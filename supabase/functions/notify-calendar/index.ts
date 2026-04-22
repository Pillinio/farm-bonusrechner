// supabase/functions/notify-calendar/index.ts
// Edge Function: email notifications + Google Calendar sync for farm_calendar entries.
//
// POST /notify-calendar  { action: "created", entryId: "<uuid>" }
//   → Notifies owners via email about new calendar request
// POST /notify-calendar  { action: "approved", entryId: "<uuid>" }
//   → Emails requester, creates Google Calendar event
// POST /notify-calendar  { action: "rejected", entryId: "<uuid>" }
//   → Emails requester, deletes Google Calendar event if present
// POST /notify-calendar  { action: "reminder-check" }
//   → Sends digest of pending requests within 3 months to owners
// POST /notify-calendar  { action: "reconcile" }
//   → Creates missing Google Calendar events for approved entries

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createLogger } from "../_shared/logger.ts";
import { sendEmail } from "../_shared/resend.ts";
import {
  createCalendarEvent,
  deleteCalendarEvent,
} from "../_shared/google-calendar.ts";

// ---------------------------------------------------------------------------
// Entry type labels (German)
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
  leave: "Urlaub",
  business_trip: "Dienstreise",
  sick: "Krank",
  shareholder_visit: "Gesellschafter-Besuch",
  private_block: "Block Privat",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const logger = createLogger(sb, "edge:notify-calendar");

  let body: { action: string; entryId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { action, entryId } = body;

  try {
    // ── ACTION: created ──────────────────────────────────────
    if (action === "created" && entryId) {
      // Fetch the entry
      const { data: entry } = await sb
        .from("farm_calendar")
        .select("*")
        .eq("id", entryId)
        .single();
      if (!entry) return json({ error: "Entry not found" }, 404);

      // Fetch all owners
      const { data: owners } = await sb
        .from("profiles")
        .select("id, display_name")
        .eq("role", "owner");

      // Get owner emails from auth.users
      const ownerEmails: string[] = [];
      for (const owner of owners || []) {
        const { data: userData } = await sb.auth.admin.getUserById(owner.id);
        if (userData?.user?.email) ownerEmails.push(userData.user.email);
      }

      if (ownerEmails.length > 0) {
        const typeLabel = TYPE_LABELS[entry.entry_type] || entry.entry_type;
        await sendEmail({
          to: ownerEmails,
          subject: `[Farm Erichsfelde] Neue Anfrage: ${typeLabel} — ${entry.person_name}`,
          html: `
            <h2>Neue Kalenderanfrage</h2>
            <table style="border-collapse:collapse;">
              <tr><td style="padding:4px 12px;font-weight:bold;">Person:</td><td style="padding:4px 12px;">${entry.person_name}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Art:</td><td style="padding:4px 12px;">${typeLabel}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Zeitraum:</td><td style="padding:4px 12px;">${formatDate(entry.start_date)} — ${formatDate(entry.end_date)}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Grund:</td><td style="padding:4px 12px;">${entry.reason || "—"}</td></tr>
              <tr><td style="padding:4px 12px;font-weight:bold;">Status:</td><td style="padding:4px 12px;color:#ca8a04;font-weight:bold;">Wartet auf Genehmigung</td></tr>
            </table>
            <p style="margin-top:16px;"><a href="https://erichsfelde.farm/app/cockpit.html">Im Cockpit best&auml;tigen/ablehnen</a></p>
          `,
        });
        await logger.info("Calendar request notification sent", {
          entryId,
          to: ownerEmails,
        });
      }

      return json({ ok: true, action: "created", notified: ownerEmails.length });
    }

    // ── ACTION: approved ─────────────────────────────────────
    if (action === "approved" && entryId) {
      const { data: entry } = await sb
        .from("farm_calendar")
        .select("*")
        .eq("id", entryId)
        .single();
      if (!entry) return json({ error: "Entry not found" }, 404);

      // Email to requester
      if (entry.requested_by) {
        const { data: userData } = await sb.auth.admin.getUserById(
          entry.requested_by,
        );
        if (userData?.user?.email) {
          const typeLabel =
            TYPE_LABELS[entry.entry_type] || entry.entry_type;
          await sendEmail({
            to: userData.user.email,
            subject: `[Farm Erichsfelde] ${typeLabel} genehmigt — ${formatDate(entry.start_date)} bis ${formatDate(entry.end_date)}`,
            html: `
              <h2>${typeLabel} genehmigt</h2>
              <p><strong>${entry.person_name}</strong> — ${formatDate(entry.start_date)} bis ${formatDate(entry.end_date)}</p>
              <p style="color:#16a34a;font-weight:bold;">Status: Genehmigt</p>
              ${entry.reason ? `<p>Grund: ${entry.reason}</p>` : ""}
            `,
          });
        }
      }

      // Create Google Calendar event
      const typeLabel = TYPE_LABELS[entry.entry_type] || entry.entry_type;
      const calResult = await createCalendarEvent({
        summary: `${typeLabel}: ${entry.person_name}`,
        description: entry.reason || entry.notes || "",
        startDate: entry.start_date,
        endDate: entry.end_date,
      });

      if (calResult.eventId) {
        await sb
          .from("farm_calendar")
          .update({ google_event_id: calResult.eventId })
          .eq("id", entryId);
        await logger.info("Calendar event created", {
          entryId,
          eventId: calResult.eventId,
        });
      } else if (calResult.error) {
        await logger.warn("Calendar event creation failed", {
          entryId,
          error: calResult.error,
        });
      }

      return json({
        ok: true,
        action: "approved",
        calendarEvent: calResult.eventId || null,
      });
    }

    // ── ACTION: rejected ─────────────────────────────────────
    if (action === "rejected" && entryId) {
      const { data: entry } = await sb
        .from("farm_calendar")
        .select("*")
        .eq("id", entryId)
        .single();
      if (!entry) return json({ error: "Entry not found" }, 404);

      // Email to requester
      if (entry.requested_by) {
        const { data: userData } = await sb.auth.admin.getUserById(
          entry.requested_by,
        );
        if (userData?.user?.email) {
          const typeLabel =
            TYPE_LABELS[entry.entry_type] || entry.entry_type;
          await sendEmail({
            to: userData.user.email,
            subject: `[Farm Erichsfelde] ${typeLabel} abgelehnt — ${formatDate(entry.start_date)} bis ${formatDate(entry.end_date)}`,
            html: `
              <h2>${typeLabel} abgelehnt</h2>
              <p><strong>${entry.person_name}</strong> — ${formatDate(entry.start_date)} bis ${formatDate(entry.end_date)}</p>
              <p style="color:#dc2626;font-weight:bold;">Status: Abgelehnt</p>
              <p>Bitte kontaktieren Sie die Direktoren f&uuml;r R&uuml;ckfragen.</p>
            `,
          });
        }
      }

      // Delete Google Calendar event if exists
      if (entry.google_event_id) {
        const delResult = await deleteCalendarEvent(entry.google_event_id);
        if (delResult.deleted) {
          await sb
            .from("farm_calendar")
            .update({ google_event_id: null })
            .eq("id", entryId);
        }
        await logger.info("Calendar event deleted", {
          entryId,
          deleted: delResult.deleted,
        });
      }

      return json({ ok: true, action: "rejected" });
    }

    // ── ACTION: reminder-check ───────────────────────────────
    if (action === "reminder-check") {
      // Find pending requests where start_date is within 3 months and reminder not sent
      const threeMonthsFromNow = new Date();
      threeMonthsFromNow.setMonth(threeMonthsFromNow.getMonth() + 3);
      const cutoff = threeMonthsFromNow.toISOString().split("T")[0];

      const { data: pending } = await sb
        .from("farm_calendar")
        .select("*")
        .eq("status", "requested")
        .eq("reminder_sent", false)
        .lte("start_date", cutoff);

      if (!pending?.length) {
        return json({ ok: true, action: "reminder-check", reminders: 0 });
      }

      // Get owner emails
      const { data: owners } = await sb
        .from("profiles")
        .select("id")
        .eq("role", "owner");
      const ownerEmails: string[] = [];
      for (const owner of owners || []) {
        const { data: userData } = await sb.auth.admin.getUserById(owner.id);
        if (userData?.user?.email) ownerEmails.push(userData.user.email);
      }

      if (ownerEmails.length > 0) {
        // Build a summary of all pending requests
        const rows = pending
          .map((e) => {
            const typeLabel = TYPE_LABELS[e.entry_type] || e.entry_type;
            const daysUntil = Math.ceil(
              (new Date(e.start_date).getTime() - Date.now()) /
                (1000 * 60 * 60 * 24),
            );
            return `<tr>
            <td style="padding:4px 8px;">${e.person_name}</td>
            <td style="padding:4px 8px;">${typeLabel}</td>
            <td style="padding:4px 8px;">${formatDate(e.start_date)} — ${formatDate(e.end_date)}</td>
            <td style="padding:4px 8px;color:${daysUntil < 30 ? "#dc2626" : "#ca8a04"};font-weight:bold;">${daysUntil} Tage</td>
          </tr>`;
          })
          .join("");

        await sendEmail({
          to: ownerEmails,
          subject: `[Farm Erichsfelde] ${pending.length} offene Urlaubsanfrage(n) — Erinnerung`,
          html: `
            <h2>Offene Urlaubsanfragen</h2>
            <p>Die folgenden Anfragen wurden noch nicht best&auml;tigt und liegen innerhalb der 3-Monats-Frist:</p>
            <table style="border-collapse:collapse;border:1px solid #ddd;">
              <tr style="background:#f3f4f6;">
                <th style="padding:6px 8px;text-align:left;">Person</th>
                <th style="padding:6px 8px;text-align:left;">Art</th>
                <th style="padding:6px 8px;text-align:left;">Zeitraum</th>
                <th style="padding:6px 8px;text-align:left;">Noch</th>
              </tr>
              ${rows}
            </table>
            <p style="margin-top:16px;"><a href="https://erichsfelde.farm/app/cockpit.html">Im Cockpit best&auml;tigen/ablehnen</a></p>
          `,
        });
      }

      // Mark reminders as sent
      for (const e of pending) {
        await sb
          .from("farm_calendar")
          .update({ reminder_sent: true })
          .eq("id", e.id);
      }

      await logger.info("Calendar reminders sent", {
        count: pending.length,
        to: ownerEmails,
      });
      return json({
        ok: true,
        action: "reminder-check",
        reminders: pending.length,
      });
    }

    // ── ACTION: reconcile (safety net for missed calendar syncs) ──
    if (action === "reconcile") {
      const { data: unsynced } = await sb
        .from("farm_calendar")
        .select("*")
        .eq("status", "approved")
        .is("google_event_id", null);

      let synced = 0;
      for (const entry of unsynced || []) {
        const typeLabel = TYPE_LABELS[entry.entry_type] || entry.entry_type;
        const calResult = await createCalendarEvent({
          summary: `${typeLabel}: ${entry.person_name}`,
          description: entry.reason || entry.notes || "",
          startDate: entry.start_date,
          endDate: entry.end_date,
        });
        if (calResult.eventId) {
          await sb
            .from("farm_calendar")
            .update({ google_event_id: calResult.eventId })
            .eq("id", entry.id);
          synced++;
        }
      }

      await logger.info("Calendar reconciliation complete", {
        unsynced: unsynced?.length || 0,
        synced,
      });
      return json({ ok: true, action: "reconcile", synced });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    await logger.error("notify-calendar error", {
      action,
      entryId,
      error: (err as Error).message,
    });
    return json({ error: (err as Error).message }, 500);
  }
});
