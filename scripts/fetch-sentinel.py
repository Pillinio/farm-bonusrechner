#!/usr/bin/env python3
"""
fetch-sentinel.py — Placeholder for Sentinel-2 NDVI data ingestion.

This script will eventually:
  1. Authenticate with the Copernicus Data Space Ecosystem (CDSE) API
     https://dataspace.copernicus.eu/
  2. Query for recent Sentinel-2 L2A tiles covering Erichsfelde farm
  3. Download NDVI band data (B04 Red + B08 NIR) for the farm extent
  4. Compute mean NDVI per camp polygon
  5. Store results in a vegetation_indices table via Supabase

Farm bounding box (from KML):
  SW corner: lon=16.82, lat=-21.70
  NE corner: lon=16.95, lat=-21.55
  Center:    lon=16.9011, lat=-21.6056

Prerequisites (not yet implemented):
  - Copernicus CDSE account and OAuth2 credentials
  - Secrets: COPERNICUS_CLIENT_ID, COPERNICUS_CLIENT_SECRET
  - Python packages: requests, numpy (for NDVI calc)

Sentinel-2 revisit time over Namibia: ~5 days
Useful cloud-free scenes: depends on season (rainy season = more cloud cover)
"""

import os
import sys
import time

import requests


# ---------------------------------------------------------------------------
# Retry helper
# ---------------------------------------------------------------------------

def fetch_with_retry(url, params=None, headers=None, max_retries=3, timeout=30):
    """Fetch URL with exponential backoff retry."""
    for attempt in range(max_retries):
        try:
            resp = requests.get(url, params=params, headers=headers, timeout=timeout)
            resp.raise_for_status()
            return resp.json()
        except (requests.RequestException, ValueError) as e:
            if attempt < max_retries - 1:
                wait = 2 ** attempt * 5  # 5s, 10s, 20s
                print(f"Retry {attempt+1}/{max_retries} after {wait}s: {e}")
                time.sleep(wait)
            else:
                raise


def main():
    print("Sentinel NDVI check - implementation pending")
    print()
    print("This script will fetch Sentinel-2 NDVI data for Erichsfelde farm.")
    print("Copernicus Data Space API registration is required before activation.")
    print()
    print("Farm center: lat=-21.6056, lon=16.9011")
    print("Bounding box: SW(16.82, -21.70) NE(16.95, -21.55)")
    print()

    # Verify Supabase connection before main work
    supabase_url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    supabase_key = os.environ.get("SUPABASE_SERVICE_KEY", "")
    if supabase_url and supabase_key:
        sb_headers = {
            "apikey": supabase_key,
            "Authorization": f"Bearer {supabase_key}",
        }
        test_resp = requests.get(
            f"{supabase_url}/rest/v1/farms?select=name&limit=1",
            headers=sb_headers, timeout=10,
        )
        if test_resp.status_code != 200:
            raise RuntimeError(f"Supabase auth failed: {test_resp.status_code}")
        print(f"Supabase connected: {test_resp.json()}")
    else:
        print("WARNING: SUPABASE_URL or SUPABASE_SERVICE_KEY not set")

    # Check if Copernicus credentials are available
    client_id = os.environ.get("COPERNICUS_CLIENT_ID", "")
    client_secret = os.environ.get("COPERNICUS_CLIENT_SECRET", "")

    if client_id and client_secret:
        print("Copernicus credentials found - ready for implementation.")
        # TODO: Implement the following steps:
        # 1. OAuth2 token request to https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token
        # 2. OData catalog query for recent S2 L2A products
        # 3. Download relevant bands
        # 4. NDVI computation: (B08 - B04) / (B08 + B04)
        # 5. Zonal statistics per camp polygon
        # 6. Upsert to Supabase
    else:
        print("No Copernicus credentials configured. Skipping.")
        print("Set COPERNICUS_CLIENT_ID and COPERNICUS_CLIENT_SECRET to enable.")


if __name__ == "__main__":
    main()
