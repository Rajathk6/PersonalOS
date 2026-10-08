# DECISIONS — living knowledge base (append, never rewrite history)

Format: `## YYYY-MM-DD — Title` / Context / Decision / Why / Consequence. Plain English.

## 2026-10-08 — TypeScript monorepo, modular monolith
Context: Spec allows `personal-os/apps+packages` layout but warns against dozens of empty packages.
Decision: single npm workspaces root with `apps/api` + `packages/*` created ONLY when a module earns it. Phase 0 starts with `src/`-style minimal packages (core, contracts) and grows deliberately.
Why: quality over file count; avoids fake microservices; keeps imports acyclic.
Consequence: Phase 0 PR must not create >6 packages.

## 2026-10-08 — PostgreSQL 16 + Prisma, PG-backed queue, no Redis
Context: Spec prefers PG (relational integrity, concurrent workers, future pgvector/multi-node); Redis only when justified.
Decision: PG16 via Docker Compose; queue = SQL table + `FOR UPDATE SKIP LOCKED` polling; Redis absent.
Why: matches ₹0 + single-laptop reality; one fewer moving part; power-loss recovery = rows, not RAM.
Consequence: worker poll interval + lease column design must be documented in ADR-004.

## 2026-10-08 — Token discipline: read condensed spec, never re-parse docx
Context: User asked to analyse once and reuse.
Decision: `.knowledge/NORTH_STAR.md` is the working spec; `SPEC_FULL.txt` is frozen evidence; subagents get NORTH_STAR path in their prompt.
Why: saves tokens every turn, prevents drift.
Consequence: if spec looks wrong, fix NORTH_STAR via explicit edit + note in PROGRESS.md.

## 2026-10-08 — Pre-build prep done before any Phase 0 code (user directive)
Context: User said do everything that helps before actually building, and record all decisions.
Decision: froze architecture first — wrote ARCHITECTURE.md, INTERFACES.md, DATA_MODEL.md, RISKS.md, GLOSSARY.md, OPEN_QUESTIONS.md + ADR-001..011. No implementation code written yet.
Why: cheap to fix a doc, expensive to fix built code; keeps Core generic from day one.
Consequence: Phase 0 bundles must conform to INTERFACES.md; any interface change needs an ADR edit + note here.

## 2026-10-08 — PostgreSQL only, SQLite dropped (contradiction resolved)
Context: Spec text mentioned SQLite-as-temporary-prototype with repository isolation, but stack table + ADR-002 lock PostgreSQL 16 + Prisma.
Decision: PG16 is the only database. No SQLite code path, no swap shim. Repository pattern still required (multi-node future), but its job is clean boundaries, not SQLite compat.
Why: a temporary second database doubles testing (recovery semantics differ) for zero user benefit on a 1TB SSD laptop.
Consequence: Docker Compose ships PG16; DATA_MODEL.md DDL is PG-specific (SKIP LOCKED, JSONB, UNIQUE idempotency_key).

## 2026-10-08 — Interface stability split: STABLE vs DRAFT
Context: Freezing everything equally would fake certainty about Memory/Capability shapes we haven't built yet.
Decision: STABLE (change needs ADR): Task + state machine, Tool/ToolResult, Permission verdicts, Queue ops, Event envelope, Worker register/heartbeat, ModelProvider.generate. DRAFT (may evolve in Phase 1-6): Capability manifest details, Memory record fields, ModelMetadata extras.
Why: locks the load-bearing contracts (recovery, security, queue) while leaving learning room where the spec is intentionally vague.
Consequence: code review rejects PRs that widen STABLE interfaces without an ADR.

## 2026-10-08 — Queue = PG table with lease + idempotency_key (design locked)
Context: Needed a concrete durable handoff that survives power cuts without Redis.
Decision: tasks table owns state; dequeue = single transaction (SELECT .. FOR UPDATE SKIP LOCKED + set running/lease_owner/lease_expires_at); idempotency_key UNIQUE kills duplicate side effects; stale leases (lease_expires < now + dead heartbeat) requeue on boot.
Why: rows survive power loss, RAM doesn't; UNIQUE key is cheaper than dedup logic in every worker.
Consequence: worker poll interval + heartbeat timeout become config values, documented in ADR-004.

