import type { PrismaClient } from "@prisma/client";
import { PgQueue } from "./queue.js";

export interface RecoveryReport {
  requeued: number;
  failed: number;
  keptQueued: number;
  parkedWaiting: number;
}

// Boot sequence step (ARCHITECTURE §4.3-4): assume NO in-memory state
// survived. Stale leases return to the queue; parked network tasks wait for
// the network.available event (Phase 5); queued rows simply stay queued.
export async function recoverOnBoot(
  db: PrismaClient,
  leaseSeconds: number,
): Promise<RecoveryReport> {
  const queue = new PgQueue(db, leaseSeconds);
  const { requeued, failed } = await queue.requeueStale();
  const [keptQueued, parkedWaiting] = await Promise.all([
    db.task.count({ where: { state: "queued" } }),
    db.task.count({ where: { state: "waiting_for_network" } }),
  ]);
  return { requeued, failed, keptQueued, parkedWaiting };
}
