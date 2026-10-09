import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Server } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PgQueue, TaskRepository, WorkerHost, recoverOnBoot } from "@personalos/core";
import { ModelRegistry, OllamaProvider, qwen25_3b } from "@personalos/models";
import { MemoryStore } from "@personalos/memory";
import { CapabilityRegistry } from "@personalos/capabilities";
import {
  FinanceStore,
  financeHandlers,
  financeManifest,
  financeRouter,
  financeTools,
} from "@personalos/finance";
import {
  JobsStore,
  jobsHandlers,
  jobsManifest,
  jobsRouter,
  jobsTools,
} from "@personalos/jobs";
import { Scheduler } from "@personalos/scheduler";
import {
  DefaultPermissionEngine,
  ToolExecutor,
  ToolRegistry,
  filesystemTools,
  gitTools,
  shellTools,
  webTools,
} from "@personalos/tools";
import { createApp } from "./app.js";
import { agentRouter } from "./agent.js";
import { memoryRouter } from "./memory.js";
import { scheduleRouter } from "./schedules.js";
import { defaultHandlers } from "./handlers.js";
import { logger } from "./logger.js";

export interface BootstrapOptions {
  port: number;
  workerEnabled: boolean;
  workerId: string;
  capabilities: string[];
  pollMs: number;
  heartbeatSeconds: number;
  leaseSeconds: number;
  ollamaUrl: string;
  modelTimeoutMs: number;
  defaultModel: string;
  schedulerEnabled: boolean;
  schedulerPollMs: number;
  workspaceDir: string;
}

export interface RunningService {
  app: Express;
  queue: PgQueue;
  store: TaskRepository;
  models: ModelRegistry;
  tools: ToolExecutor;
  port: number;
  stop: () => Promise<void>;
}

