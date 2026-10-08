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
