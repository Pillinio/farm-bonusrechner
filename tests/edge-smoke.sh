#!/usr/bin/env bash
# Edge function smoke tests. Requires:
#   SUPABASE_URL      — project URL, e.g. https://xxx.supabase.co
#   SUPABASE_ANON_KEY — anon key
#   SUPABASE_USER_JWT — a valid user JWT (get from browser devtools or a CLI login)
#
# Optional:
#   FUNCTION_SECRET_CRON — shared secret for cron-invoked endpoints (Phase 2)
#
# Each endpoint must:
#   a) return 401 without Authorization
#   b) return 401 with a bogus token
#   c) return 2xx with the proper token
#
# Exit non-zero on any unexpected response.

set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL not set}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY not set}"
: "${SUPABASE_USER_JWT:?SUPABASE_USER_JWT not set}"

PASS=0; FAIL=0

check() {
  local name="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "PASS  $name  -> $actual"; PASS=$((PASS+1))
  else
    echo "FAIL  $name  expected=$expected got=$actual"; FAIL=$((FAIL+1))
  fi
}

call() {
  local fn="$1" token="$2" body="${3:-{}}"
  local auth=()
  [[ -n "$token" ]] && auth=(-H "Authorization: Bearer $token")
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST "$SUPABASE_URL/functions/v1/$fn" \
    -H "apikey: $SUPABASE_ANON_KEY" \
    -H "Content-Type: application/json" \
    "${auth[@]}" \
    -d "$body"
}

# ── user-auth endpoints (must 401 without JWT) ────────────────────────────
for fn in commit-import rollback-import process-upload bonus-defaults report; do
  check "$fn :: no-auth 401"    401 "$(call "$fn" '')"
  check "$fn :: bad-auth 401"   401 "$(call "$fn" 'garbage')"
done

# ── endpoints that should also 401 after Phase 2 (currently open) ─────────
# Comment these back in after C5 lands.
# for fn in notify-calendar reminder ingest alerts health-check; do
#   check "$fn :: no-auth 401"    401 "$(call "$fn" '')"
#   check "$fn :: bad-auth 401"   401 "$(call "$fn" 'garbage')"
# done

echo
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
