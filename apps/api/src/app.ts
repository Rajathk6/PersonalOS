import type { Express } from "express";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { PgQueue, TaskRepository } from "@personalos/core";
import { auth } from "./auth.js";
import { logger } from "./logger.js";
import { taskRouter } from "./tasks.js";
import { version } from "./version.js";

export interface AppDeps {
  prisma: PrismaClient;
  store: TaskRepository;
  queue: PgQueue;
  workerStatus: () => "enabled" | "disabled";
  modelIds: () => string[];
}

// App factory (not a singleton): production and tests each build their own
// instance with injected deps. Nothing here owns startup or intervals.
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  app.use((req: Request, _res: Response, next: NextFunction): void => {
    logger.info({ method: req.method, url: req.url }, "request");
    next();
  });

  app.use(auth);

  app.get("/health", (_req: Request, res: Response): void => {
    void deps.prisma.$queryRaw`SELECT 1`
      .then(() => {
        res.json({
          status: "ok",
          db: "online",
          queue: "ready",
          scheduler: "not-wired",
          worker: deps.workerStatus(),
          models: deps.modelIds(),
          version,
        });
      })
      .catch(() => {
        res.status(503).json({ status: "degraded", db: "offline", version });
      });
  });

  app.use("/tasks", taskRouter(deps.store, deps.queue));

  app.use((_req: Request, res: Response): void => {
    res.status(404).json({ error: "not-found" });
  });

  // Four-arg handler so Express treats it as an error boundary.
  app.use(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express requires 4 args to route errors here.
    (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
      logger.error({ err }, "unhandled error");
      res.status(500).json({ error: "internal-error" });
    },
  );

  return app;
}

export { version } from "./version.js";

