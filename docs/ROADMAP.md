# PersonalOS Roadmap (phase-by-phase, bundled verification)

> Verification rule (per user): bundle tasks, verify once per bundle, rework or move on. No per-step testing spam.

## Phase -1 — Architecture [IN PROGRESS]
- [x] Spec extracted once → `.knowledge/SPEC_FULL.txt` + `.knowledge/NORTH_STAR.md`
- [ ] Freeze module boundaries + interfaces (Core/Task/Scheduler/Queue/Worker/Model/Tool/Capability/Permission/Memory/Event)
- [ ] ADRs 001–011 written
- [ ] Repo skeleton + TS strict + lint + config/logging conventions
- VERIFY: `npm run typecheck && npm run lint` green, interfaces import without cycles

## Phase 0 — Minimal Platform Skeleton [IN PROGRESS — 0A merged]
Bundle 0A (scaffolding) ✅ merged as PR #1: monorepo layout, Express API boot, config (env, no hard-coded URLs/models/schedules), pino logging, Bearer-token auth, honest /health, Docker Compose (PG16 + PG_PORT), Prisma schema + migration (tasks/task_steps/workers/scheduled_jobs/audit_log). Verified: typecheck+lint+test green, migrate applied, live 200/401/404.
Bundle 0A (scaffolding): monorepo layout, Express API boot, config (env, no hard-coded URLs/models/schedules), pino logging, health endpoint, Docker Compose (PG16), Prisma setup
Bundle 0B (contracts) ✅ merged as PR #3: @personalos/contracts (frozen types STABLE/DRAFT, Zod strict schemas, ContractError, generic Registry + lifecycle validation, 16 tests green).
Bundle 0C (persistence) ✅ merged as PR #4: @personalos/core (TaskRepository + PgQueue SKIP LOCKED + WorkerHost + recoverOnBoot, audit on every transition, 14 new tests incl. 7 real-PG: crash recovery proven). CI now runs postgres + migrate deploy.
- VERIFY (once, Phase 0 gate): API boots, creates task via POST, worker picks it up, survives `docker restart db` + process kill (task recoverable), typecheck+lint+vitest green → status: static + DB recovery green; POST/worker-pickup arrives Phase 1; `docker restart db` survival re-tested at release.

## Phase 1 — Minimal Autonomous Core
Intent → Planner → Task → Worker → Result → persist. One demo flow (e.g. "remind me" / echo-task with planner stub). Restart-recovery test mandatory before new features.

## Phase 2 — Local Model (Ollama behind provider ONLY; grep must show zero direct ollama imports outside provider)

## Phase 3 — Tools (fs/web/shell/git/notify, all behind permissions)

## Phase 4 — Planner/Executor/Verifier roles

## Phase 5 — Scheduler + Queue (recurring/delay/retry/catch-up semantic; simulated power-loss test)

## Phase 6 — Memory (6 types, selective indexing)

## Phase 7 — Capability system + first real verticals (finance, jobs monitor) built AS capabilities

## Phases 8–12 — Multi-node → Phone → Model ecosystem → Capability Builder → Distribution image

Each phase gets exactly one VERIFY bundle. Quality > quantity: small correct change, clean boundaries, persisted state.
