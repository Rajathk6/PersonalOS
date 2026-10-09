# PROGRESS — running log (update every bundle, newest at bottom)

## 2026-10-08 — Project intake
- Read the .docx ONCE (476 styled paras + 8 tables). Frozen at `.knowledge/SPEC_FULL.txt` (662 raw paras). Condensed to `.knowledge/NORTH_STAR.md` — all future work reads the condensed file, never re-parses the docx.
- Understood: modular-monolith platform, orchestrator+capabilities, Scheduler→Task→Queue→Worker, PG-first, local-first, permission-gated tools, ₹0 / 12GB / 1Mbps / power-cut reality.
- Plan: Phase -1 (architecture freeze + ADRs + skeleton conventions), then Phase 0 bundles 0A/0B/0C with ONE verification per bundle.
- Next: spawn parallel subagents — (A) scaffolding+API+config, (B) contracts+registries, (C) ADRs. Then converge + verify bundle.

## 2026-10-08 — Pre-build prep complete (no code written yet)
- 3 parallel prep tracks finished and reviewed as one bundle:
  (A) docs/ARCHITECTURE.md (layers, 11 modules with NEVER-rules, Scheduler→Task→Queue→Worker flow, 8-step boot/recovery, Pi/laptop anti-assumptions, 14 event channels, 7 review-rejection examples) + docs/INTERFACES.md (frozen TS: Task/state-machine, WorkflowStep, Model*, Tool*, Capability, Permission, Worker, Queue, Event, Memory; STABLE vs DRAFT marked).
  (B) docs/ADRs/ADR-001..011 (modular monolith, PG16, ModelProvider, PG queue, scheduler/worker split, capability registry, permission engine, local-first, multi-node, semantic catch-up, structured finance) + riskiest-assumption per ADR.
  (C) docs/DATA_MODEL.md (tasks/task_steps/workers/scheduled_jobs/audit_log DDL + lease/recovery pattern; finance deferred) + docs/RISKS.md (12 risks) + docs/GLOSSARY.md (30 plain-English terms) + docs/OPEN_QUESTIONS.md (7 forks with recommendations).
- Decisions recorded: 8 new entries in docs/DECISIONS.md (prep-freeze, SQLite dropped, STABLE/DRAFT split, lease+idempotency design, events-vs-queue, append-only audit, domain tables deferred).
- One contradiction found + resolved: spec's SQLite-prototype note vs PG16 lock → PG only, recorded.
- File census: docs/*.md (8 files) + docs/ADRs (11) + .knowledge (2). Total ~800 lines of prep.
- Next: user answers to blocking forks (asked in plain English) → then Phase 0 Bundle 0A code.

## 2026-10-08 — Repo live: https://github.com/Rajathk6/PersonalOS
- `git init` + committed 24 files (README, .knowledge x2, PROGRESS, original .docx, docs x8, ADRs x11) as `0e46c44` on `main`, pushed with `-u origin main`. Auth via existing `gh` login (Rajathk6, https).
- Note: empty `apps/ packages/ src/` scaffold dirs are NOT tracked (git skips empty dirs) — they get real content in Phase 0 Bundle 0A.
- Next: user answers to blocking forks (asked in plain English) → then Phase 0 Bundle 0A code.

## 2026-10-08 — Forks answered, Phase 0 unblocked
- User picks: API token auth, Docker PG, reminders demo, laptop-only; old phone = future status/approval display (Phase 9), NOT a Pi replacement. All recorded in docs/DECISIONS.md (11 entries total).
- Next: Phase 0 Bundle 0A (scaffolding: workspaces, TS strict, Express boot, env config, pino, health, docker-compose PG16, Prisma init, token middleware).

## 2026-10-08 — SDLC adopted: develop + feature branches, main frozen for releases
- Created `develop` (from main); all future work rides `feature/*` → PR → `develop`; `main` takes tagged releases only. Rules + test cycles in docs/WORKFLOW.md; CI (install→typecheck→lint→test) on every PR in .github/workflows/ci.yml.
- This branch (`feature/branching-workflow`) carries WORKFLOW.md + CI + decision log updates → PR into develop.

## 2026-10-08 — Phase 0 Bundle 0A merged (PR #1 → develop)
- Scope: workspaces, TS strict, eslint flat, Express boot (zod env, pino, Bearer auth, honest /health), docker-compose PG16, Prisma schema + initial migration.
- Fixes during verification (all recorded in DECISIONS.md): prisma pinned v6 (RC8 dropped `migrate`), PG_PORT escape hatch (system PG owns 5432), .env fallback for `npm -w` cwd.
- Evidence: typecheck ✅ lint ✅ test ✅ (no tests yet, passWithNoTests); migrate applied (tasks/task_steps/workers/scheduled_jobs/audit_log); live: /health 200, no-token 401, wrong-token 401, good-token 404.
- `main` untouched since Phase -1 docs — first release tag comes after 0B+0C.
- Next: Phase 0 Bundle 0B (contracts: ModelProvider/Tool/Capability/Permission types + registries + Zod).

## 2026-10-08 — Phase 0 Bundle 0B merged (PR #3 → develop)
- Scope: new package @personalos/contracts — all INTERFACES.md types (STABLE/DRAFT marked), Zod strict schemas for boundary types, ContractError (5 codes), generic in-memory Registry (register/replace/get/list, no silent overwrite, exact-version pinning) + lifecycle edge validation, 16 vitest tests.
- Gap notes (honest, in PR): PermissionResult envelope added as DRAFT (spec had no data shape); lifecycle edges authored from NORTH_STAR chain; method-bearing interfaces (Tool/ModelProvider/Queue/Engine) are types-only by necessity; INCOMPATIBLE_VERSION/VALIDATION_FAILED reserved for 0C.
- Evidence: typecheck ✅ lint ✅ 16/16 tests ✅. Root tsconfig now includes packages/*/src.
- Next: Phase 0 Bundle 0C (task repository + PG queue + worker loop + boot recovery + restart test).

