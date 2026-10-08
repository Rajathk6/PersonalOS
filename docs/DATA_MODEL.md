# DATA_MODEL — Phase 0→1 (DDL sketches, not migrations)

Scope: tasks, steps, workers, schedules, audit. Everything else defers to Phase 7.
Conventions: `id UUID PK DEFAULT gen_random_uuid()`, times `TIMESTAMPTZ`, money/counts never FLOAT. State columns use CHECK constraints, not enums (easier to extend).

## 1. tasks — the unit of durable work
```sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,                                   -- e.g. 'reminder.send', 'demo.echo'
  state TEXT NOT NULL CHECK (state IN
    ('created','queued','running','waiting_for_network','waiting_for_approval','done','failed','cancelled')),
  priority INT NOT NULL DEFAULT 0,                      -- higher = sooner
  payload JSONB NOT NULL DEFAULT '{}',                  -- input, never mutated after queue
  idempotency_key TEXT UNIQUE,                          -- client-supplied; NULL allowed, value unique
  checkpoint JSONB NOT NULL DEFAULT '{}',               -- resume point; worker updates often
  retry_count INT NOT NULL DEFAULT 0,
  max_retries INT NOT NULL DEFAULT 3,
  lease_owner TEXT,                                     -- worker id holding the task, NULL = unclaimed
  lease_expires_at TIMESTAMPTZ,                         -- NULL = unclaimed; past = reclaimable
  run_after TIMESTAMPTZ NOT NULL DEFAULT now(),         -- delay / backoff / scheduled start
  last_error_code TEXT,                                 -- structured code from ToolResult, not prose
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

## 2. task_steps — workflows persist per step (Phase 1)
```sql
CREATE TABLE task_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  step_index INT NOT NULL,                              -- 0,1,2… order within the task
  kind TEXT NOT NULL,                                   -- 'plan' | 'execute' | 'verify' | 'tool:<name>'
  state TEXT NOT NULL CHECK (state IN ('pending','running','done','failed','skipped')),
  input JSONB NOT NULL DEFAULT '{}',
  output JSONB,                                         -- NULL until done; never overwritten on retry
  checkpoint JSONB NOT NULL DEFAULT '{}',
  retry_count INT NOT NULL DEFAULT 0,
  worker_id TEXT,                                       -- who ran it (no FK: workers come and go)
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (task_id, step_index)
);
-- A "workflow" = one tasks row + N task_steps rows. No separate workflows table in Phase 0→1.
```

## 3. workers — who can do work right now
```sql
CREATE TABLE workers (
  id TEXT PRIMARY KEY,                                  -- e.g. 'laptop-01', 'pi-01'; never hard-coded in app
  capabilities TEXT[] NOT NULL DEFAULT '{}',            -- e.g. '{local_llm,light_compute,notify}'
  status TEXT NOT NULL DEFAULT 'online'
    CHECK (status IN ('online','offline','draining')),
  last_heartbeat TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata JSONB NOT NULL DEFAULT '{}'                  -- hw notes, model ids; advisory only
);
```

## 4. scheduled_jobs — recurring work + semantic catch-up
```sql
CREATE TABLE scheduled_jobs (
  name TEXT PRIMARY KEY,                                -- e.g. 'jobs.daily-scan'
  kind TEXT NOT NULL,                                   -- 'cron' | 'interval' | 'event' | 'monitor'
  schedule TEXT NOT NULL,                               -- cron expr or 'every 24h'; opaque to DB
  payload JSONB NOT NULL DEFAULT '{}',
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  last_checkpoint TIMESTAMPTZ,                          -- last SUCCESSFUL run; catch-up starts from here
  last_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  catchup_policy TEXT NOT NULL DEFAULT 'since-last-success'
    CHECK (catchup_policy IN ('since-last-success','skip','once')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Catch-up rule: on boot, scheduler creates ONE task with payload {since: last_checkpoint}, never N replays.
```

## 5. audit_log — append-only, who did what and was it allowed
```sql
CREATE TABLE audit_log (
  id BIGSERIAL PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  who TEXT NOT NULL,                                    -- 'user' | 'worker:<id>' | 'system'
  action TEXT NOT NULL,                                 -- 'tool.call', 'permission.decision', 'task.transition'
  policy TEXT,                                          -- 'allowed' | 'confirm' | 'denied' (+ approver)
  worker_id TEXT,
  tool_name TEXT,
  task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  result TEXT NOT NULL,                                 -- 'ok' | 'denied' | 'failed' | 'confirmed'
  detail JSONB NOT NULL DEFAULT '{}'
);
```

## 6. Constraints + indexes — why each exists
| Constraint / index | Why | Power-loss reasoning |
|---|---|---|
| `tasks.idempotency_key UNIQUE` | Same user click / retry never creates two tasks | Crash between POST and response → client retries safely |
| `tasks(state)` CHECK | No typo states, state machine stays honest | Recovery code can trust `running` really means claimed |
| `task_steps(task_id, step_index) UNIQUE` | Steps can't duplicate or reorder | Resume continues at first non-`done` step, no double-run |
| `CREATE INDEX tasks_runnable ON tasks (priority DESC, run_after, created_at) WHERE state IN ('created','queued') AND (lease_expires_at IS NULL OR lease_expires_at < now());` | Worker poll is O(few rows), not full scan | After crash, thousands of rows → only reclaimable ones surface |
| `CREATE INDEX tasks_lease ON tasks (lease_expires_at) WHERE state = 'running';` | Reaper finds expired leases fast | Stuck `running` rows (dead worker) become pickable without manual fix |
| `scheduled_jobs(name)` PK + `catchup_policy` CHECK | One row per recurring job, policy explicit | Boot reads one row, emits one catch-up task from `last_checkpoint` |
| `audit_log(at) + (task_id)` indexes | Trace any task's permission/tool history | Post-crash forensics: what ran, what wasside-effecting, what to undo |
| FKs `task_steps→tasks`, `audit→tasks SET NULL` | Steps die with task; audit outlives task | Delete/cancel never orphans steps; audit survives for disputes |

Claim pattern (worker poll): single transaction `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1` on runnable index → `UPDATE tasks SET state='running', lease_owner=$1, lease_expires_at=now()+interval`. Crash before commit = row never claimed. Crash after = lease expires → another worker reclaims and resumes from `checkpoint`.

## 7. Deferred to Phase 7 — one-line stubs, no design now
- `finance_accounts`, `finance_transactions`, `bills`, `budgets` — finance vertical storage (capability-owned).
- `stock_watchlist`, `stock_prices` — stocks vertical storage (capability-owned).
- `job_listings`, `job_applications` — jobs-monitor vertical storage (capability-owned).
- `memory_*`, `documents/embeddings` (pgvector) — Phase 6+ only; no tables until then.
