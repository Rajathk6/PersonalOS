import type { Express } from "express";
import type { PrismaClient } from "@prisma/client";
import type { Server } from "node:http";
import { PgQueue, TaskRepository, WorkerHost, recoverOnBoot } from "@personalos/core";
import { ModelRegistry, OllamaProvider, qwen25_3b } from "@personalos/models";
import { createApp } from "./app.js";
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
}

export interface RunningService {
  app: Express;
  queue: PgQueue;
  store: TaskRepository;
  models: ModelRegistry;
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

  let host: WorkerHost | null = null;
  if (opts.workerEnabled) {
    host = new WorkerHost(prisma, queue, {
      workerId: opts.workerId,
      capabilities: opts.capabilities,
      pollMs: opts.pollMs,
      heartbeatSeconds: opts.heartbeatSeconds,
      handlers: defaultHandlers(),
      onTaskError: (err, taskId) => logger.error({ err, taskId }, "worker task error"),
    });
    await host.start();
    logger.info({ workerId: opts.workerId }, "worker started");
  }

  const app = createApp({
    prisma,
    store,
    queue,
    workerStatus: () => (host === null ? "disabled" : "enabled"),
    modelIds: () => models.list().map((m) => m.id),
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
    port: boundPort,
    stop: async (): Promise<void> => {
      if (host !== null) await host.stop();
      await new Promise<void>((resolve, reject) => {
        if (server === null) return resolve();
        server.close((err) => (err === undefined ? resolve() : reject(err)));
      });
      await prisma.$disconnect();
    },
  };
}
