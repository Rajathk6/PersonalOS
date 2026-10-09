#!/usr/bin/env bash
# Nightly-safe Postgres dump. Keeps the last 14 dumps, prints the file path.
# Usage: ./scripts/backup.sh [output-dir]  (default ./backups)
# Cron example: 0 2 * * * cd /path/to/PersonalOS && ./scripts/backup.sh >> backups/cron.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
FILE="$OUT_DIR/personalos-$STAMP.dump"

set -a
# shellcheck disable=SC1091
. ./.env
set +a

docker compose exec -T db pg_dump -U personalos -d personalos -Fc > "$FILE"
ls -t "$OUT_DIR"/personalos-*.dump | tail -n +15 | xargs -r rm --
echo "backup: $FILE ($(du -h "$FILE" | cut -f1))"