## 2026-10-08 — Events are signals, Queue is truth (no event-sourced tasks)
Context: Easy to confuse the event bus with the task queue.
Decision: Event Bus carries lightweight signals (IDs + refs, exact channel names in ARCHITECTURE.md); durable state lives only in PG rows. Events are never replayed as task recovery.
Why: prevents split-brain recovery (row says failed, event says running).
Consequence: capabilities subscribe to events but checkpoint from the DB.

## 2026-10-08 — Audit log append-only from day one
Context: Permission verdicts + tool runs must be explainable later ("why did it delete that file?").
Decision: audit_log table (who/what/policy/worker/tool/when/result) written on every gated action starting Phase 0, even before any UI reads it.
Why: retrofitting audit is ~10x harder; rows are cheap.
Consequence: PermissionEngine.evaluate + Tool.execute both emit audit rows; no silent side effects.

## 2026-10-08 — Finance/stocks/jobs tables deferred to Phase 7 (stubs only)
Context: Temptation to model money tables early.
Decision: Phase 0 DATA_MODEL ships tasks/task_steps/workers/scheduled_jobs/audit_log only; finance verticals get one-line stubs. First real domain tables arrive with the Capability system.
Why: building domain tables before the Capability manifest exists guarantees a Core rewrite later — the exact failure the spec warns about.
Consequence: Phase 1 demo must use a non-money flow (recommendation: reminders).

## 2026-10-08 — User forks answered (plain-English Q&A)
Context: 4 blocking forks asked before Phase 0 code; user answered all.
Decision: (1) API gets a simple token/password from env from day one. (2) PostgreSQL via Docker Compose. (3) Phase 1 demo = reminders ("remind me at 4 to leave at 6"). (4) Laptop-only for Phases 0–7; Pi joins at Phase 8.
Why: user's own picks, all matching recommendations — safest defaults, zero sensitive-data risk in demo.
Consequence: Bundle 0A includes API-token middleware + docker-compose.yml for PG16; worker/poll design assumes single machine but keeps registry-based (no hard-coded hosts) so Pi can join later.

## 2026-10-08 — Old phone is a display, not a Pi replacement
Context: user asked if a spare old phone can replace the Raspberry Pi coordinator.
Decision: No — phone stays a thin client. Its realistic future job: wall-mounted status/approval screen (task list, big Approve/Deny buttons) + notifications, arriving Phase 9. Coordinator role (PG + scheduler + queue, always-on) stays laptop-only until a Pi or equivalent cheap Linux box exists.
Why (plain English): phones are bad at being always-on servers — Android force-stops background apps to save battery, Wi-Fi sleeps, no reliable Docker/Postgres, and leaving a phone plugged in 24/7 swells the battery. A Pi runs real Linux 24/7 without fighting the OS. Nothing in Phase 0–7 needs the phone, so this costs us nothing today.
Consequence: no Termux/server-on-phone work planned; Phase 9 phone track will target this old phone as the first thin-client device.

## 2026-10-08 — SDLC: feature branches → develop → tagged main (user directive)
Context: User said stop committing to main; want dev branch + feature branches so stable releases are easy and rollback is possible.
Decision: `main` = stable releases only (merges from develop + tag v0.x, revert-on-breakage); `develop` = integration via PRs; `feature/*` = one branch per bundle, merged + deleted. CI (typecheck+lint+test) runs on every PR to develop/main. Rules written in docs/WORKFLOW.md.
Why: direct-to-main commits already happened for docs; code needs a safety net before it grows.
Consequence: Bundle 0A merged as PR #1 (develop); main still holds Phase -1 docs only until first release.

## 2026-10-08 — Prisma pinned to stable v6, no release candidates
Context: Fresh `npm install prisma` pulled 8.0.0-rc.21 whose CLI dropped `migrate dev`.
Decision: pin `prisma@6` + `@prisma/client@6` (6.19.3 verified). No alpha/beta/rc dependencies anywhere without an ADR.
Why: skeleton must build reproducibly on a laptop with 1 Mbps; chasing RC breakage is pure waste.
Consequence: package.json pins major 6; upgrades are deliberate PRs with migration re-test.

