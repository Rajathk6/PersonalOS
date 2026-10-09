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

## 2026-10-08 — CI removed until first prototype (user directive)
Context: CI (typecheck+lint+test on PRs + postgres service) was costing more attention than value pre-prototype; user said minimize or drop it and build.
Decision: deleted .github/workflows/ci.yml entirely. Verification stays manual per-bundle (typecheck+lint+test+runtime evidence pasted in PRs) until the first prototype (Phase 1 reminders working) is done, then CI returns in one small PR.
Why: prototype speed now, automation when the surface stabilizes.
Consequence: PRs #6+ merge on human/agent-verified evidence only; re-add CI before Phase 2.

## 2026-10-08 — Phase 2 model reality (qwen2.5:3b live on CPU)
Context: Ollama 0.5.4 installed to ~/bin (no sudo), serving on 127.0.0.1:11434 CPU-only; qwen2.5:3b pulled (~1.9GB in ~10 min at ~4MB/s — dongle faster than feared).
Decision: provider + registry + router built behind ADR-003 wall (grep gate: only provider touches /api/chat; endpoint lives in config). MODEL_TIMEOUT_MS default 300000 (first generation took 129s cold).
Why: cold load + CPU inference is slow (~99s even warm for a short reply); 3B instruction-following is weak for exact-format tasks.
Consequence: LLM stays off the critical path — rare, short, async worker tasks only; deterministic code paths preferred (already the architecture); Phase 4 prompts must be short with low maxTokens; num_predict passthrough added but cap behavior needs a later look.

## 2026-10-08 — Tests frozen at current coverage until prototype (user directive)
Context: User said stop spending time on tests; focus on development.
Decision: no new tests, no repeated runs per step. Existing suites (46 tests) stay and must keep passing on bundle verification, but verification = typecheck + lint + one test run per bundle, nothing more.
Why: prototype speed; the suites already cover contracts/queue/recovery/routes/provider.
Consequence: Phase 3+ bundles ship with code + docs + one verification pass; test expansion resumes post-prototype.

## 2026-10-09 — Phase 3 tool-wall calls (sandbox, confirmations, audit-everything)
Context: Tools needed real safety without a UI for approvals yet.
Decision: (1) Filesystem tools jailed to WORKSPACE_DIR via resolveInside prefix check, enforced in the tool AND the verdict (defense in depth); outside reads → Confirm, outside deletes → Denied. (2) Confirm verdicts never execute — executor returns CONFIRMATION_REQUIRED; durable approval queue waits for scheduler/phone phases. (3) Shell has a denylist enforced twice (policy + tool itself); everything else shell → Confirm. (4) web.fetch capped 1MB/30s with literal-IP private-range blocks (hostname DNS resolution guard deferred, documented). (5) Every executor path — including unknown-tool probes — writes an audit row.
Why: no silent permissions, no fake approvals, no unbounded downloads on 1Mbps.
Consequence: Phase 4 planner calls tools only through ToolExecutor; POST /tools execute endpoint arrives with the approval queue, not before.

## 2026-10-09 — Phase 4 role calls (tiny prompts, tasks-not-requests, verify-waits)
Context: 3B on CPU is slow and a weak narrator; requests must stay fast.
Decision: (1) Planner/verifier prompts are minimal with JSON-only instruction + extract-first-{...} + exactly 1 retry. (2) /agent/run and /agent/verify only enqueue — all LLM work happens in worker handlers. (3) agent.verify on a non-done target fails retryable (VERIFY_EARLY); proper dependency-wait arrives Phase 5. (4) Router default: configured DEFAULT_MODEL wins ties after hint filtering.
Why: 195s planner + 180s verifier calls would destroy request latency; retries are bounded so a confused model fails loudly instead of looping.
Consequence: Phase 5 scheduler owns delayed/dependent execution; planner SYSTEM prompt must be updated as new task types land.

## 2026-10-09 — Phase 5 scheduler calls (no cron, one covering run, poison disables)
Context: Recurring work + outage catch-up without replay storms or new dependencies.
Decision: (1) Schedule shapes = once{at} + every{seconds≥15, from?} only — no cron parser until a real calendar need appears. (2) Outage → ONE task with _catchup{missedPeriods}, checkpoint jumps to now. (3) Invalid schedule rows disable themselves + report via onError instead of spinning. (4) Scheduler + worker share the process behind flags until the Phase 8 split; both touch work only through the queue.
Why: smallest mechanism that honors ADR-010; cron is a dependency plus a bug farm.
Consequence: /schedules manages jobs; VERIFY_EARLY still burns retries until dependency-wait lands (carried open thread).

