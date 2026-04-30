#!/usr/bin/env bash
# Edge function smoke tests. Requires:
#   SUPABASE_URL      — project URL, e.g. https://xxx.supabase.co
#   SUPABASE_ANON_KEY — anon key
#
# Optional:
#   SUPABASE_USER_JWT — a valid user JWT (not used by current checks, reserved)
#
# Each endpoint must:
#   a) return 401 without Authorization
#   b) return 401 with a bogus token
#
# Exit non-zero on any unexpected response.

set -euo pipefail

: "${SUPABASE_URL:?SUPABASE_URL not set}"
: "${SUPABASE_ANON_KEY:?SUPABASE_ANON_KEY not set}"

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
    ${auth[@]+"${auth[@]}"} \
    -d "$body"
}

# ── user-auth endpoints (reject empty + bogus Bearer) ─────────────────────
for fn in commit-import rollback-import process-upload; do
  check "$fn :: no-auth 401"    401 "$(call "$fn" '')"
  check "$fn :: bad-auth 401"   401 "$(call "$fn" 'garbage')"
done

# ── service-role endpoints (reject empty + bogus Bearer) ──────────────────
# verifyAuth constant-time-compares the Bearer token against
# SUPABASE_SERVICE_ROLE_KEY; anything else 401s.
for fn in ingest alerts health-check reminder report notify-calendar; do
  check "$fn :: no-auth 401"    401 "$(call "$fn" '')"
  check "$fn :: bad-auth 401"   401 "$(call "$fn" 'garbage')"
done

# ── Intentionally open: bonus-defaults ────────────────────────────────────
# Called by the public bonus calculator with the anon key as Bearer. It
# always returns 200 and falls back to hardcoded defaults if queries fail.
# If/when the frontend switches to a user session token, add this to the
# service-role list above.

echo
echo "Result: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
