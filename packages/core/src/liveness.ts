import type { PrismaClient } from "@prisma/client";
import { TaskRepository } from "./task-store.js";

export interface LivenessReport {
  markedOffline: string[];
  requeued: number;
  failed: number;
}

// Offline detection (spec §8/13): heartbeats are the ONLY liveness signal.
// Workers silent past the threshold flip to offline, and their running tasks
// return to the queue IMMEDIATELY with retry accounting (same rules as boot
// recovery) instead of waiting out the lease. Idempotent: re-running changes
// nothing further. A poison task still terminates via maxRetries.
export async function sweepOfflineWorkers(
  db: PrismaClient,
  offlineAfterSeconds: number,
  now: Date = new Date(),
): Promise<LivenessReport> {
  const cutoff = new Date(now.getTime() - offlineAfterSeconds * 1000);
  const dead = await db.worker.findMany({
    where: { status: "online", lastHeartbeat: { lt: cutoff } },
    select: { id: true },
  });
  const store = new TaskRepository(db);
  let requeued = 0;
  let failed = 0;
  for (const w of dead) {
    await db.worker.update({ where: { id: w.id }, data: { status: "offline" } });
    const orphaned = await db.task.findMany({
      where: { state: "running", leaseOwner: w.id },
      select: { id: true },
    });
    for (const { id } of orphaned) {
      const task = await store.get(id);
      if (task.retryCount < task.maxRetries) {
        await store.transition(id, "queued", {
          errorCode: "WORKER_LOST",
          errorMessage: `worker ${w.id} went offline`,
          retryCount: task.retryCount + 1,
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        requeued += 1;
      } else {
        await store.transition(id, "failed", {
          errorCode: "WORKER_LOST",
          errorMessage: `worker ${w.id} went offline; no retries left`,
          leaseOwner: null,
          leaseExpiresAt: null,
        });
        failed += 1;
      }
    }
  }
  return { markedOffline: dead.map((w) => w.id), requeued, failed };
}
