// Google Calendar API helper for Deno Edge Functions
// Creates and deletes all-day events on a shared farm calendar.

import { getGoogleAccessToken } from "./google-auth.ts";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const SCOPES = ["https://www.googleapis.com/auth/calendar"];

async function getCalendarHeaders(): Promise<Record<string, string>> {
  const token = await getGoogleAccessToken(SCOPES);
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function createCalendarEvent(options: {
  summary: string;
  description?: string;
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD (inclusive — will add 1 day for Google)
}): Promise<{ eventId: string | null; error?: string }> {
  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
  if (!calendarId)
    return { eventId: null, error: "GOOGLE_CALENDAR_ID not set" };

  try {
    const headers = await getCalendarHeaders();

    // Google Calendar all-day events: end date is exclusive, so add 1 day
    const endDate = new Date(options.endDate);
    endDate.setDate(endDate.getDate() + 1);
    const endDateStr = endDate.toISOString().split("T")[0];

    const event = {
      summary: options.summary,
      description: options.description || "",
      start: { date: options.startDate },
      end: { date: endDateStr },
    };

    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
      {
        method: "POST",
        headers,
        body: JSON.stringify(event),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      return { eventId: null, error: `Calendar API ${res.status}: ${errText}` };
    }

    const data = await res.json();
    return { eventId: data.id };
  } catch (err) {
    return { eventId: null, error: (err as Error).message };
  }
}

export async function deleteCalendarEvent(
  eventId: string,
): Promise<{ deleted: boolean; error?: string }> {
  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");
  if (!calendarId)
    return { deleted: false, error: "GOOGLE_CALENDAR_ID not set" };

  try {
    const headers = await getCalendarHeaders();
    const res = await fetch(
      `${CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`,
      { method: "DELETE", headers },
    );

    if (!res.ok && res.status !== 404) {
      const errText = await res.text();
      return {
        deleted: false,
        error: `Calendar API ${res.status}: ${errText}`,
      };
    }
    return { deleted: true };
  } catch (err) {
    return { deleted: false, error: (err as Error).message };
  }
}
