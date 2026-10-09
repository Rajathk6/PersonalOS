import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { Server } from "node:http";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { PgQueue, TaskRepository, WorkerHost, recoverOnBoot, sweepOfflineWorkers } from "@personalos/core";
import { ApprovalStore } from "@personalos/core";
import {
  BenchmarkStore,
  ModelRegistry,
  OllamaProvider,
  OpenRouterProvider,
  discoverOllama,
  qwen25_3b,
} from "@personalos/models";
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
import { approvalRouter } from "./approvals.js";
import { memoryRouter } from "./memory.js";
import { modelRouter } from "./models.js";
import { scheduleRouter } from "./schedules.js";
import { toolRunRouter } from "./tools.js";
import { workerRouter } from "./workers.js";
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
  openRouterKey: string | null;
  openRouterUrl: string;
  schedulerEnabled: boolean;
  schedulerPollMs: number;
  workerTokens: Map<string, string>;
  livenessSweepS: number;
  offlineAfterS: number;
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

  // Model registry: providers register here (ADR-003). Agent handlers borrow
  // models through the router; nothing outside this file constructs providers.
  const models = new ModelRegistry();
  const ollama = new OllamaProvider({ baseUrl: opts.ollamaUrl, timeoutMs: opts.modelTimeoutMs });
  const openrouter = opts.openRouterKey === null
    ? null
    : new OpenRouterProvider({ baseUrl: opts.openRouterUrl, apiKey: opts.openRouterKey, timeoutMs: opts.modelTimeoutMs });
  // Discovery on boot: register what the providers actually serve. If nothing
  // answers (Ollama down), fall back to the static catalog entry so the
  // system still runs — and say so loudly.
  const discovered = await discoverOllama(opts.ollamaUrl);
  if (discovered.length === 0) {
    models.register({ metadata: qwen25_3b, provider: ollama });
    logger.warn("model discovery found nothing; using static catalog fallback");
  } else {
    for (const meta of discovered) models.register({ metadata: meta, provider: ollama });
  }
  const benchmarks = new BenchmarkStore(prisma);
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
    approvals: new ApprovalStore(prisma),
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
    workers: workerRouter({ prisma, store, queue, tokens: opts.workerTokens }),
    toolRun: toolRunRouter(toolExecutor),
    approvals: approvalRouter(new ApprovalStore(prisma), toolExecutor),
    modelsRoute: modelRouter({
      prisma,
      models,
      benchmarks,
      ollama,
      openrouter,
      ollamaUrl: opts.ollamaUrl,
      openRouterUrl: opts.openRouterUrl,
      openRouterKey: opts.openRouterKey,
    }),
  });

  // Liveness sweep: dead workers flip offline and their tasks requeue now
  // instead of at lease expiry. Idempotent, safe beside any other sweeper.
  const sweepTimer = setInterval(() => {
    void sweepOfflineWorkers(prisma, opts.offlineAfterS)
      .then((report) => {
        if (report.markedOffline.length > 0 || report.requeued > 0 || report.failed > 0) {
          logger.info(report, "liveness sweep");
        }
      })
      .catch((err: unknown) => logger.error({ err }, "liveness sweep failed"));
  }, opts.livenessSweepS * 1000);

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
      clearInterval(sweepTimer);
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
