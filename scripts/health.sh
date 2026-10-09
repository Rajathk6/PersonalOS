#!/usr/bin/env bash
# One-glance health for humans, dashboards, and systemd.
# Exits 0 when the API + database answer, 1 otherwise.
set -uo pipefail
cd "$(dirname "$0")/.."

fail() { echo "UNHEALTHY: $1"; exit 1; }

API="${PERSONALOS_API:-http://127.0.0.1:3000}"
HEALTH=$(curl -s -m 10 "$API/health" 2>/dev/null) || fail "api not answering at $API"
echo "$HEALTH" | grep -q '"status":"ok"' || fail "api degraded: $HEALTH"

docker compose exec db pg_isready -U personalos >/dev/null 2>&1 || fail "postgres not ready"
echo "HEALTHY: $HEALTH"
