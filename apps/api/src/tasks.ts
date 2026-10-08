import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { PgQueue, TaskRepository } from "@personalos/core";
import { ContractError } from "@personalos/contracts";

const CreateBodySchema = z.object({
  type: z.string().min(1),
  input: z.unknown(),
  capability: z.string().optional(),
  requiredCapabilities: z.array(z.string()).default([]),
  priority: z.number().int().default(0),
  idempotencyKey: z.string().optional(),
  maxRetries: z.number().int().min(0).default(3),
  notBefore: z.string().datetime({ offset: true }).optional(),
});

const ListQuerySchema = z.object({
  state: z.enum(["created", "queued", "running", "done", "failed", "cancelled", "waiting_for_network"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// Express 4 does not catch async errors: every promise chain ends in next()
// so the error middleware (not an unhandled rejection) answers the client.
function contractError(res: Response, err: unknown): boolean {
  if (err instanceof ContractError && err.code === "NOT_FOUND") {
    res.status(404).json({ error: "not-found" });
    return true;
  }
  if (err instanceof ContractError && err.code === "VALIDATION_FAILED") {
    res.status(409).json({ error: "illegal-transition", message: err.message });
    return true;
  }
  return false;
}

// Platform contract (ARCHITECTURE §60): generic task endpoints. Domain
// endpoints (finance, jobs) arrive as capabilities in Phase 7, never here.
export function taskRouter(store: TaskRepository, queue: PgQueue): Router {
  const router = Router();

  router.post("/", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = CreateBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    // exactOptionalPropertyTypes: strip undefined so the Queue contract
    // sees absent keys, not explicit undefined.
    const d = parsed.data;
    void queue
      .enqueue({
        type: d.type,
        input: d.input,
        priority: d.priority,
        maxRetries: d.maxRetries,
        requiredCapabilities: d.requiredCapabilities,
        ...(d.capability !== undefined ? { capability: d.capability } : {}),
        ...(d.idempotencyKey !== undefined ? { idempotencyKey: d.idempotencyKey } : {}),
        ...(d.notBefore !== undefined ? { notBefore: d.notBefore } : {}),
      })
      .then((task) => res.status(201).json(task))
      .catch((err: unknown) => {
        if (!contractError(res, err)) next(err);
      });
  });

  router.get("/", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = ListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { state, limit } = parsed.data;
    void (async (): Promise<void> => {
      const tasks = state !== undefined ? await store.listByState(state) : await store.listRecent(limit);
      res.json({ tasks });
    })().catch(next);
  });

  router.get("/:id", (req: Request, res: Response, next: NextFunction): void => {
    void store
      .get(req.params.id as string)
      .then((task) => res.json(task))
      .catch((err: unknown) => {
        if (!contractError(res, err)) next(err);
      });
  });

  router.post("/:id/cancel", (req: Request, res: Response, next: NextFunction): void => {
    void store
      .transition(req.params.id as string, "cancelled")
      .then((task) => res.json(task))
      .catch((err: unknown) => {
        if (!contractError(res, err)) next(err);
      });
  });

  return router;
}
