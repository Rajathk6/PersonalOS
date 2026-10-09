# PersonalOS

A local-first personal AI operating platform — not a chatbot, not a single super-agent.
High-level goals in, planned multi-step work out: tasks, memory, scheduling, tools,
structured personal data, and replaceable models/workers — surviving power cuts and
1 Mbps internet on ₹0 budget.

> Status: **Prototype complete (all 12+ phases on `develop`): tasks, models, tools, agents,
> scheduler, memory, capabilities (finance + jobs), multi-node, approvals, phone page,
> model ecosystem, capability builder, distribution.**
> Next: deferred test pass + v0.3 release.
> See [`docs/ROADMAP.md`](docs/ROADMAP.md) for the phase plan and
> [`PROGRESS.md`](PROGRESS.md) for the running log.

## Start here (read in this order)

1. [`.knowledge/NORTH_STAR.md`](.knowledge/NORTH_STAR.md) — condensed spec, the working
   source of truth (extracted once from the original `.docx`, frozen at
   `.knowledge/SPEC_FULL.txt`). Read this, never re-parse the docx.
2. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module boundaries, data flows,
   boot/recovery sequence, multi-node future, review-rejection examples.
3. [`docs/INTERFACES.md`](docs/INTERFACES.md) — frozen TypeScript contracts
   (STABLE vs DRAFT marked).
4. [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md) — PostgreSQL table design + lease/recovery.
5. [`docs/ADRs/`](docs/ADRs/) — ADR-001…011, one per major decision.
6. [`docs/DECISIONS.md`](docs/DECISIONS.md) — living knowledge base, every decision recorded.
7. [`docs/RISKS.md`](docs/RISKS.md) / [`docs/GLOSSARY.md`](docs/GLOSSARY.md) /
   [`docs/OPEN_QUESTIONS.md`](docs/OPEN_QUESTIONS.md) — risks, plain-English terms,
   questions needing answers before Phase 0 code.

## Core rules (from the spec)

- **Scheduler → Task → Queue → Worker → Model/Tools.** Scheduler never calls models directly.
- **Core is generic.** Domain logic lives in Capabilities. Models behind `ModelProvider`.
  External actions behind Tools + Permission Engine. Execution behind Workers.
- **Persist everything important.** No task exists only in LLM context. Power/internet
  loss is normal, not exceptional. Catch-up is semantic (one covering run), never blind replay.
- **The model is never the security authority.** Every tool call gates on
  Allowed / Confirm / Denied + append-only audit.
- **Structured data stays relational** (PostgreSQL). The LLM explains numbers, never invents them.
- **Modular monolith first.** No microservices/K8s/mandatory Redis on day one.
  PG-backed queue (`FOR UPDATE SKIP LOCKED` + leases + idempotency keys).

## Hardware reality

Intel i7 11th-gen · 12 GB RAM · Iris iGPU · 1 TB SSD · Linux · no NVIDIA ·
~1 Mbps · power cuts. Local quantized LLMs first (3B easy, 7B/8B practical).

## Roadmap

| Phase | Goal | State |
|---|---|---|
| -1–1 | Architecture, skeleton, autonomous core + kill-9 gate | ✅ released (v0.2) |
| 2–12 | Model, tools, planner, scheduler, memory, capabilities, multi-node, phone, model eco, builder, distribution | ✅ built on `develop`, v0.3 pending |

## Quickstart

```bash
./scripts/setup.sh        # install / update: deps, db, migrate, build
npm run dev -w @personalos/api   # API on :3000 (dashboard at /dashboard)
./scripts/health.sh       # one-glance health
./scripts/backup.sh        # timestamped Postgres dump (keeps 14)
```
Full runbook (services, cron backups, Pi plan): [`docs/RUNBOOK.md`](docs/RUNBOOK.md).

## Contribute / work with agents

- `PROGRESS.md` is the running log — append every bundle, newest at bottom.
- `docs/DECISIONS.md` is append-only — record every decision, never rewrite history.
- Subagents: read `.knowledge/NORTH_STAR.md` first. Verify once per bundle
  (`typecheck + lint + tests`), not after every step.
