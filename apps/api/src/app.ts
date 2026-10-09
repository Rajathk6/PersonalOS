import type { Express, Router } from "express";
import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
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
  schedulerStatus: () => "ready" | "disabled";
  modelIds: () => string[];
  tools: () => { name: string; version: string; description: string; risk: string }[];
  agent: Router;
  schedules: Router;
  memory: Router;
  finance: Router;
  jobs: Router;
  workers: Router;
  toolRun: Router;
  approvals: Router;
}

// App factory (not a singleton): production and tests each build their own
// instance with injected deps. Nothing here owns startup or intervals.
export function createApp(deps: AppDeps): Express {
  const app = express();
  app.use(express.json({ limit: "100kb" }));

  // Phone dashboard is a single secret-free page (the token lives in the
  // phone's localStorage; every API call still carries it). Resolves from
  // either the workspace cwd (tsx dev) or the repo root (built dist).
  const candidates = [path.resolve("apps/api/public"), path.resolve("public")];
  const page = candidates
    .map((d) => path.join(d, "dashboard.html"))
    .find((f) => existsSync(f));
  if (page !== undefined) {
    app.get("/dashboard", (_req: Request, res: Response): void => {
      res.sendFile(page);
    });
  }

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
          scheduler: deps.schedulerStatus(),
          models: deps.modelIds(),
          version,
        });
      })
      .catch(() => {
        res.status(503).json({ status: "degraded", db: "offline", version });
      });
  });

  app.use("/tasks", taskRouter(deps.store, deps.queue));
  app.use("/agent", deps.agent);  app.use("/schedules", deps.schedules);
  app.use("/memory", deps.memory);
  app.use("/finance", deps.finance);
  app.use("/jobs", deps.jobs);
  app.use("/workers", deps.workers);
  app.use("/tools", deps.toolRun);
  app.use("/approvals", deps.approvals);

  // Visibility only: which tools exist and their risk. Execution stays behind
  // the executor (Phase 4); there is deliberately no POST /tools/:name yet.
  app.get("/tools", (_req: Request, res: Response): void => {
    res.json({ tools: deps.tools() });
  });

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

