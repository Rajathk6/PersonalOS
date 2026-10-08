import type { Prisma, PrismaClient, Task as TaskRow } from "@prisma/client";
import type { Task, TaskState } from "@personalos/contracts";
import { ContractError } from "@personalos/contracts";
import { z } from "zod";
import { getPrisma } from "./db.js";
import { assertTransition } from "./transitions.js";

type Db = PrismaClient | Prisma.TransactionClient;

// Envelope: Prisma has no capability columns, so routing metadata rides
// inside payload. Readers must unwrap via toContractTask, never raw payload.
const EnvelopeSchema = z.object({
  input: z.unknown(),
  capability: z.string().optional(),
  requiredCapabilities: z.array(z.string()).default([]),
});

export const CreateTaskSchema = z.object({
  type: z.string().min(1),
  input: z.unknown(),
  capability: z.string().optional(),
  requiredCapabilities: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
  idempotencyKey: z.string().optional(),
  maxRetries: z.number().int().min(0).default(3),
  notBefore: z.string().datetime({ offset: true }).optional(),
});

export type CreateTaskInput = z.input<typeof CreateTaskSchema>;

interface Checkpoint {
  output?: unknown;
  lastError?: { code: string; message: string };
  [key: string]: unknown;
}

function toContractTask(row: TaskRow): Task {
  const envelope = EnvelopeSchema.parse(row.payload);
  const checkpoint = (row.checkpoint ?? {}) as Checkpoint;
  const error = checkpoint.lastError;
  return {
    id: row.id,
    type: row.type,
    state: row.state as TaskState,
    input: envelope.input,
    priority: row.priority,
    notBefore: row.runAfter.toISOString(),
    retryCount: row.retryCount,
    maxRetries: row.maxRetries,
    lease:
      row.leaseOwner === null || row.leaseExpiresAt === null
        ? null
        : { workerId: row.leaseOwner, expiresAt: row.leaseExpiresAt.toISOString() },
    requiredCapabilities: envelope.requiredCapabilities,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    // exactOptionalPropertyTypes: never assign explicit undefined; spread only
    // when the value exists.
    ...(envelope.capability !== undefined ? { capability: envelope.capability } : {}),
    ...(checkpoint.output !== undefined ? { output: checkpoint.output } : {}),
    ...(error !== undefined
      ? { error: { code: error.code, retryable: row.state === "queued", message: error.message } }
      : {}),
    ...(row.idempotencyKey !== null ? { idempotencyKey: row.idempotencyKey } : {}),
    ...(row.checkpoint !== null ? { lastCheckpoint: row.checkpoint } : {}),
  };
}

export class TaskRepository {
  constructor(private readonly db: Db = defaultDb()) {}

  // Idempotent: same key returns the existing row instead of a duplicate,
  // so retried creates (e.g. after power loss) never double side effects.
  async create(raw: CreateTaskInput, db: Db = this.db): Promise<Task> {
    const input = CreateTaskSchema.parse(raw);
    // JSON-cast: values are JSON by construction (zod-validated input plus
    // string/string[] metadata); Prisma's Json type cannot express that.
    const payload = {
      input: input.input,
      ...(input.capability !== undefined ? { capability: input.capability } : {}),
      requiredCapabilities: input.requiredCapabilities,
    } as Prisma.InputJsonValue;
    try {
      const row = await db.task.create({
        data: {
          type: input.type,
          state: "created",
          priority: input.priority,
          payload,
          maxRetries: input.maxRetries,
          ...(input.idempotencyKey !== undefined ? { idempotencyKey: input.idempotencyKey } : {}),
          ...(input.notBefore !== undefined ? { runAfter: new Date(input.notBefore) } : {}),
        },
      });
      await this.audit(db, row.id, "task.created", { type: input.type });
      return toContractTask(row);
    } catch (err) {
      if (isUniqueViolation(err) && input.idempotencyKey !== undefined) {
        const existing = await db.task.findFirstOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return toContractTask(existing);
      }
      throw err;
    }
  }

  async get(id: string, db: Db = this.db): Promise<Task> {
    const row = await db.task.findUnique({ where: { id } });
    if (row === null) throw new ContractError("NOT_FOUND", `task ${id} not found`);
    return toContractTask(row);
  }

  // Sole owner of persisted state changes: every transition is guarded by the
  // pure machine and paired with an audit row (append-only accountability).
  async transition(
    id: string,
    to: TaskState,
    opts: {
      errorCode?: string;
      errorMessage?: string;
      output?: unknown;
      checkpoint?: Record<string, unknown>;
      leaseOwner?: string | null;
      leaseExpiresAt?: Date | null;
      retryCount?: number;
    } = {},
    db: Db = this.db,
  ): Promise<Task> {
    const current = await db.task.findUnique({ where: { id } });
    if (current === null) throw new ContractError("NOT_FOUND", `task ${id} not found`);
    assertTransition(current.state as TaskState, to);
    const prevCheckpoint = (current.checkpoint ?? {}) as Checkpoint;
    const nextCheckpoint: Checkpoint = { ...prevCheckpoint, ...(opts.checkpoint ?? {}) };
    if (opts.output !== undefined) nextCheckpoint.output = opts.output;
    if (opts.errorCode !== undefined) {
      nextCheckpoint.lastError = { code: opts.errorCode, message: opts.errorMessage ?? opts.errorCode };
    }
    const row = await db.task.update({
      where: { id },
      data: {
        state: to,
        checkpoint: nextCheckpoint as Prisma.InputJsonValue,
        lastErrorCode: opts.errorCode ?? current.lastErrorCode,
        retryCount: opts.retryCount ?? current.retryCount,
        leaseOwner: opts.leaseOwner === undefined ? current.leaseOwner : opts.leaseOwner,
        leaseExpiresAt: opts.leaseExpiresAt === undefined ? current.leaseExpiresAt : opts.leaseExpiresAt,
      },
    });
    await this.audit(db, id, `task.${to}`, {
      from: current.state,
      ...(opts.errorCode !== undefined ? { errorCode: opts.errorCode } : {}),
    });
    return toContractTask(row);
  }

  async listByState(state: TaskState, db: Db = this.db): Promise<Task[]> {
    const rows = await db.task.findMany({ where: { state }, orderBy: { createdAt: "asc" } });
    return rows.map(toContractTask);
  }

  private async audit(db: Db, taskId: string, action: string, detail: Record<string, unknown>): Promise<void> {
    await db.auditLog.create({
      data: { who: "task-store", action, taskId, result: "ok", detail: detail as Prisma.InputJsonValue },
    });
  }
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code: unknown }).code === "P2002"
  );
}

// Default client resolves lazily at construction so importing this module
// never requires DATABASE_URL to be set (tests import freely, wire later).
function defaultDb(): PrismaClient {
  return getPrisma();
}