// Full Phase 1 slice in one place: recover -> serve -> (optionally) work.
// The worker lives in-process ONLY until Phase 5/8 splits scheduling and
// execution into separate processes/nodes; the WorkerHost boundary (queue
// polling, no direct calls) already enforces the split.
export async function bootstrap(
  prisma: PrismaClient,
  opts: BootstrapOptions,
): Promise<RunningService> {
  const store = new TaskRepository(prisma);
  const queue = new PgQueue(prisma, opts.leaseSeconds);

  const recovery = await recoverOnBoot(prisma, opts.leaseSeconds);
  logger.info(recovery, "boot recovery complete");

  // Model registry: providers register here, nothing else may construct one
  // that talks to model servers (ADR-003). No handler uses it yet (Phase 4).
  const models = new ModelRegistry();
  models.register({
    metadata: qwen25_3b,
    provider: new OllamaProvider({ baseUrl: opts.ollamaUrl, timeoutMs: opts.modelTimeoutMs }),
  });
  logger.info({ models: models.list().map((m) => m.id) }, "models registered");

  // Tool wall: registry + permission engine + gated executor. Nothing else in
  // the codebase may execute tools except through this executor (Phase 4
  // planner will be its first real caller).
  const workspaceRoot = path.resolve(process.cwd(), opts.workspaceDir);
  await mkdir(workspaceRoot, { recursive: true });
  const toolRegistry = new ToolRegistry();
  for (const tool of [
    ...filesystemTools(workspaceRoot),
    ...webTools(),
    ...shellTools(workspaceRoot),
    ...gitTools(workspaceRoot),
  ]) {
    toolRegistry.register(tool);
  }
  const toolExecutor = new ToolExecutor(toolRegistry, new DefaultPermissionEngine(), {
    sandboxRoot: workspaceRoot,
    audit: async (entry) => {
      await prisma.auditLog.create({
        data: {
          who: entry.who,
          action: entry.action,
          policy: entry.policy,
          toolName: entry.toolName,
          result: entry.result,
          detail: entry.detail as Prisma.InputJsonValue,
          ...(entry.workerId !== undefined ? { workerId: entry.workerId } : {}),
          ...(entry.taskId !== undefined ? { taskId: entry.taskId } : {}),
        },
      });
    },
  });
  logger.info({ tools: toolRegistry.list().map((t) => t.name) }, "tools registered");

  // First vertical through the capability door: manifest validated, install
  // recorded, handlers/tools/router attached. Core files above this line never
  // mention finance — that is the whole point being proven.
  const financeStore = new FinanceStore(prisma);
  const financeToolList = financeTools(financeStore);
  for (const tool of financeToolList) toolRegistry.register(tool);
  const jobsStore = new JobsStore(prisma);
  const jobsToolList = jobsTools(jobsStore, toolExecutor);
  for (const tool of jobsToolList) toolRegistry.register(tool);
  const capabilities = new CapabilityRegistry(async (manifest, enabled) => {
    const doc = JSON.parse(JSON.stringify(manifest)) as Prisma.InputJsonValue;
    await prisma.installedCapability.upsert({
      where: { name: manifest.name },
      create: { name: manifest.name, version: manifest.version, manifest: doc, enabled },
      update: { version: manifest.version, manifest: doc, enabled },
    });
  });
  await capabilities.install({
    manifest: financeManifest,
    handlers: financeHandlers(toolExecutor),
    tools: financeToolList,
  });
  await capabilities.install({
    manifest: jobsManifest,
    handlers: jobsHandlers({ store, queue, executor: toolExecutor, jobs: jobsStore }),
    tools: jobsToolList,
  });
  logger.info({ capabilities: capabilities.list().map((m) => `${m.name}@${m.version}`) }, "capabilities installed");

  let host: WorkerHost | null = null;
  let scheduler: Scheduler | null = null;
  const memory = new MemoryStore(prisma);
  const handlerDeps = { store, queue, models, defaultModel: opts.defaultModel, memory };
  const allHandlers = new Map([
    ...defaultHandlers(handlerDeps),
    ...financeHandlers(toolExecutor),
    ...jobsHandlers({ store, queue, executor: toolExecutor, jobs: jobsStore }),
  ]);
  if (opts.workerEnabled) {
    host = new WorkerHost(prisma, queue, {
      workerId: opts.workerId,
      capabilities: opts.capabilities,
      pollMs: opts.pollMs,
      heartbeatSeconds: opts.heartbeatSeconds,
      handlers: allHandlers,
      onTaskError: (err, taskId) => logger.error({ err, taskId }, "worker task error"),
    });
    await host.start();
    logger.info({ workerId: opts.workerId }, "worker started");
  }

  // Scheduler shares the process for now (same Phase 5/8 split story as the
  // worker): it only enqueues through the queue, never executes inline.
  if (opts.schedulerEnabled) {
    scheduler = new Scheduler(prisma, {
      pollMs: opts.schedulerPollMs,
      enqueue: (t) => queue.enqueue({ ...t, requiredCapabilities: [] }),
      onError: (err, jobName) => logger.error({ err, jobName }, "scheduler job error"),
    });
    scheduler.start();
    logger.info("scheduler started");
  }

  const app = createApp({
    prisma,
    store,
    queue,
    workerStatus: () => (host === null ? "disabled" : "enabled"),
    schedulerStatus: () => (scheduler === null ? "disabled" : "ready"),
    modelIds: () => models.list().map((m) => m.id),
    tools: () => toolRegistry.list(),
    agent: agentRouter(handlerDeps),
    schedules: scheduleRouter(prisma),
    memory: memoryRouter(memory),
    finance: financeRouter(financeStore, toolExecutor),
    jobs: jobsRouter(jobsStore, queue),
  });

  let server: Server | null = null;
  let boundPort = opts.port;
  await new Promise<void>((resolve) => {
    server = app.listen(opts.port, () => {
      const addr = server?.address();
      boundPort = typeof addr === "object" && addr !== null ? addr.port : opts.port;
      logger.info({ port: boundPort }, "API listening");
      resolve();
    });
  });

  return {
    app,
    queue,
    store,
    models,
    tools: toolExecutor,
    port: boundPort,
    stop: async (): Promise<void> => {
      if (host !== null) await host.stop();
      if (scheduler !== null) await scheduler.stop();
      await new Promise<void>((resolve, reject) => {
        if (server === null) return resolve();
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      });
      await prisma.$disconnect();
    },
  };
}
