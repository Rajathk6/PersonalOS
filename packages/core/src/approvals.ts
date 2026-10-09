import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

type Db = PrismaClient | Prisma.TransactionClient;

export const ApprovalStatusSchema = z.enum(["pending", "approved", "denied", "executed", "failed"]);
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>;

export interface Approval {
  id: string;
  toolName: string;
  input: unknown;
  actor: string;
  workerId: string | null;
  taskId: string | null;
  reason: string;
  status: ApprovalStatus;
  result: unknown;
  createdAt: string;
  updatedAt: string;
}

type Row = {
  id: string; toolName: string; input: Prisma.JsonValue; actor: string;
  workerId: string | null; taskId: string | null; reason: string;
  status: string; result: Prisma.JsonValue | null; createdAt: Date; updatedAt: Date;
};

function toApproval(row: Row): Approval {
  return {
    id: row.id,
    toolName: row.toolName,
    input: row.input,
    actor: row.actor,
    workerId: row.workerId,
    taskId: row.taskId,
    reason: row.reason,
    status: ApprovalStatusSchema.parse(row.status),
    result: row.result,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Human-in-the-loop persistence (spec §57): parked actions survive restarts,
// so a power cut between "needs confirmation" and the human's answer loses
// nothing. Resolution is one-way: pending -> approved|denied, then the
// executor moves approved -> executed|failed. No other transitions exist.
export class ApprovalStore {
  constructor(private readonly db: Db) {}

  async request(input: {
    toolName: string;
    input: unknown;
    actor: string;
    workerId?: string;
    taskId?: string;
    reason: string;
  }): Promise<Approval> {
    const row = await this.db.approval.create({
      data: {
        toolName: input.toolName,
        input: input.input as Prisma.InputJsonValue,
        actor: input.actor,
        ...(input.workerId !== undefined ? { workerId: input.workerId } : {}),
        ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
        reason: input.reason,
        status: "pending",
      },
    });
    return toApproval(row);
  }

  async get(id: string): Promise<Approval | null> {
    const row = await this.db.approval.findUnique({ where: { id } });
    return row === null ? null : toApproval(row);
  }

  async listPending(): Promise<Approval[]> {
    const rows = await this.db.approval.findMany({
      where: { status: "pending" },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toApproval);
  }

  // Returns false when already resolved (double-tap approve is a no-op, not
  // a double execution — the phone sends what the user taps, twice included).
  async resolvePending(id: string, status: "approved" | "denied", result?: unknown): Promise<boolean> {
    const updated = await this.db.approval.updateMany({
      where: { id, status: "pending" },
      data: {
        status,
        ...(result !== undefined ? { result: result as Prisma.InputJsonValue } : {}),
      },
    });
    return updated.count === 1;
  }

  async markExecuted(id: string, result: unknown, ok: boolean): Promise<void> {
    await this.db.approval.update({
      where: { id },
      data: { status: ok ? "executed" : "failed", result: result as Prisma.InputJsonValue },
    });
  }
}