## 2026-10-08 — Phase 0 Bundle 0C merged (PR #4 → develop) — PHASE 0 COMPLETE
- Scope: new package @personalos/core — TaskRepository (idempotent create, guarded transitions, audit rows), PgQueue (SKIP LOCKED claim + capability match in SQL, complete/fail with retry budget, requeueStale), WorkerHost (register/heartbeat/poll/handler dispatch, fail-fast on unknown type), recoverOnBoot. CI upgraded with postgres service + migrate deploy.
- Subagent attempt returned empty (no files); built directly instead — recorded as a process note, not a decision.
- Evidence: typecheck ✅ lint ✅ 30/30 tests ✅ (16 contracts + 4 transitions + 3 worker + 7 real-PG integration: lease skip, capability match, crash→redelivery retryCount+1, retry exhaustion, idempotency, network parking, missing-handler fail-fast). Test DB empty after runs; dev DB untouched.
- Next: release v0.1 to main (Phase 0 milestone), then Phase 1 (intent→plan→task→worker→result + reminders demo + restart-recovery gate).

## 2026-10-08 — v0.1 released to main (Phase 0 milestone)
- Release gate on `release/v0.1`: full re-run typecheck ✅ lint ✅ 30/30 ✅ + live `docker restart db` survival: probe task stayed queued, recoverOnBoot clean (1 kept), worker claimed + completed → done, probe row removed.
- `main` now = Phase -1 docs + Phase 0 code (PRs #1–#4), tagged v0.1. Synced back into develop with this merge.

## 2026-10-08 — Phase 1A merged (PR #6 → develop)
- Scope: app factory + bootstrap (recover→serve→work), task routes (POST/GET/list/cancel with 201/400/404/409 mapping), reminder.send handler (log channel), WORKER_ENABLED/WORKER_ID env (hostname default), live-db /health.
- Evidence: typecheck ✅ lint ✅ 36/36 tests ✅ (6 new slice tests: create+read, auth/validation, reminder queued→done with output, cancel + 409 on done, state-filtered list, health). Both DBs empty after runs.
- Next: Phase 1B — real reminders demo + process-kill (kill -9) restart gate with a future-dated reminder.

## 2026-10-08 — Phase 1B merged (PR #7 → develop) — PHASE 1 COMPLETE
- CI removed entirely until first prototype (user directive; returns in one small PR post-Phase-1). WORKFLOW.md updated.
- kill -9 gate on live system (dev DB, lease 5s, poll 500ms): future reminder queued 17:48:18Z due 17:49:33Z → `kill -9` the API mid-wait (API_DOWN confirmed) → cold boot after due → recovery clean → worker delivered 17:50:34Z → state done with output. Gate rows deleted; dev DB back to 0 tasks; server stopped.
- This proves the Phase 1 exit criterion: power loss never destroys persistent work; overdue work resumes on boot.
- Next: release v0.2 to main, then Phase 2 (Ollama behind ModelProvider — zero direct imports outside provider).

## 2026-10-08 — Phase 2 merged (PR #9 → develop)
- Scope: @personalos/models — OllamaProvider (sole HTTP speaker, timeout/abort/mapped errors, maxTokens→num_predict), ModelRegistry, route() hints, qwen2.5:3b catalog entry; api config (OLLAMA_URL/DEFAULT_MODEL/MODEL_TIMEOUT_MS) + bootstrap registration + /health models list; worker tick crash barrier (onTaskError) from a real unhandled-rejection find.
- Evidence: typecheck ✅ lint ✅ 46/46 ✅; grep gate (only provider contains /api/chat); LIVE: routed qwen2.5:3b via registry, real generation returned (129s cold / 99s warm — slow CPU inference recorded, timeout default raised).
- Tests frozen per directive: existing suites stay green, no new test work until prototype.
- Next: Phase 3 — tools (fs/web/shell/git) behind the permission wall.

## 2026-10-09 — Phase 3 merged (PR #10 → develop)
- Scope: @personalos/tools — DefaultPermissionEngine + policy table (auto/ask/deny, destructive denylist), ToolRegistry, ToolExecutor (verdict gate, CONFIRMATION_REQUIRED parking, audit-everything), fs (sandbox-jailed read/write/delete), web.fetch (1MB/30s caps, private-IP blocks), shell.execute (double-enforced denylist), git status/log; api wiring (WORKSPACE_DIR, registry, audit sink, GET /tools).
- Evidence: typecheck ✅ lint ✅ 46/46 ✅ (existing suites, per frozen-tests rule) + LIVE 10/10 executor paths (write/read/escape-refusal/delete-gate/shell-gate/destructive-deny/fetch/block/git/unknown-tool, all audited).
- Next: Phase 4 — planner/executor/verifier roles (first real LLM caller through the wall).

## 2026-10-09 — Phase 4 merged (PR #11 → develop)
- Scope: @personalos/agents (planner + verifier, JSON-extract + 1 retry, tiny prompts) + api agent routes (POST /agent/run, POST /agent/verify — enqueue only) + agent.run/agent.verify worker handlers + router default-model preference + GET /tools already in.
- Evidence: typecheck ✅ lint ✅ 46/46 ✅ + LIVE GATE PASS: goal "Remind me to drink a glass of water" → agent.run done in 195s (planned 1 child via qwen2.5:3b) → child reminder delivered → agent.verify done in 180s with ok=true. Gate rows cleaned; dev DB 0 tasks; API + Ollama stopped.
- Handoff for tomorrow in docs/HANDOFF.md (startup commands, tokens, known truths, open threads).
- Next: Phase 5 — scheduler + queue depth (recurring/delayed/catch-up/missed-run + power-loss sim), then release v0.3.

## 2026-10-09 — Phase 5 merged (PR #12 → develop)
- Scope: @personalos/scheduler (ScheduleSpec once/every, pure nextDue/isDue/missedPeriods, Scheduler tick with crash barrier + self-disabling poison rows) + api /schedules CRUD + bootstrap wiring (SCHEDULER_ENABLED/POLL_MS) + health scheduler status. Tests WRITTEN, NOT RUN (prototype rule).
- Evidence: typecheck ✅ lint ✅ + LIVE: every-30s reminder fired on period; kill -9 through ~3 missed periods → cold boot fired exactly ONE catch-up (missedPeriods: 2), delivered, no replays. Demo rows cleaned; dev DB 0 tasks; server stopped.
- Next: Phase 6 — memory (working/episodic/semantic/user/procedural/task, selective indexing).

## 2026-10-08 — v0.2 released to main (Phase 1 milestone)
- Gate: typecheck ✅ lint ✅ 36/36 ✅ re-run on release branch; 1B kill -9 evidence already on develop.
- `main` = docs + Phase 0 + Phase 1A task slice (PRs #1–#4, #6–#7), tagged v0.2. (PR #5 was the v0.1 release.)
- Next: Phase 2 — Ollama provider + router (no Ollama binary on laptop yet; ~2GB model over ~1Mbps needs an overnight pull).
