import type { PrismaClient } from "@prisma/client";
import type { Queue, Task } from "@personalos/contracts";
import { TaskRepository } from "./task-store.js";

export type TaskHandler = (task: Task) => Promise<unknown>;

interface WorkerHostOptions {
  workerId: string;
  capabilities: string[];
  pollMs: number;
  heartbeatSeconds: number;
  handlers: Map<string, TaskHandler>;
  // How many tasks may run at once (a slow task must not block the queue).
  maxConcurrent?: number;
  // Per-task wall-clock cap; 0 = no cap.
  taskDeadlineMs?: number;
  // Crash barrier: a row deleted mid-run (or a DB blip between claim and
  // persist) must never escape as an unhandled rejection that kills the host.
  onTaskError?: (err: unknown, taskId: string | null) => void;
}

// Poll → claim → run → persist. The host never schedules, never judges
// permissions, never invents numbers (ARCHITECTURE §2): it runs the handler
// registered for task.type and persists whatever happens.
export class WorkerHost {
  private readonly store: TaskRepository;
  private timer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private stopped = false;
  private ticking = false;
  private readonly inFlight = new Set<Promise<void>>();

  constructor(
    private readonly db: PrismaClient,
    private readonly queue: Queue,
    private readonly opts: WorkerHostOptions,
  ) {
    this.store = new TaskRepository(db);
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.db.worker.upsert({
      where: { id: this.opts.workerId },
      create: { id: this.opts.workerId, capabilities: this.opts.capabilities, status: "online" },
      update: { capabilities: this.opts.capabilities, status: "online", lastHeartbeat: new Date() },
    });
    await this.beat();
    this.heartbeatTimer = setInterval(() => void this.beat(), this.opts.heartbeatSeconds * 1000);
    this.timer = setInterval(() => void this.tick(), this.opts.pollMs);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer !== null) clearInterval(this.timer);
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    this.timer = null;
    this.heartbeatTimer = null;
  }

  private async beat(): Promise<void> {
    await this.db.worker.update({
      where: { id: this.opts.workerId },
      data: { lastHeartbeat: new Date(), status: "online" },
    }).catch(() => undefined);
  }
  // Overlap guard: a slow handler must delay the next poll, never run twice.
  // CONCURRENCY: several tasks may run at once, otherwise one slow task
  // (a chat waiting on a slow model) blocks every other request behind it.
  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    let taskId: string | null = null;
    try {
      // Phase 0 runs one trusted local host, so worker auth is unenforced
      // (PgQueue ignores it). Real credentials arrive with Phase 8
      // multi-node; grep local-trusted-host to find every placeholder.
      const task = await this.queue.dequeue({
        id: this.opts.workerId,
        capabilities: this.opts.capabilities,
        auth: "local-trusted-host",
      });
      if (task === null) return;
      taskId = task.id;
      // Run in the background so the next poll can pick up more work; the
      // in-flight set is bounded by maxConcurrent.
      const run = this.run(task).finally(() => {
        this.inFlight.delete(run);
      });
      this.inFlight.add(run);
      if (this.inFlight.size >= (this.opts.maxConcurrent ?? 3)) {
        await Promise.race(this.inFlight);
      }    } catch (err) {
      this.opts.onTaskError?.(err, taskId);
    } finally {
      this.ticking = false;
    }
  }

  // Per-task deadline: a task that exceeds it is failed fast (retryable) so
  // it stops hogging a worker slot. Interactive work (chat) must never sit
  // for minutes behind a slow model.
  private async run(task: Task): Promise<void> {
    const handler = this.opts.handlers.get(task.type);
    // Unknown type is a registration bug, not a transient fault: fail fast
    // without burning the retry budget on something that can never succeed.
    if (handler === undefined) {
      await this.store.transition(task.id, "failed", {
        errorCode: "HANDLER_MISSING",
        errorMessage: `no handler registered for type ${task.type}`,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
      return;
    }
    try {
      const output = await this.withDeadline(handler(task), this.opts.taskDeadlineMs ?? 0);
      await this.queue.complete(task.id, output);
    } catch (err) {
      await this.queue.fail(task.id, {
        code: err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : "HANDLER_ERROR",
        retryable: true,
        message: err instanceof Error ? err.message : "handler threw",
      });
    }
  }

  private async withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
    if (!Number.isFinite(ms) || ms <= 0) return work;
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            reject(Object.assign(new Error(`task exceeded ${ms}ms deadline`), { code: "TASK_DEADLINE" }));
          }, ms);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}
