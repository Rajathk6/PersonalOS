# PersonalOS Architecture — Module Boundaries + Data Flows

Source: `.knowledge/NORTH_STAR.md`. Phase -1 freeze. If this doc and NORTH_STAR disagree, NORTH_STAR wins until fixed by ADR.

## 1. Layers

```
Hardware (i7/12GB/Iris/1TB SSD, no NVIDIA, ~1Mbps, power cuts)
  → Linux (host OS, Docker where useful)
    → Runtime (Node 24 + Express API + config + pino logging + Prisma + Zod + Vitest)
      → Core (generic, stable: scheduler/queue/worker/task/model-router/tool+permission/memory/event/capability-registry)
        → Capabilities (domain logic: finance, jobs-monitor, stocks, future verticals)
          → UIs (phone thin client / browser Next.js Phase 9 / CLI / voice)
```

Rules: dependencies point inward only. Capabilities call Core. Core never imports Capabilities. UIs call API only, never Core internals or DB directly.

## 2. Core modules — responsibility + NEVER

- **API / Runtime**: exposes HTTP, validates input (Zod), enqueues intents as Tasks, serves status/approvals. NEVER touches Ollama, runs tools, or writes DB except via repositories.
- **Scheduler**: owns time/event/condition triggers, deps, priority, deadlines, pause/cancel, missed-run + semantic catch-up policy. Emits tasks to Queue. NEVER calls models directly. NEVER executes tools. NEVER replays missed runs blindly.
- **Queue (PG table, `FOR UPDATE SKIP LOCKED`)**: durable FIFO+priority handoff, leases, retries, `waiting_for_network` parking. NEVER interprets task semantics or calls models/tools.
- **Worker Host + Worker Registry**: polls queue, holds lease, runs Task via Model/Tools, heartbeats, advertises capabilities (`local_llm`, `light-compute`, etc.). NEVER schedules, NEVER decides permissions, NEVER invents structured numbers.
- **Task Store (repository)**: sole DB access for tasks/workflows; owns state machine transitions. NEVER calls models, tools, or the network.
- **Model Router + ModelProvider**: `generate(request): response` behind one interface (Ollama, llama.cpp, OpenRouter). Router picks by quality/cost/latency/context/privacy/hw/tool-support. NEVER enforces security, NEVER executes side effects.
- **Tool Registry + Executor**: `Tool { name, description, inputSchema, execute() → ToolResult }`; runs web/fs/shell/git/calendar/email/db/notify. NEVER runs without a PermissionEngine verdict. NEVER returns unstructured failure.
- **PermissionEngine**: `evaluate() → Allowed | Confirm | Denied`; risk-classes every tool call (Low/Med/High/Critical). NEVER delegated to the model. Model output is input, not authority.
- **Memory Store**: 6 record types (working/episodic/semantic/user/procedural/task) with relevance gate + freshness/confidence. NEVER stores secrets as plain semantic blobs; structured facts stay relational.
- **Event Bus**: typed pub/sub envelope; cross-module decoupling. NEVER used as a durable queue (Queue owns durability). NEVER carries large payloads (IDs + refs only).
- **Capability Registry/Loader**: manifest validation + lifecycle (`DISCOVERED→VALIDATING→INSTALLED→ENABLED→DISABLED→UPDATED/REMOVED`). NEVER lets capabilities bypass Tools/Permissions or import each other directly.

## 3. Scheduler → Task → Queue → Worker flow

```
Trigger (time/event/condition/dep/API) → Scheduler creates Task (state=created, persisted)
  → Scheduler enqueues (state=queued) → Queue row (priority, not-before, lease=null)
    → Worker poll (SKIP LOCKED) → lease acquired (state=running, worker_id, lease_expires, heartbeat)
      → Worker: PermissionEngine.evaluate(tool) → Allowed: run; Confirm: park for user; Denied: fail fast
      → Worker: ModelProvider.generate and/or Tool.execute → ToolResult persisted per step
        → done (result persisted) | failed (retryable? requeue with retry_count+1 : terminal) | waiting_for_network (parked, resume on network.available)
```

