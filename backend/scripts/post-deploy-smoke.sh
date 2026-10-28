#!/usr/bin/env bash
# Strict, read-only checks through the same SPA origin used by the browser.
# Usage: bash scripts/post-deploy-smoke.sh http://localhost:8880
set -euo pipefail

if [[ $# -ne 1 || ! "$1" =~ ^https?://[^/]+/?$ ]]; then
  echo "Usage: $0 <SPA-origin, e.g. http://localhost:8880>" >&2
  exit 1
fi

BASE="${1%/}"
check_status() {
  local path="$1" expected="$2" code
  # No --fail: expected 401 is a successful HTTP exchange, not a curl error.
  # Do not retry/fallback or concatenate multiple status codes on failure.
  if ! code="$(curl --silent --show-error --connect-timeout 5 --max-time 15 \
    --output /dev/null --write-out '%{http_code}' "$BASE$path")"; then
    echo "FAIL $path: transport error" >&2
    exit 1
  fi
  if [[ "$code" != "$expected" ]]; then
    echo "FAIL $path: expected HTTP $expected, got $code" >&2
    exit 1
  fi
  echo "PASS $path: HTTP $code"
}

echo "Post-deploy smoke: $BASE (without cookies)"
check_status / 200
check_status /health 200
check_status /api/auth/me 401
check_status /api/wishlists 401
echo "PASS: all same-origin checks"
