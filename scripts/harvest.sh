#!/usr/bin/env bash
# Always-on harvesting. Runs on the laptop (daily/boot) or on the always-on
# phone (Termux). Harvests official sources and pushes them to the main
# server, which owns storage, matching, dedup and alerting.
#
# Laptop:  ./scripts/harvest.sh
# Phone:   PERSONALOS_API=http://<laptop-tailscale-ip>:3000 \
#          PERSONALOS_TOKEN=<token> ./scripts/harvest.sh
set -euo pipefail
cd "$(dirname "$0")/.."

set -a
# shellcheck disable=SC1091
[ -f .env ] && . ./.env
set +a

API="${PERSONALOS_API:-http://127.0.0.1:3000}"
TOKEN="${PERSONALOS_TOKEN:-${API_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "no token: set PERSONALOS_TOKEN (or API_TOKEN in .env)" >&2
  exit 1
fi

export PERSONALOS_API="$API"
export PERSONALOS_TOKEN="$TOKEN"
export PERSONALOS_NODE="${PERSONALOS_NODE:-$(hostname 2>/dev/null || echo node)}"

npx tsx packages/jobs/src/cli.ts "$@"
