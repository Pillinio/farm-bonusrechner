#!/usr/bin/env python3
"""
fetch-weather-forecast.py — Fetch 16-day weather forecast for Erichsfelde and push to Supabase.

Uses the Open-Meteo free Forecast API (no API key required).
Stores forecasts in weather_observations with source='open-meteo-forecast'.
Each run replaces/upserts the forecast window, so stale forecasts are overwritten.

Farm center coordinates (from KML):
  Latitude:  -21.6056
  Longitude:  16.9011

Target table: weather_observations (with source='open-meteo-forecast')
"""

import json
import os
import sys
import time
from datetime import date

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
STATION_NAME = "open-meteo-forecast-erichsfelde"
SOURCE = "open-meteo-forecast"
FORECAST_DAYS = 16

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Fetch forecast from Open-Meteo
# ---------------------------------------------------------------------------

def fetch_forecast() -> list[dict]:
    """Fetch 16-day weather forecast from Open-Meteo."""
    url = "https://api.open-meteo.com/v1/forecast"
    params = {
        "latitude": FARM_LAT,
        "longitude": FARM_LON,
        "daily": "temperature_2m_max,temperature_2m_min,precipitation_sum",
        "forecast_days": FORECAST_DAYS,
        "timezone": "Africa/Windhoek",
    }

    data = fetch_with_retry(url, params=params)

    if "daily" not in data or "time" not in data.get("daily", {}):
        raise ValueError(f"Unexpected API response structure: {list(data.keys())}")

    daily = data["daily"]
    dates = daily.get("time", [])
    temp_max = daily.get("temperature_2m_max", [])
    temp_min = daily.get("temperature_2m_min", [])
    precip = daily.get("precipitation_sum", [])

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
    """Upsert weather forecast observations via Supabase PostgREST endpoint."""
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

    resp = requests.post(url, headers=headers, json=rows, timeout=30)
    if resp.status_code not in (200, 201):
        print(f"ERROR: Supabase returned {resp.status_code}: {resp.text}", file=sys.stderr)
        sys.exit(1)

    print(f"Upserted {len(rows)} forecast records.")


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

    print(f"Fetching {FORECAST_DAYS}-day weather forecast for Erichsfelde")
    print(f"  Location: lat={FARM_LAT}, lon={FARM_LON}")
    print(f"  Date: {date.today().isoformat()}")

    rows = fetch_forecast()
    print(f"  Received {len(rows)} daily forecast records")

    upsert_to_supabase(rows)
    print("Done.")


if __name__ == "__main__":
    main()