## 2026-10-08 — PG_PORT escape hatch for Docker Postgres
Context: Laptop already runs system PostgreSQL 16 on 5432 (localhost); container failed to bind.
Decision: compose maps `${PG_PORT:-5432}:5432`; `.env.example` documents PG_PORT (default 5432); local `.env` uses 5433. System Postgres left untouched.
Why: don't fight the host OS or force the user to stop system services; config, not code, absorbs the difference.
Consequence: DATABASE_URL must match PG_PORT; noted in .env.example comments.

## 2026-10-08 — .env loads from workspace cwd with repo-root fallback
Context: API booted with "DATABASE_URL Required" under `npm run -w` because dotenv looked in apps/api instead of repo root.
Decision: config.ts loads nearest `.env` first, then repo-root `.env` for missing vars (layout-relative path only, no absolutes).
Why: both `npm run dev` (root) and `npm run -w` (workspace) must work; env resolution is a startup concern, not developer memory.
Consequence: root `.env` stays gitignored; `.env.example` is the contract.

## 2026-10-08 — Bundle 0B interpretations (PermissionResult, lifecycle edges, version pinning)
Context: INTERFACES.md froze states and method names but not every transition detail; 0B had to fill small gaps without guessing policy.
Decision: (1) Added DRAFT `PermissionResult { verdict, reason? }` envelope — INTERFACES.md had the engine signature but no data shape for the verdict crossing the worker boundary. (2) Lifecycle edges authored from the NORTH_STAR chain + re-enable edges (DISABLED/UPDATED→ENABLED) so a capability resumes without reinstall. (3) Registry `get()` without version resolves only when exactly one version exists; otherwise throws — callers must pin versions until range support lands post-Phase-0.
Why: freeze the load-bearing behavior (no silent overwrite, no ambiguous resolution) while marking the new shapes DRAFT so Phase 1+ can correct them cheaply.
Consequence: 0C loader must pass exact versions; any edge change needs a DECISIONS note, not a silent edit.

## 2026-10-08 — Bundle 0C design calls (payload envelope, Queue auth, JSON casts, test DB)
Context: Prisma tables lack capability columns and Prisma's Json type fights strict TS; integration tests need a database that isn't the dev one.
Decision: (1) Routing metadata (capability, requiredCapabilities) rides inside the payload JSON envelope, unwrapped only by toContractTask — no migration needed. (2) WorkerHost passes auth "local-trusted-host" (grep-able placeholder; PgQueue ignores it until Phase 8 multi-node auth). (3) JSONB writes cast via `as Prisma.InputJsonValue` at the boundary with why-comments; values are JSON by construction. (4) Integration tests require TEST_DATABASE_URL and skip loudly without it; CI runs a postgres service + migrate deploy; local test db is personalos_test (port 5433).
Why: keep the schema stable, keep auth honest (no fake security), keep dev data unpolluted.
Consequence: Phase 1+ must preserve the envelope shape; Phase 8 replaces the auth placeholder with real worker credentials.

## 2026-10-08 — Phase 1A slice calls (app factory, async errors, worker in-process)
Context: Routes + worker had to be testable without a running server, and Express 4 silently drops async errors.
Decision: (1) `createApp(deps)` factory + `bootstrap()` own startup; index.ts is a thin prod entry; tests inject Prisma + port 0. (2) Every promise chain in routes ends in `next(err)` — never rethrow — so the error middleware (not an unhandled rejection) answers. (3) WorkerHost runs in-process behind WORKER_ENABLED (default true); the queue-polling boundary already enforces scheduler/worker separation, and the split into processes/nodes waits for Phase 5/8. (4) `reminder.send` delivers to the log with output `{deliveredAt, text, channel:"log"}` — honest channel name; real notification providers arrive Phase 3+.
Why: testability without mocks of the world; no silent 500s; no premature process split on a single laptop.
Consequence: Phase 5 must move the worker out-of-process without changing handler or queue contracts.
