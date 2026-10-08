import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Queue, Task, WorkerRegistration } from "@personalos/contracts";
import { TaskRepository } from "./task-store.js";

// Durable handoff (ARCHITECTURE §3): claim and state change happen in ONE
// transaction so a crashed worker can never leave a task half-claimed.
export class PgQueue implements Queue {
  private readonly store: TaskRepository;

  constructor(
    private readonly db: PrismaClient,
    private readonly leaseSeconds: number,
  ) {
    this.store = new TaskRepository(db);
  }

  async enqueue(task: Parameters<Queue["enqueue"]>[0]): Promise<Task> {
    if (task.type === undefined || task.input === undefined) {
      throw new Error("enqueue requires at least { type, input }");
    }
    const created = await this.store.create({
      type: task.type,
      input: task.input,
      capability: task.capability,
      requiredCapabilities: task.requiredCapabilities ?? [],
      priority: task.priority ?? 0,
      idempotencyKey: task.idempotencyKey,
      maxRetries: task.maxRetries ?? 3,
      notBefore: task.notBefore,
    });
    // created→queued is the queue accepting ownership; terminal states here
    // would mean the store already moved it, so any failure throws loudly.
    return this.store.transition(created.id, "queued");
  }

  async dequeue(worker: WorkerRegistration): Promise<Task | null> {
    const expiresAt = new Date(Date.now() + this.leaseSeconds * 1000);
    const claimed = await this.db.$transaction(async (tx) => {
      // requiredCapabilities ⊆ worker.capabilities via JSONB containment;
      // missing key means "any worker can run it".
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        SELECT id FROM tasks
        WHERE state = 'queued'
          AND run_after <= now()
          AND (lease_expires_at IS NULL OR lease_expires_at < now())
          AND (
            payload->'requiredCapabilities' IS NULL
            OR payload->'requiredCapabilities' <@ ${JSON.stringify(worker.capabilities)}::jsonb
          )
        ORDER BY priority DESC, run_after ASC, created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      `);
      const first = rows[0];
      if (first === undefined) return null;
      return this.store.transition(
        first.id,
        "running",
        { leaseOwner: worker.id, leaseExpiresAt: expiresAt },
        tx,
      );
    });
    return claimed;
  }

  async complete(taskId: string, output: unknown): Promise<void> {    await this.store.transition(taskId, "done", {
      output,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  async fail(taskId: string, error: NonNullable<Task["error"]>): Promise<void> {
    const task = await this.store.get(taskId);
    const retriesLeft = task.retryCount < task.maxRetries;
    if (retriesLeft) {
      await this.store.transition(taskId, "queued", {
        errorCode: error.code,
        errorMessage: error.message,
        retryCount: task.retryCount + 1,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
    } else {
      await this.store.transition(taskId, "failed", {
        errorCode: error.code,
        errorMessage: error.message,
        leaseOwner: null,
        leaseExpiresAt: null,
      });
    }
  }

  // Parked deliberately (offline work waits for network.available, Phase 5);
  // the lease is dropped so recovery never mistakes parking for a crash.
  async parkWaitingForNetwork(taskId: string, checkpoint?: unknown): Promise<void> {
    const extra = checkpoint === undefined ? {} : { checkpoint: { parked: checkpoint } };
    await this.store.transition(taskId, "waiting_for_network", {
      ...extra,
      leaseOwner: null,
      leaseExpiresAt: null,
    });
  }

  // Boot recovery (ARCHITECTURE §4 step 3-4): tasks stuck running with an
  // expired lease belonged to a dead worker. Retry budget decides requeue vs
  // terminal; waiting_for_network rows are parked deliberately, never stale.
  async requeueStale(now: Date = new Date()): Promise<{ requeued: number; failed: number }> {
    const stuck = await this.db.task.findMany({
      where: { state: "running", leaseExpiresAt: { lt: now } },
      select: { id: true },
    });
    let requeued = 0;
    let failed = 0;
    for (const { id } of stuck) {
      const task = await this.store.get(id);
      if (task.retryCount < task.maxRetries) {
        await this.store.transition(id, "queued", {
          errorCode: "WORKER_LOST",
          errorMessage: "worker disappeared; lease expired",
          retryCount: task.retryCount + 1,
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        requeued += 1;
      } else {
        await this.store.transition(id, "failed", {
          errorCode: "WORKER_LOST",
          errorMessage: "worker disappeared; no retries left",
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        failed += 1;
      }
    }
    return { requeued, failed };
  }
}
