# PersonalOS — North Star (condensed, read this instead of the .docx)

Source of truth extracted once from `PersonalOS_Complete_Architecture_Specification.docx`
(full text frozen at `.knowledge/SPEC_FULL.txt`, 662 paras). Subagents: read THIS file, not the docx.

## What it is
Local-first personal AI operating platform (not a chatbot, not a single super-agent, not a kernel OS).
Layer: Hardware → Linux → PersonalOS Runtime → Core → Capabilities/Agents/Tools/Memory/Tasks → UIs (phone/browser/CLI/voice).
Feels simple: "Add ₹235 for chicken tikka at 2:30", "find govt engineering jobs worth applying for", "remind me at 4 to leave at 6".

## Non-negotiable principles
1. **Orchestrator + modular capabilities**, logical agent roles (planner, researcher, executor, coder, analyst, critic, verifier, memory, coordinator) — roles share models, NOT one LLM process per role.
2. **Scheduler → Task → Queue → Worker → Model/Tools.** Scheduler NEVER calls Ollama/model directly.
3. **Core is generic and stable.** Domain logic lives in Capabilities. Models behind ModelProvider. External actions behind Tools+Permissions. Execution behind Workers. Scheduling separate from execution.
4. **Persist everything important.** A task must never exist only in LLM context. Workflows persist: workflow_id, step_id, status, input/output, checkpoint, retry_count, worker, timestamps, error. Survive restart/power/network/worker/model failure.
5. **Power/internet loss = normal conditions**, not exceptions. Boot sequence: DB open → state recovered → scheduler/queue recover → workers register → inspect pending → catch-up policy → resume.
6. **Catch-up is semantic, not replay.** Recurring/monitoring tasks keep last-successful-checkpoint + dedup + idempotency. Example: 3-day offline job monitor does ONE scan since Oct 4, not 3 replays.
7. **Model is never the security authority.** Permission Engine (Allowed/Confirm/Denied) gates every tool. Permissive model ≠ permissive system access. Shell is proposed → risk-classified → evaluated → sandboxed → audited.
8. **Structured data stays relational** (PostgreSQL). LLM explains, never invents numbers (Net Worth = Assets − Liabilities, deterministic). Don't vectorize everything; vector only where semantic search genuinely helps (pgvector).
9. **Local-first, ₹0 budget, network-aware.** Tasks can be WAITING_FOR_NETWORK and resume. Cache/dedup, resumable downloads, heavy reasoning local.
10. **Simple implementation + strong boundaries.** Modular monolith first; NO microservices/K8s/mandatory Redis on day one. PG-backed queue is fine. Isolate DB behind repositories so SQLite→PG swap (if ever) doesn't leak. Don't hard-code machine identity — workers register + advertise capabilities + heartbeat.
11. **Future-proof without premature building:** Pi = always-on coordinator (API/DB/scheduler/queue/memory/registries/notifications); laptop = on-demand heavy worker (Ollama); phone = thin client (requests, status, approvals, notifications). Wake-on-LAN optional, never foundational.

## Hardware reality (i7-11th, 12GB, Iris iGPU, 1TB SSD, Linux, no NVIDIA, ~1Mbps, power cuts)
Local quantized LLMs primary. 3B easy, 7B/8B practical with quantization, 14B slow, huge models out.

