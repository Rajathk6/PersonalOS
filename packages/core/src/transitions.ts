import type { TaskState } from "@personalos/contracts";
import { ContractError } from "@personalos/contracts";

// Pure state machine (ARCHITECTURE §3). kept DB-free so it is unit-testable
// and so TaskRepository stays the single owner of persisted transitions.
const ALLOWED: Record<TaskState, readonly TaskState[]> = {
  created: ["queued", "cancelled"],
  queued: ["running", "cancelled", "waiting_for_network"],
  running: ["done", "failed", "queued", "waiting_for_network", "cancelled"],
  waiting_for_network: ["queued", "cancelled"],
  done: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertTransition(from: TaskState, to: TaskState): void {
  if (!canTransition(from, to)) {
    throw new ContractError(
      "VALIDATION_FAILED",
      `illegal task transition ${from} -> ${to}`,
    );
  }
}
