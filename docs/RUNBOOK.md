# RUNBOOK — install, operate, update, recover (plain English)

## First install (fresh laptop)
1. Install Node 20+, Docker, git.
2. `git clone <repo> PersonalOS && cd PersonalOS`
3. `./scripts/setup.sh` — installs packages, starts Postgres, migrates, builds.
   Re-running it later is the **update path** (after `git pull`).
4. Start the API: `npm run dev -w @personalos/api` (or install the services below).
5. Check: `./scripts/health.sh` and open `http://localhost:3000/dashboard`.
6. Model (optional, ~2GB download): install Ollama to `~/bin`, then `ollama pull qwen2.5:3b`.

## Automatic startup (systemd, user services)
1. Edit `WorkingDirectory` in `deploy/systemd/*.service` if your checkout lives elsewhere.
2. `cp deploy/systemd/*.service ~/.config/systemd/user/ && systemctl --user daemon-reload`
3. `systemctl --user enable --now personalos-api personalos-worker`
4. Logs: `journalctl --user -u personalos-api -f`. Boot order handled by `After=` + `Restart=always`.

## Backups (your data is the asset)
- Manual: `./scripts/backup.sh` → `backups/personalos-<date>.dump` (keeps last 14).
- Nightly: add to cron — `0 2 * * * cd ~/Personal/Projects/personalOS && ./scripts/backup.sh >> backups/cron.log 2>&1`
- Restore (replaces data): `./scripts/restore.sh backups/<file>.dump`, then `./scripts/health.sh`.
- `backups/` is gitignored — copy dumps somewhere safe (pen drive) yourself.

## Update
`git pull && ./scripts/setup.sh`, then restart API/worker (or let systemd pick up the next restart).

## Phone from anywhere (not just home WiFi)
The dashboard works on home WiFi out of the box. From mobile data or outside,
your phone can't see your laptop — that gap is filled by a private network
link, NOT by new PersonalOS code (building our own relay would be a security
project of its own; the platform stays network-agnostic by design).
- Recommended: **Tailscale** (free for personal use, encrypted, no router changes).
  1. Laptop: `curl -fsSL https://tailscale.com/install.sh | sh` (needs your password), then `sudo tailscale up` and log in in the browser it opens.
  2. Phone: install the Tailscale app, log in with the SAME account.
  3. On the laptop run `tailscale ip -4` (looks like `100.x.y.z`), then open `http://100.x.y.z:3000/dashboard` on the phone. Same token as before.
- The Pi story is unchanged: Pi at home = always-on coordinator (API + DB),
  laptop = worker, phone = thin client — and the Pi joins the same Tailscale
  network so the phone reaches it from anywhere. An old phone is NOT a server
  (battery + process kills); it makes a fine wall display on WiFi.

## Raspberry Pi later
Same steps on the Pi (it becomes coordinator: API + DB + scheduler). The laptop then runs only `apps/worker` pointed at the Pi's Postgres (`DATABASE_URL` → Pi). No code changes — that was the whole point of Phases 0–8.

## If something breaks
- `./scripts/health.sh` tells you which layer (API vs DB).
- API won't boot: check `.env` (DATABASE_URL, API_TOKEN) and `docker compose ps`.
- Start over (data loss!): `docker compose down -v` wipes the database, then `./scripts/setup.sh`. Restore from backup after.