## 2026-10-09 — Phase 6 memory calls (one table, upserts, no vectors yet)
Context: Six memory kinds needed persistence without turning into a dump or a vector-science project.
Decision: (1) Single memories table (kind/key/content/importance/confidence/source/expires); keyed kinds upsert on (kind,key), unkeyed append. (2) Recall = keyword + importance floor + expiry filter, ranked importance/freshness; no pgvector until semantic search earns it. (3) Agent handlers write task-memory (plan record) + episodic-memory (verdicts) automatically — memory goes live through use, not a separate UI. (4) Structured money/facts stay relational (Phase 7); memory never holds the books.
Why: cheapest durable design that honors "don't vectorize everything" and "structured stays structured".
Consequence: recall SQL is the seam where vector ranking plugs in later; callers unchanged.

## 2026-10-09 — Phase 7A capability calls (manifest door, paise math, npm vs capability versions)
Context: First vertical had to prove Core stays generic while money stays exact.
Decision: (1) Every vertical enters via CapabilityRegistry.install (manifest schema + runtime compat + lifecycle walk + DB record); dynamic plugin loading waits for Phase 11. (2) Money in integer paise, sums in SQL/JS ints, formatted only for display — LLM never computes. (3) npm package version stays 0.0.0 for all workspaces; capability version lives in the manifest (finance@1.0.0) — mixing them broke npm install. (4) Task types are shells over executor tools; routes go through the executor too — no path bypasses permission+audit.
Why: the chicken-tikka test (10000−235−99=9666 exactly) must hold forever, and Core must never learn what finance is.
Consequence: 7B jobs monitor follows the same door; budgets/loans arrive as finance v1.x, never Core edits.

## 2026-10-09 — Phase 7B jobs calls (deterministic discovery, notify-after-queue)
Context: Job monitoring had to work without depending on weak 3B output.
Decision: (1) Discovery = fetch via web.fetch tool (caps/audit apply) + literal keyword match + (watch,url,title) dedup — no model in the loop. (2) Handler notifies per fresh finding via reminder task, marks notified only after enqueue (crash keeps it un-notified → next check re-notifies). (3) Eligibility/exam analysis stays future work on top of stored findings (official facts vs inference separated from day one).
Why: a missed alert is worse than a plain one; determinism first, smarts later.
Consequence: scheduler can drive jobs.check_now on interval for autonomous monitoring.

## 2026-10-09 — Phase 8 multinode calls (shared-DB topology, fail-closed tokens, sweep requeues)
Context: No second machine yet — prove distribution with processes, not promises.
Decision: (1) Topology = shared Postgres (Pi+laptop both reach it later); HTTP claim/complete/fail exists for DB-less workers, token-gated, lease-holder-checked (403/409). (2) WORKER_TOKENS empty = HTTP worker endpoints refuse everyone (fail closed). (3) Liveness sweep flips silent workers offline AND requeues their running tasks with WORKER_LOST + retry accounting (not just lease expiry — avoids poison-task spin). (4) apps/worker wires deterministic handlers only; agent/LLM handlers stay API-local until model topology is proven. (5) Heartbeats are the only liveness signal; one TCP success is not liveness.
Why: distribution without shared assumptions; a dead worker's work moves in seconds, not at lease expiry.
Consequence: Wake-on-LAN stays out (optional, hardware-dependent); HTTP worker path needs its own gate test when a DB-less worker exists.

## 2026-10-09 — Phase 9 approval calls (park-don't-die, double-tap safe, phone is a page)
Context: Confirm verdicts used to die in response bodies; the phone needed something to approve.
Decision: (1) Confirm parks to approvals table and returns 202 + approvalId; approve runs the tool and records outcome, deny runs nothing. (2) Double approval → 409 ALREADY_RESOLVED, never a second execution. (3) Phone = one static dashboard.html (status, approvals with Yes/No, tasks, money), token in localStorage; no app build, no framework. (4) POST /tools/:name/run is the user's front door to the executor (same gate as workers).
Why: approvals must survive restarts and fat fingers; a web page beats a native app for a wall display.
Consequence: push notifications wait for a provider (documented gap); dashboard polls every 30s.

## 2026-10-09 — Phase 10 ecosystem calls (discover-don't-replace, benchmark advises, cloud gated)
Context: New models must arrive without code changes or surprise switches.
Decision: (1) Boot discovers provider-served models; static catalog is fallback-only. Re-discover returns already[] — never blind-replaces. (2) Benchmark = 2 micro-tasks with trivially checkable answers; results persist as evidence; recommend() only orders the menu, DEFAULT_MODEL still picks. (3) OpenRouter registers only with a key set; empty key = no cloud provider, no spend. (4) Estimates (e.g. context length) are labeled in hwReqs, never presented as facts.
Why: the spec's discovery flow with the sharp edges removed for prototype scale.
Consequence: bigger benchmarks/cron refresh wait for real multi-model need; benchmark rows accumulate as history.