Invariants: task never exists only in LLM context; every state change is a persisted row transition; Scheduler never calls the Worker or model inline; Worker never reschedules (returns outcome, Scheduler/Queue decide retry).

## 4. Boot / recovery sequence

```
1. Config load + validate (env; no hard-coded URLs/models/schedules)
2. DB open (Prisma migrate check) → repositories ready
3. Task Store recovery: running + lease-expired → requeue (retry_count+1 if retries left, else failed); queued → keep; waiting_for_network → keep parked
4. Queue recovery: clear stale leases (lease_expires < now AND worker dead per heartbeat timeout)
5. Workers register + advertise capabilities + start heartbeat
6. Scheduler loads triggers → applies catch-up policy per task (last-successful-checkpoint + dedup; semantic, not replay)
7. Event Bus replay of retained signals: power.recovered, network.available → resume eligible parked tasks
8. API listens; health endpoint reports db/queue/scheduler/workers
```

Power/internet loss is normal. No step assumes prior in-memory state survived.

## 5. Multi-node future (Pi coordinator + laptop worker)

Target: Pi = always-on coordinator (API/DB/scheduler/queue/memory/registries/notifications). Laptop = on-demand heavy worker (Ollama `local_llm`/coding/doc-analysis). Phone = thin client (requests/status/approvals/notifications). Wake-on-LAN optional, never foundational.

Anti-assumptions (enforced now, not later):
- No hard-coded machine identity, hostname, IP, or "localhost Ollama" anywhere in app code. All endpoints/models/paths come from config + registry.
- No `laptop-as-source-of-truth`: DB + queue live on coordinator; laptop holds no authoritative state.
- No capability-to-node binding: tasks declare required capabilities; Worker Registry matches at dequeue time.
- No local-filesystem-as-queue: all coordination rows in PG, reachable from any node.
- Heartbeat + lease timeouts are the only liveness signal; TCP success once is not liveness.

## 6. Event system channels

Envelope in `INTERFACES.md`. Channel list (exact names, capabilities subscribe without cross-domain hard-coding):
- `task.created`, `task.completed`, `task.failed`
- `worker.online`, `worker.offline`
- `power.recovered`, `network.available`
- `model.discovered`, `model.updated`
- `capability.installed`
- `expense.recorded`, `stock.changed`, `job.notification.discovered`
- `user.confirmation.required`, `user.confirmation.resolved`

Publishers never address a subscriber directly. New domains add channels via Capability manifest, never by editing Core.

## 7. Boundary violation examples (reject in review)

1. Scheduler imports Ollama SDK or calls `fetch('http://localhost:11434')` to "score priority faster". REJECT: Scheduler never calls models; put reasoning in a Worker task behind ModelProvider.
2. Capability (finance) runs `db.$queryRaw('UPDATE tasks SET state=...')` to force a retry. REJECT: only Task Store/Queue own state transitions.
3. Tool `shell.execute` called directly from planner code without `permission.evaluate()`. REJECT: every tool call gates on PermissionEngine; model intent is not authority.
4. Worker computes `netWorth = llm("estimate my net worth")` and stores it. REJECT: structured data stays relational (`Assets − Liabilities` deterministic query); LLM explains, never invents numbers.
5. Catch-up implemented as `for (missed of last3Days) enqueue(scan)` after 3-day outage. REJECT: semantic catch-up — one scan since `last-successful-checkpoint` with dedup/idempotency.
6. `const OLLAMA_URL = 'http://laptop:11434'` hard-coded in worker. REJECT: no machine identity; endpoint from config, capability matching from registry.
7. LLM-per-role (`new OllamaProcess('planner')`, `new OllamaProcess('critic')`). REJECT: logical roles share models via ModelProvider; roles ≠ processes.
