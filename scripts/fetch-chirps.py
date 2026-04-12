#!/usr/bin/env python3
"""
fetch-chirps.py — Fetch daily rainfall data for Erichsfelde farm and push to Supabase.

Uses the Open-Meteo Historical Weather API as a reliable, free alternative to
raw CHIRPS data. Open-Meteo provides ERA5-based reanalysis data which includes
CHIRPS-equivalent precipitation values.

Farm center coordinates (from KML "Aussengrenze Farm"):
  Latitude:  -21.6056
  Longitude:  16.9011

Target table: weather_observations
"""

import json
import os
import sys
import time
from datetime import date, timedelta

import requests


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

def fetch_with_retry(url, params=None, max_retries=3, timeout=30):
    """Fetch URL with exponential backoff retry."""
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as e:
            if attempt < max_retries - 1:
                wait = 2 ** attempt * 5  # 5s, 10s, 20s
                print(f"Retry {attempt+1}/{max_retries} after {wait}s: {e}")
                time.sleep(wait)
            else:
                raise

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FARM_LAT = -21.6056
FARM_LON = 16.9011
STATION_NAME = "open-meteo-erichsfelde"
SOURCE = "open-meteo-historical"

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Fetch rainfall from Open-Meteo
# ---------------------------------------------------------------------------

def fetch_rainfall(start_date: str, end_date: str) -> list[dict]:
    """Fetch daily precipitation from Open-Meteo historical weather API."""
    url = "https://archive-api.open-meteo.com/v1/archive"
    params = {
        "latitude": FARM_LAT,
        "longitude": FARM_LON,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "timezone": "Africa/Windhoek",
    }

    data = fetch_with_retry(url, params=params)

    if "daily" not in data or "time" not in data.get("daily", {}):
        raise ValueError(f"Unexpected API response structure: {list(data.keys())}")

    daily = data["daily"]
    dates = daily.get("time", [])
    precip = daily.get("precipitation_sum", [])
    temp_max = daily.get("temperature_2m_max", [])
    temp_min = daily.get("temperature_2m_min", [])

    rows = []
    for i, d in enumerate(dates):
        rows.append({
            "station_name": STATION_NAME,
            "observation_date": d,
            "rainfall_mm": precip[i] if precip[i] is not None else 0,
            "temperature_max_c": temp_max[i],
            "temperature_min_c": temp_min[i],
            "source": SOURCE,
        })

    return rows


# ---------------------------------------------------------------------------
# Push to Supabase
# ---------------------------------------------------------------------------

def upsert_to_supabase(rows: list[dict]) -> None:
    """Upsert weather observations via Supabase PostgREST endpoint."""
    if not rows:
        print("No rows to upsert.")
        return

    url = f"{SUPABASE_URL}/rest/v1/weather_observations"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    # PostgREST supports bulk upsert — send in batches of 100
    batch_size = 100
    total_upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        resp = requests.post(url, headers=headers, json=batch, timeout=30)
        if resp.status_code not in (200, 201):
            print(f"ERROR: Supabase returned {resp.status_code}: {resp.text}", file=sys.stderr)
            sys.exit(1)
        total_upserted += len(batch)

    print(f"Upserted {total_upserted} weather observations.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    # Verify Supabase connection before main work
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    test_resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/farms?select=name&limit=1",
        headers=headers, timeout=10,
    )
    if test_resp.status_code != 200:
        raise RuntimeError(f"Supabase auth failed: {test_resp.status_code}")
    print(f"Supabase connected: {test_resp.json()}")

    # Fetch the last 7 days (overlap ensures we catch any delayed data)
    end = date.today() - timedelta(days=1)  # yesterday (today may not be available yet)
    start = end - timedelta(days=6)

    print(f"Fetching rainfall data for {start} to {end}")
    print(f"  Location: lat={FARM_LAT}, lon={FARM_LON}")

    rows = fetch_rainfall(start.isoformat(), end.isoformat())
    print(f"  Received {len(rows)} daily records")

    upsert_to_supabase(rows)
    print("Done.")


if __name__ == "__main__":
    main()