## Registries (the heart of extensibility)
- **Capability Registry:** manifest (name/version/actions/entities/workflows/tools/permissions/storage-migrations/UI/automations/compat) + lifecycle DISCOVERED→VALIDATING→INSTALLED→ENABLED→DISABLED→UPDATED/REMOVED. First verticals: finance (accounts/transactions/bills/loans/assets/investments/budgets/subscriptions), jobs monitor, stocks. Rule: new domain = new capability, never orchestrator rewrite. Capability Builder (NL→capability) is Phase 11, NOT now — build the extension mechanism first.
- **Model Registry:** ModelProvider interface `generate(request): response`; metadata (id/provider/context/modalities/tool-calling/structured-output/reasoning/latency/cost/availability/local-cloud/hw-reqs). Router considers quality/cost/latency/context/privacy/availability/hw/task-type/tool-support. Discovery flow: inspect→compat→cost→tool-check→benchmark→compare→recommend (never blind replace). Providers: Ollama, llama.cpp, OpenRouter, future.
- **Tool Registry:** `Tool { name, description, inputSchema, execute() → ToolResult }`. Initial: web.search/fetch, filesystem read/write/delete, shell.execute, git, calendar, email draft/send, db.query, notification.send. Every tool: permission reqs + risk (Low/Med/High/Critical) + auditable result. `ToolResult { success, error_code, retryable, message, metadata }` — failures are structured, never corrupt state.
- **Worker Registry:** id, capabilities (e.g. pi: db/scheduler/notify/web/light-compute; laptop: local_llm/coding/doc-analysis; future GPU: large_llm/image/video), auth, heartbeat, offline detection, assignment.

## Permissions (defaults that matter)
Auto: web search, read permitted personal data, create file, modify PersonalOS-created file, delete PersonalOS file (low-risk), draft email, financial analysis.
Ask: modify/delete user files, mass delete, destructive shell, install software, sysconfig, shutdown/reboot, SEND email, money movement (transfer/buy/sell/pay bill), purchases, account/security changes, high-impact syschanges.

## Memory (5+1 types, anti-garbage rules)
Working (task ctx), Episodic (what happened), Semantic (general knowledge), User (stable facts/prefs), Procedural (how workflows run), Task (unfinished objectives/checkpoints/decisions/deps).
Rules: relevance/importance gate, freshness+confidence, structured facts stay structured, selective indexing only.

## Events / Scheduler / Queue
Events: task.created/completed/failed, worker.online/offline, power.recovered, network.available, model.discovered/updated, capability.installed, expense.recorded, stock.changed, job.notification.discovered, user.confirmation.required. Capabilities subscribe without cross-domain hard-coding.
Scheduler: one-time/recurring/deadline/condition/event/monitoring + deps/retries/deadlines/priority/cancel/pause/missed-run/catch-up. Queue: persistent PG abstraction first, Redis/BullMQ only when justified.

## Stack (locked for Phase 0)
TypeScript + Node 24 + Express (light) + PostgreSQL 16 + Prisma + Zod + structured logging (pino) + Vitest + Docker (where useful) + Ollama (Phase 2, behind provider only) + Next.js (Phase 9, not now) + pgvector (only where needed).

## Phases (authoritative)
-1 Architecture (boundaries/interfaces/persistence/state-machine/worker/permission/capability/model — THIS IS WHERE WE ARE)
0 Skeleton: API + PG + Core + Task model/persist + basic worker + ModelProvider/Tool/Capability/Permission interfaces + logging + config
1 Autonomous core: request→intent→plan→task→worker→result→persist; TEST restart recovery before more features
2 Local model via provider abstraction (no direct Ollama calls in app code)
3 Tools behind permissions | 4 Planner/Executor/Verifier | 5 Scheduler+Queue (power-loss test) | 6 Memory | 7 Capability system + first verticals | 8 Multi-node | 9 Phone | 10 Model ecosystem | 11 Capability Builder | 12 Distribution image.

## Rejected (do not revisit without ADR)
Giant single agent; LLM-per-role; microservices/K8s day one; mandatory Redis; scheduler→Ollama direct; everything-in-vector; hard-coded verticals/models; blind model replacement; mandatory cloud; custom kernel; laptop-as-source-of-truth; assuming power/net never fail; blind missed-schedule replay.

## Success = extensibility + model/worker independence + recovery + offline usefulness + security + user control + persistence + NL interaction + ₹0 + years of evolution without rewrite.

## Failure scenarios to eventually simulate
Power/network loss, laptop/Pi disappearance, model crash/unavailable, DB/queue restart, tool timeout, page unavailable, duplicate notification, worker reconnect, mid-task interrupt, user rejects confirmation.
