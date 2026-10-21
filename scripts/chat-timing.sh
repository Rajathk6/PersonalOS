#!/usr/bin/env bash
# Timing harness for the chat: sends a message and reports how long the
# answer took, so "is it fast?" is measured, not guessed.
set -uo pipefail
MSG="$1"
BASE="http://127.0.0.1:3000"
TOKEN="dev-local-token"
START=$(date +%s)
ID=$(curl -s -m 10 -X POST "$BASE/agent/chat" -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "$(python3 -c 'import json,sys; print(json.dumps({"message": sys.argv[1]}))' "$MSG")" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")
for _ in $(seq 1 60); do
  sleep 2
  R=$(curl -s -m 10 "$BASE/tasks/$ID" -H "Authorization: Bearer $TOKEN")
  S=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['state'])" 2>/dev/null)
  if [ "$S" = "done" ] || [ "$S" = "failed" ]; then
    END=$(date +%s)
    echo "[$((END-START))s] $S"
    echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); o=d.get('output') or {}; print('ANSWER:', o.get('answer')); print('model:', o.get('model'), '| steps:', o.get('steps'), '| tools:', o.get('toolCalls'))" 2>/dev/null
    exit 0
  fi
done
echo "TIMEOUT after 120s"
