#!/usr/bin/env bash
# Restore a Postgres dump created by backup.sh into the personalos database.
# Usage: ./scripts/restore.sh backups/personalos-YYYYMMDD-HHMMSS.dump
# WARNING: replaces current data. The script re-creates the database from
# scratch, so a bad dump cannot leave half-old/half-new state.
set -euo pipefail
cd "$(dirname "$0")/.."

FILE="${1:?usage: ./scripts/restore.sh <dump-file>}"
[ -f "$FILE" ] || { echo "no such file: $FILE"; exit 1; }

set -a
# shellcheck disable=SC1091
. ./.env
set +a

say() { echo "==> $1"; }
say "dropping + recreating personalos database"
docker compose exec -T db psql -U personalos -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='personalos' AND pid <> pg_backend_pid();" >/dev/null
docker compose exec -T db psql -U personalos -d postgres -c "DROP DATABASE IF EXISTS personalos;" >/dev/null
docker compose exec -T db psql -U personalos -d postgres -c "CREATE DATABASE personalos OWNER personalos;" >/dev/null
say "restoring from $FILE"
docker compose exec -T db pg_restore -U personalos -d personalos < "$FILE" >/dev/null
say "restored. verify: ./scripts/health.sh"
