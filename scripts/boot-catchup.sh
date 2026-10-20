#!/usr/bin/env bash
# Boot catch-up: when the laptop wakes up, harvest anything the always-on
# device (or the last run) may have missed, then make sure today's harvest
# exists. Called by the systemd API unit's ExecStartPost.
set -uo pipefail
cd "$(dirname "$0")/.."

# The always-on device may have pushed while we were asleep — the intake
# endpoint dedups, so re-running is free.
if [ -x ./scripts/harvest.sh ]; then
  ./scripts/harvest.sh --skip-apply >> /tmp/personalos-harvest.log 2>&1 || true
fi
echo "boot catch-up done $(date -Is)" >> /tmp/personalos-harvest.log 2>/dev/null || true
exit 0
