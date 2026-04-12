#!/usr/bin/env python3
"""
backfill-weather-history.py — Fetch 5 years of historical weather data (2020-2024)
for Erichsfelde farm and push to Supabase.

Uses the Open-Meteo Archive API with yearly chunks to respect rate limits.
Upserts into weather_observations with source='open-meteo-archive'.

Farm center coordinates (from KML "Aussengrenze Farm"):
  Latitude:  -21.6056
  Longitude:  16.9011

Target table: weather_observations

Usage:
  export SUPABASE_URL=https://vhwlcnfxslkftswksqrw.supabase.co
  export SUPABASE_SERVICE_KEY=eyJ...
  python3 scripts/backfill-weather-history.py
"""

import os
import sys
import time
from datetime import date

import requests


# ---------------------------------------------------------------------------
# Retry helper (same pattern as fetch-chirps.py)
# ---------------------------------------------------------------------------

def fetch_with_retry(url, params=None, max_retries=3, timeout=60):
    """Fetch URL with exponential backoff retry."""
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as e:
            if attempt < max_retries - 1:
                wait = 2 ** attempt * 5  # 5s, 10s, 20s
                print(f"  Retry {attempt+1}/{max_retries} after {wait}s: {e}")
                time.sleep(wait)
            else:
                raise


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

FARM_LAT = -21.6056
FARM_LON = 16.9011
STATION_NAME = "open-meteo-erichsfelde"
SOURCE = "open-meteo-archive"

ARCHIVE_API_URL = "https://archive-api.open-meteo.com/v1/archive"

# Yearly chunks for backfill
YEAR_RANGES = [
    ("2020-01-01", "2020-12-31"),
    ("2021-01-01", "2021-12-31"),
    ("2022-01-01", "2022-12-31"),
    ("2023-01-01", "2023-12-31"),
    ("2024-01-01", "2024-12-31"),
]

# Rain season definition: October through April (Southern Hemisphere)
RAIN_SEASON_MONTHS = {10, 11, 12, 1, 2, 3, 4}

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")


# ---------------------------------------------------------------------------
# Fetch weather data for a date range
# ---------------------------------------------------------------------------

def fetch_year(start_date: str, end_date: str) -> list[dict]:
    """Fetch daily weather from Open-Meteo Archive API for one year."""
    params = {
        "latitude": FARM_LAT,
        "longitude": FARM_LON,
        "start_date": start_date,
        "end_date": end_date,
        "daily": "precipitation_sum,temperature_2m_max,temperature_2m_min",
        "timezone": "Africa/Windhoek",
    }

    data = fetch_with_retry(ARCHIVE_API_URL, params=params)

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

def upsert_to_supabase(rows: list[dict]) -> int:
    """Upsert weather observations via Supabase PostgREST endpoint. Returns count."""
    if not rows:
        return 0

    url = f"{SUPABASE_URL}/rest/v1/weather_observations"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
    }

    batch_size = 100
    total_upserted = 0

    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        resp = requests.post(url, headers=headers, json=batch, timeout=30)
        if resp.status_code not in (200, 201):
            print(f"ERROR: Supabase returned {resp.status_code}: {resp.text}", file=sys.stderr)
            sys.exit(1)
        total_upserted += len(batch)

    return total_upserted


# ---------------------------------------------------------------------------
# Rain season analysis
# ---------------------------------------------------------------------------

def analyze_rain_seasons(all_rows: list[dict]) -> None:
    """Analyze rainfall by rain season (Oct-Apr) and classify."""
    # Group rainfall by rain season (Oct Y to Apr Y+1 = season Y/Y+1)
    seasons: dict[str, float] = {}

    for row in all_rows:
        d = date.fromisoformat(row["observation_date"])
        mm = row["rainfall_mm"] or 0

        if d.month not in RAIN_SEASON_MONTHS:
            continue

        # Oct-Dec belongs to season starting that year
        # Jan-Apr belongs to season that started previous year
        if d.month >= 10:
            season_start = d.year
        else:
            season_start = d.year - 1

        label = f"{season_start}/{season_start + 1}"
        seasons[label] = seasons.get(label, 0) + mm

    # Classification based on Namibian rangeland norms for central-north
    # Long-term average for Erichsfelde area is roughly 300-350mm/season
    print("\n" + "=" * 60)
    print("RAIN SEASON ANALYSIS (Oct-Apr)")
    print("=" * 60)
    print(f"{'Season':<16} {'Total mm':>10}   Classification")
    print("-" * 60)

    for label in sorted(seasons.keys()):
        total = seasons[label]
        # Classify based on Namibian central rangeland norms
        if total < 200:
            classification = "Drought"
        elif total < 280:
            classification = "Below Normal"
        elif total < 400:
            classification = "Normal"
        else:
            classification = "Above Normal"

        print(f"{label:<16} {total:>8.1f}mm   {classification}")

    print("-" * 60)
    print(
        "\nNote: Thresholds approximate for central Namibia at ~21S.\n"
        "  < 200mm = Drought | 200-280mm = Below Normal | "
        "280-400mm = Normal | > 400mm = Above Normal\n"
        "  Known events: 2018/2019 severe drought; "
        "2020/2021 improved rain season."
    )


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    if not SUPABASE_URL or not SUPABASE_KEY:
        print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set", file=sys.stderr)
        sys.exit(1)

    # --- Supabase auth test ---
    print("Testing Supabase connection...")
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    test_resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/farms?select=name&limit=1",
        headers=headers, timeout=10,
    )
    if test_resp.status_code != 200:
        print(f"ERROR: Supabase auth failed: {test_resp.status_code} {test_resp.text}", file=sys.stderr)
        sys.exit(1)
    print(f"Supabase connected: {test_resp.json()}")

    # --- Fetch all years ---
    all_rows: list[dict] = []
    total_rainfall = 0.0

    print(f"\nBackfilling historical weather data for Erichsfelde")
    print(f"  Location: lat={FARM_LAT}, lon={FARM_LON}")
    print(f"  Station:  {STATION_NAME}")
    print(f"  Source:   {SOURCE}")
    print(f"  Years:    2020-2024 ({len(YEAR_RANGES)} chunks)\n")

    for start, end in YEAR_RANGES:
        year = start[:4]
        print(f"Fetching {year}...", end=" ", flush=True)
        rows = fetch_year(start, end)
        print(f"{len(rows)} days")

        all_rows.extend(rows)
        year_rain = sum(r["rainfall_mm"] or 0 for r in rows)
        total_rainfall += year_rain
        print(f"  Annual rainfall: {year_rain:.1f}mm")

        # Rate-limit courtesy: pause 2s between yearly requests
        time.sleep(2)

    # --- Upsert to Supabase ---
    print(f"\nUpserting {len(all_rows)} records to Supabase...")
    upserted = upsert_to_supabase(all_rows)
    print(f"Upserted {upserted} weather observations.")

    # --- Summary ---
    print(f"\n{'=' * 60}")
    print(f"BACKFILL SUMMARY")
    print(f"{'=' * 60}")
    print(f"  Total days fetched:    {len(all_rows)}")
    print(f"  Total rainfall:        {total_rainfall:.1f}mm (all years)")
    print(f"  Average annual:        {total_rainfall / len(YEAR_RANGES):.1f}mm")
    print(f"  Date range:            {YEAR_RANGES[0][0]} to {YEAR_RANGES[-1][1]}")

    # --- Rain season analysis ---
    analyze_rain_seasons(all_rows)

    print("\nDone.")


if __name__ == "__main__":
    main()
