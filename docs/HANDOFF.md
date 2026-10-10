# HANDOFF — tomorrow's working memory (updated end of each workday)

## TOMORROW (2026-10-11): three-tier execution starts- Read docs/TOPOLOGY.md first (user-corrected architecture: user phone UI / middleman relay+queue+light / laptop full store+heavy).
- Step 1: assess the middleman phone (need from user: Android version, RAM, Termux OK?).
- Step 2: design the SQLite↔Postgres sync protocol (ownership by id, idempotency dedup, outbox/inbox, conflict rules).
- Step 3: SERVER_MODE config on laptop (standalone/main/coordinator-only/worker-only).
- Standing rules still hold: feature branches + PRs, write tests with code, verify per bundle.

## End of day 2026-10-10 — chat build parked, needs proof
- Branch feature/agent-chat (UNMERGED): single chat UI replaces the 4 form-cards; runChatLoop ReAct orchestrator (think→1 tool→observe, max 6 steps, approvals park back into chat); agent.chat handler + POST /agent/chat; memory.note task; planner knows reminder.send + memory.note; ToolRegistry.list now includes inputSchema.
- NOT YET PROVEN: first live chat turn kept dying (Ollama 500s at 5min under RAM pressure: 10/11GB used). Mitigations landed but unverified: catalog trimmed to name+one-liner (prompt was OOMing KV cache), draft maxTokens cut, MODEL_TIMEOUT 600s.
- Tomorrow first: boot all, POST /agent/chat "add 150 for dosa to cash" (create cash first), watch it complete. If 500s persist: close Chrome to free RAM, or pull qwen2.5:1.5b.
- Machine left: DB running, API/ollama stopped, dev DB has ONLY the user's "Office at 10am" done reminder. Laptop rebooted overnight once — recovery held.
- Still open from before: middleman phone details (Android/RAM/Termux) for the three-tier execution.

## Where we are (2026-10-09 morning)- `main` = v0.2 (Phase 1). `develop` = Phase 2 + Phase 3 + Phase 4 merged (PRs #9, #10, #11).
- Next release: v0.3 (Phases 2–4) — deliberate PR develop→main + tag, when ready.
- Next build: **Phase 5** — scheduler + persistent queue depth (recurring/delayed/retries/catch-up semantic, missed-run policy, power-loss simulation). Then Phase 6 memory.

## State of the machine (left clean tonight)
- API server: STOPPED (was :3000). Ollama serve: STOPPED (was :11434). Nothing listens now.
- Docker Postgres: RUNNING (container personalos-db-1). Dev DB `personalos`: 0 tasks. Test DB `personalos_test`: 0 tasks.
- Model qwen2.5:3b downloaded in ~/.ollama/models (1.9GB, no re-download needed).
- Ollama binary at ~/bin/ollama (v0.5.4, user-space, no sudo needed).

## Tomorrow's startup (in order)
```bash
docker compose up -d db            # if not running
export PATH="$HOME/bin:$PATH"
OLLAMA_HOST=127.0.0.1:11434 OLLAMA_MODELS="$HOME/.ollama/models" ollama serve  # background
export DATABASE_URL=postgresql://personalos:personalos@localhost:5433/personalos
npm run dev -w @personalos/api    # API + worker on :3000
```
- API token (dev): `dev-local-token` (`.env`, gitignored). Test DB URL: `postgresql://personalos:personalos@localhost:5433/personalos_test`.
- Health: `curl localhost:3000/health` → db online, worker enabled, models [qwen2.5:3b].

## Known truths (don't re-derive)
- CPU inference is SLOW (~100–200s per LLM call). Keep prompts tiny, maxTokens low, LLM off request paths. MODEL_TIMEOUT_MS=300000.
- 3B instruction-following is weak: planner/verifier use extract-first-{...}-JSON + 1 retry. It works (gate passed).
- Tests frozen: run typecheck+lint+one test pass per bundle, no new tests until prototype.
- No CI until prototype. No commits to main/develop directly (feature branches + PRs).
- Subagents: one returned empty on 0C — verify their files exist before trusting completion.
- `.env` is local-only; `.env.example` is the contract. System Postgres owns 5432; ours is on 5433 (PG_PORT).
- pkill patterns can match the tool's own shell — use the `[t]sx` bracket trick, and prefer `ss -ltnp` to find real PIDs.
- NEVER trust `cmd | tail` for pass/fail: pipes mask exit codes. Redirect to a file, then `echo EXIT:$?`.
- Cross-package "no exported member" right after adding an export: rerun typecheck (single-run build ordering can compile api against stale core dist).
- Killing dev servers: `tsx watch` node children ORPHAN when npm parents die, and api+worker share the same `tsx watch src/index.ts` cmdline. Never trust wrapper kills — list PIDs via `ps`, kill node PIDs explicitly, verify with `ss -ltn` + a second `ps`.

## Open threads (not blockers)
- BUG (found 2026-10-10, live with user): dashboard approve button worked server-side but the page didn't refresh — FIXED same day (resolve() now try/catches and always reloads; reminder form added in same batch).
- num_predict cap didn't visibly shorten output — verify later, not urgent.
- VERIFY_EARLY burns retry budget on immediate re-poll; Phase 5 replaces with wait-for-dependency.
- Planner only knows reminder.send; new task types get advertised in the SYSTEM prompt as they land.
- Phone = future wall display (Phase 9), not a Pi. Pi joins Phase 8. Backups: still just the pgdata volume (OPEN_QUESTIONS recommendation B not yet done).
