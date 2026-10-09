import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import pino from "pino";
import {
  DefaultPermissionEngine,
  ToolExecutor,
  ToolRegistry,
  filesystemTools,
  gitTools,
  shellTools,
  webTools,
} from "@personalos/tools";
import { FinanceStore, financeHandlers, financeTools } from "@personalos/finance";
import { JobsStore, jobsHandlers, jobsTools } from "@personalos/jobs";
import { PgQueue, TaskRepository, WorkerHost } from "@personalos/core";
import type { Task } from "@personalos/contracts";
import { workerConfig } from "./config.js";

const logger = pino({ level: workerConfig.logLevel });

// Standalone worker process (Phase 8): same queue, different process. Wires
// the deterministic handlers (reminder/finance/jobs) with its own executor.
// Agent (LLM) handlers stay API-local until the model topology is proven —
// shipping a 2GB model to every worker is a Phase 10 decision, not today's.
// (Deliberate ~60-line duplication of bootstrap wiring; extraction when a
// third process needs it.)
async function main(): Promise<void> {
  const prisma = new PrismaClient({ datasourceUrl: workerConfig.databaseUrl });
  const workspaceRoot = path.resolve(process.cwd(), workerConfig.workspaceDir);
  await mkdir(workspaceRoot, { recursive: true });

  const store = new TaskRepository(prisma);
  const queue = new PgQueue(prisma, workerConfig.leaseS);
  const tools = new ToolRegistry();
  for (const t of [
    ...filesystemTools(workspaceRoot),
    ...webTools(),
    ...shellTools(workspaceRoot),
    ...gitTools(workspaceRoot),
    ...financeTools(new FinanceStore(prisma)),
  ]) {
    tools.register(t);
  }
  const executor = new ToolExecutor(tools, new DefaultPermissionEngine(), {
    sandboxRoot: workspaceRoot,
    audit: async (entry) => {
      await prisma.auditLog.create({
        data: {
          who: entry.who,
          action: entry.action,
          policy: entry.policy,
          toolName: entry.toolName,
          result: entry.result,
          detail: entry.detail as object,
          ...(entry.workerId !== undefined ? { workerId: entry.workerId } : {}),
          ...(entry.taskId !== undefined ? { taskId: entry.taskId } : {}),
        },
      });
    },
  });
  // jobs.check fetches through this same executor (permission + audit apply).
  for (const t of jobsTools(new JobsStore(prisma), executor)) tools.register(t);

  const reminder = async (task: Task): Promise<unknown> => {
    const input = task.input as { text?: unknown };
    if (typeof input.text !== "string" || input.text === "") {
      throw Object.assign(new Error("reminder needs { text }"), { code: "REMINDER_INVALID" });
    }
    logger.info({ text: input.text }, "reminder delivered");
    return { deliveredAt: new Date().toISOString(), text: input.text, channel: "log" };
  };

  const handlers = new Map([
    ["reminder.send", reminder],
    ...financeHandlers(executor),
    ...jobsHandlers({ store, queue, executor, jobs: new JobsStore(prisma) }),
  ]);

  const host = new WorkerHost(prisma, queue, {
    workerId: workerConfig.workerId,
    capabilities: workerConfig.capabilities,
    pollMs: workerConfig.pollMs,
    heartbeatSeconds: workerConfig.heartbeatS,
    handlers,
    onTaskError: (err, taskId) => logger.error({ err, taskId }, "worker task error"),
  });
  await host.start();
  logger.info({ workerId: workerConfig.workerId }, "standalone worker started");

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "worker shutting down");
    void host.stop().then(() => prisma.$disconnect()).then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main().catch((err: unknown) => {
  logger.error({ err }, "fatal worker error");
  process.exit(1);
});
