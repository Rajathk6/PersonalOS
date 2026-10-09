import { createPrisma } from "@personalos/core";
import { bootstrap } from "./bootstrap.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

// Production entry: config from env, one process, graceful shutdown.
// Test entry: import bootstrap directly with injected Prisma + options.
async function main(): Promise<void> {
  const prisma = createPrisma(config.databaseUrl);
  const service = await bootstrap(prisma, {
    port: config.port,
    workerEnabled: config.workerEnabled,
    workerId: config.workerId,
    capabilities: [],
    pollMs: config.workerPollMs,
    heartbeatSeconds: config.workerHeartbeatS,
    leaseSeconds: config.workerLeaseS,
    ollamaUrl: config.ollamaUrl,
    modelTimeoutMs: config.modelTimeoutMs,
    defaultModel: config.defaultModel,
    schedulerEnabled: config.schedulerEnabled,
    schedulerPollMs: config.schedulerPollMs,
    workerTokens: config.workerTokens,
    livenessSweepS: config.livenessSweepS,
    offlineAfterS: config.offlineAfterS,
    workspaceDir: config.workspaceDir,
  });

  const shutdown = (signal: string): void => {
    logger.info({ signal }, "shutting down");
    void service.stop().then(() => process.exit(0));
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

void main().catch((err: unknown) => {
  logger.error({ err }, "fatal startup error");
  process.exit(1);
});
