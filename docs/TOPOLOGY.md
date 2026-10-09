# TOPOLOGY — three tiers: user phone, middleman, laptop (authoritative)

Status: decided 2026-10-10 with the user. This file OVERRULES the old
"phone is only a display / Pi-or-nothing coordinator" assumption wherever
they conflict. The original spec text stays frozen in `.knowledge/NORTH_STAR.md`;
this file is where the deployment truth lives.

## The three tiers (plain English)

```
 USER PHONE (own separate network)         ISOLATED
   UI only: dashboard, approvals, reminders
   holds: user API token. Sees: NOTHING else (no DB, no queue internals)
                    ↕ authenticated HTTPS/API only
 MIDDLEMAN PHONE (always up, own compute)  RELAY + QUEUE + LIGHT TASKS
   owns: task queue, worker registry, relay, notifications fan-out
   runs: light tasks itself (reminders dispatch, keyword checks, status)
   holds: relay credentials + a LIGHTWEIGHT store (not full Postgres)
   delegates: heavy tasks (LLM, big analysis) to the laptop when present
                    ↕ authenticated, least-privilege
 LAPTOP (main server, on demand)            FULL STORE + HEAVY COMPUTE
   owns: the full system of record (Postgres), models, capabilities,
         scheduler, audit, backups
   configurable: runs as full node / coordinator-only / worker-only (see below)
```

## Why this way (the user's goals, recorded verbatim in spirit)
1. **Isolation first.** The user phone sits on its own separate network and can
   never reach the laptop directly. Every hop is authenticated; every tier
   holds only the credentials it needs (user token ≠ relay credentials ≠
   laptop master token).
2. **User vs server, crisply separated.** The user phone is pure user space
   (interface). Everything else is server space, split across two machines by
   cost of compute.
3. ** Middleman is a real server, not a display.** It is always up, has its own
   compute, holds the queue and relay state, and clears light tasks itself.
   Heavy work goes to the laptop IF the laptop is on; otherwise heavy tasks
   wait (WAITING state, never lost) — the middleman never pretends to do them.
4. **Laptop is the main server AND fully configurable.** One machine, four
   postures, chosen by env (tomorrow's config work):
   - `standalone` (today): everything on the laptop, middleman absent.
   - `main`: full store + heavy compute; queue+relay delegated to middleman.
   - `coordinator-only`: API/DB/scheduler, no worker (battery saver).
   - `worker-only`: heavy compute only, polls the middleman's queue.

## What the current code already gives us (honest inventory)
- Token auth on every hop, no hard-coded hosts, capability-matched assignment,
  lease/requeue recovery, idempotency keys, approval-gated actions. The
  DISTRIBUTION MECHANISM is done; the middleman is a new node shape, not a
  rewrite.

## Hard problems, named (tomorrow's work, not hand-waved)
1. **Two stores, one truth.** Middleman needs a lightweight store (SQLite —
   Postgres has no business on a phone) while the laptop's Postgres stays the
   system of record. Sync protocol needed: task ownership by id, idempotency
   keys as dedup, outbox/inbox per side, conflict rule (laptop wins on
   structured facts; earliest-write wins on queue position). THIS is the core
   design task.
2. **Android reality.** Battery optimization kills background processes; no
   Docker; storage is fragile. Mitigations: foreground service + battery
   exemption, SQLite (WAL mode), Termux or a minimal native shell, small
   memory footprint, heartbeat-driven liveness (already our only signal).
   First step tomorrow: assess the actual middleman device (Android version,
   TermuxOK, RAM) before committing to a runtime.
3. **Wake path.** Middleman must be able to rouse the laptop (push/WOL where
   hardware allows) or patiently hold heavy tasks. Never forced power-off as
   a control plane.
4. **User phone stays dumb.** No queue logic, no tokens beyond its own, works
   over whatever network it has (Tailscale remains the recommended link).

## Correction log (accountability)
- 2026-10-08 I recorded "old phone is a display, not a Pi replacement" and
  pushed Tailscale as THE answer. That was wrong in two ways: it demoted your
  middleman to a screen, and it answered "reachability" while you asked for
  "isolation + relay architecture". Reachability (Tailscale) is still useful
  plumbing, but it is NOT the architecture. This file is the architecture.
