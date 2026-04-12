#!/usr/bin/env python3
"""
fetch-fx.py — Fetch daily NAD/EUR and NAD/USD exchange rates and push to Supabase.

Uses the Frankfurter API (https://api.frankfurter.dev), a free, open-source
API built on European Central Bank data.

Note: ECB does not publish ZAR or NAD directly. NAD is pegged 1:1 to ZAR
(South African Rand) via the Common Monetary Area. Frankfurter provides ZAR
rates, so we use ZAR as a proxy for NAD.

Target table: market_prices
  - commodity: 'fx_nad_eur' or 'fx_nad_usd'
  - price_nad: the exchange rate (1 NAD = X foreign currency)
  - unit: 'rate'
"""

import json
import os
import sys
from datetime import date

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ.get("SUPABASE_URL", "").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_KEY", "")

if not SUPABASE_URL or not SUPABASE_KEY:
    print("ERROR: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set", file=sys.stderr)
    sys.exit(1)

# ---------------------------------------------------------------------------
# Fetch FX rates
# ---------------------------------------------------------------------------

def fetch_fx_rates() -> list[dict]:
    """Fetch latest NAD (via ZAR proxy) exchange rates from Frankfurter API."""

    # Strategy: get EUR and USD per 1 ZAR (= 1 NAD due to CMA peg)
    url = "https://api.frankfurter.dev/v1/latest"
    params = {
        "base": "ZAR",
        "symbols": "EUR,USD",
    }

    resp = requests.get(url, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json()

    rate_date = data.get("date", date.today().isoformat())
    rates = data.get("rates", {})

    rows = []

    if "EUR" in rates:
        rows.append({
            "price_date": rate_date,
            "commodity": "fx_nad_eur",
            "price_nad": rates["EUR"],
            "unit": "rate",
            "source": "frankfurter-ecb",
        })
        print(f"  NAD/EUR: {rates['EUR']}")

    if "USD" in rates:
        rows.append({
            "price_date": rate_date,
            "commodity": "fx_nad_usd",
            "price_nad": rates["USD"],
            "unit": "rate",
            "source": "frankfurter-ecb",
        })
        print(f"  NAD/USD: {rates['USD']}")

    return rows


# ---------------------------------------------------------------------------
# Push to Supabase
# ---------------------------------------------------------------------------

def upsert_to_supabase(rows: list[dict]) -> None:
    """Upsert market prices via Supabase PostgREST endpoint."""
    if not rows:
        print("No rows to upsert.")
        return

    url = f"{SUPABASE_URL}/rest/v1/market_prices"
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

    print(f"Upserted {len(rows)} market price records.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    print(f"Fetching FX rates for {date.today().isoformat()}")

    rows = fetch_fx_rates()
    upsert_to_supabase(rows)
    print("Done.")


if __name__ == "__main__":
    main()
