#!/usr/bin/env bash
# PersonalOS one-command setup AND update. Idempotent: safe to re-run any
# time (that's also the update path: git pull, then run this again).
# Usage: ./scripts/setup.sh [--no-model]
set -euo pipefail
cd "$(dirname "$0")/.."

say() { echo "==> $1"; }

need() {
  command -v "$1" >/dev/null 2>&1 || { echo "missing: $1 (see README prerequisites)"; exit 1; }
}

need node
need npm
need docker

if [ ! -f .env ]; then
  say "creating .env (API token generated, edit later)"
  TOKEN=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))")
  sed "s/^API_TOKEN=change-me/API_TOKEN=$TOKEN/" .env.example > .env
else
  say ".env exists, leaving it alone (delete it to regenerate)"
fi
set -a
# shellcheck disable=SC1091
. ./.env
set +a

say "installing dependencies"
npm install

say "starting postgres"
docker compose up -d db
say "waiting for postgres"
for _ in $(seq 1 30); do
  if docker compose exec db pg_isready -U personalos >/dev/null 2>&1; then break; fi
  sleep 2
done

say "running migrations"
npx prisma migrate deploy

say "building packages"
npm run build --workspaces --if-present >/dev/null

if [ "${1:-}" != "--no-model" ]; then
  if [ -x "$HOME/bin/ollama" ]; then
    say "ollama present, skipping install (run 'ollama pull qwen2.5:3b' for the model)"
  else
    say "ollama not found at ~/bin/ollama — install later per docs/HANDOFF.md, or run with MODEL features off"
  fi
fi

say "done. start the API: npm run dev -w @personalos/api"
say "health: curl localhost:3000/health"
