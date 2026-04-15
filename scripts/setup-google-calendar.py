#!/usr/bin/env python3
"""
setup-google-calendar.py — One-time setup for the shared Google Calendar.

Creates a "Erichsfelde Farm" calendar (or reuses existing), shares it
read-only with the given shareholder emails, and prints the calendar ID.

Usage:
  python3 scripts/setup-google-calendar.py email1@gmail.com email2@gmail.com

The calendar ID should be stored as GOOGLE_CALENDAR_ID in Supabase secrets:
  supabase secrets set GOOGLE_CALENDAR_ID=<id>
"""

import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

# ── Config ───────────────────────────────────────────────────────
CALENDAR_NAME = "Erichsfelde Farm"
KEY_FILE = str(Path.home() / "Downloads" / "farm-controlling-1a5d580c9d89.json")
SCOPES = ["https://www.googleapis.com/auth/calendar"]


def get_service():
    creds = service_account.Credentials.from_service_account_file(
        KEY_FILE, scopes=SCOPES
    )
    return build("calendar", "v3", credentials=creds)


def find_existing_calendar(service):
    """Check if a calendar named CALENDAR_NAME already exists."""
    calendars = service.calendarList().list().execute()
    for cal in calendars.get("items", []):
        if cal.get("summary") == CALENDAR_NAME:
            return cal["id"]
    return None


def create_calendar(service):
    """Create a new calendar."""
    body = {
        "summary": CALENDAR_NAME,
        "description": "Farm Erichsfelde — Urlaub, Dienstreisen, Besuche",
        "timeZone": "Africa/Windhoek",
    }
    cal = service.calendars().insert(body=body).execute()
    return cal["id"]


def share_calendar(service, calendar_id, email):
    """Add a read-only ACL rule for the given email."""
    rule = {
        "role": "reader",
        "scope": {
            "type": "user",
            "value": email,
        },
    }
    try:
        service.acl().insert(calendarId=calendar_id, body=rule).execute()
        print(f"  Shared with {email} (reader)")
    except Exception as e:
        # Might already have access — not fatal
        print(f"  Warning sharing with {email}: {e}")


def main():
    emails = sys.argv[1:]
    if not emails:
        print("Usage: python3 scripts/setup-google-calendar.py email1@gmail.com email2@gmail.com")
        sys.exit(1)

    if not Path(KEY_FILE).exists():
        print(f"ERROR: Key file not found: {KEY_FILE}")
        sys.exit(1)

    service = get_service()

    # Check for existing calendar
    calendar_id = find_existing_calendar(service)
    if calendar_id:
        print(f"Calendar '{CALENDAR_NAME}' already exists: {calendar_id}")
    else:
        calendar_id = create_calendar(service)
        print(f"Created calendar '{CALENDAR_NAME}': {calendar_id}")

    # Share with each email
    print(f"\nSharing with {len(emails)} shareholder(s):")
    for email in emails:
        share_calendar(service, calendar_id, email)

    print(f"\nCalendar ID: {calendar_id} — store this as GOOGLE_CALENDAR_ID in Supabase secrets")
    print(f"  supabase secrets set GOOGLE_CALENDAR_ID={calendar_id}")


if __name__ == "__main__":
    main()
