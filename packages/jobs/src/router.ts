import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { PgQueue } from "@personalos/core";
import type { JobsStore } from "./store.js";

const WatchBody = z.object({
  name: z.string().min(1).max(100),
  keywords: z.array(z.string().min(1)).min(1).max(20),
  sources: z.array(z.string().url()).min(1).max(10),
});

// Domain routes for the jobs vertical: watches in, findings out, checks run
// as tasks (so they survive restarts and appear in audit like everything else).
export function jobsRouter(store: JobsStore, queue: PgQueue): Router {
  const router = Router();

  router.post("/watches", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = WatchBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    void store
      .createWatch(parsed.data)
      .then((w) => res.status(201).json(w))
      .catch((err: unknown) => {
        if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
          res.status(409).json({ error: "duplicate", message: "watch exists" });
          return;
        }
        next(err);
      });
  });

  router.get("/watches", (_req: Request, res: Response, next: NextFunction): void => {
    void store.listWatches().then((w) => res.json({ watches: w })).catch(next);
  });

  router.get("/findings", (req: Request, res: Response, next: NextFunction): void => {
    const watchId = typeof req.query["watchId"] === "string" ? req.query["watchId"] : undefined;
    void store.listFindings(watchId).then((f) => res.json({ findings: f })).catch(next);
  });

  router.post("/check-now", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = z.object({ watchId: z.string().uuid().optional() }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    void queue
      .enqueue({ type: "jobs.check_now", input: parsed.data, priority: 0 })
      .then((task) => res.status(201).json(task))
      .catch(next);
  });

  return router;
}
