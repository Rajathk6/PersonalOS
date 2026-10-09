import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ScheduleSpecSchema } from "@personalos/scheduler";

const CreateBodySchema = z.object({
  name: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  taskType: z.string().min(1),
  taskInput: z.unknown(),
  schedule: ScheduleSpecSchema,
  catchupPolicy: z.string().min(1).default("since-last-success"),
});

// Generic job management (platform surface, like /tasks). Domain content lives
// in the job payload's taskType/taskInput, never in these routes.
export function scheduleRouter(prisma: PrismaClient): Router {
  const router = Router();

  router.post("/", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = CreateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const d = parsed.data;
    void prisma.scheduledJob
      .create({
        data: {
          name: d.name,
          kind: d.taskType,
          schedule: JSON.stringify(d.schedule),
          payload: { taskType: d.taskType, taskInput: d.taskInput } as Prisma.InputJsonValue,
          catchupPolicy: d.catchupPolicy,
        },
      })
      .then((job) => res.status(201).json(job))
      .catch((err: unknown) => {
        if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
          res.status(409).json({ error: "duplicate", message: `schedule ${d.name} exists` });
          return;
        }
        next(err);
      });
  });

  router.get("/", (_req: Request, res: Response, next: NextFunction): void => {
    void prisma.scheduledJob
      .findMany({ orderBy: { name: "asc" } })
      .then((jobs) => res.json({ schedules: jobs }))
      .catch(next);
  });

  for (const action of ["enable", "disable"] as const) {
    router.post(`/:name/${action}`, (req: Request, res: Response, next: NextFunction): void => {
      void prisma.scheduledJob
        .update({ where: { name: req.params.name as string }, data: { enabled: action === "enable" } })
        .then((job) => res.json(job))
        .catch((err: unknown) => {
          if (typeof err === "object" && err !== null && "code" in err && err.code === "P2025") {
            res.status(404).json({ error: "not-found" });
            return;
          }
          next(err);
        });
    });
  }

  router.delete("/:name", (req: Request, res: Response, next: NextFunction): void => {
    void prisma.scheduledJob
      .delete({ where: { name: req.params.name as string } })
      .then(() => res.status(204).end())
      .catch((err: unknown) => {
        if (typeof err === "object" && err !== null && "code" in err && err.code === "P2025") {
          res.status(404).json({ error: "not-found" });
          return;
        }
        next(err);
      });
  });

  return router;
}
