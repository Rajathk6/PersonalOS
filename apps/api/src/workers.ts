import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { PgQueue, TaskRepository } from "@personalos/core";

export interface WorkerNetDeps {
  prisma: PrismaClient;
  store: TaskRepository;
  queue: PgQueue;
  tokens: Map<string, string>; // workerId -> token (WORKER_TOKENS env)
}

function authorized(tokens: Map<string, string>, workerId: unknown, token: unknown): boolean {
  if (typeof workerId !== "string" || typeof token !== "string") return false;
  const expected = tokens.get(workerId);
  return expected !== undefined && token === expected;
}

// Multi-node surface (spec §8): registration, heartbeats, and claim/complete/
// fail for workers that CANNOT reach the database directly (the Pi-phone end
// of the topology). Direct-DB workers (same LAN as Postgres) skip HTTP and
// use PgQueue — tokens gate the HTTP path, DB credentials gate the fast path.
export function workerRouter(deps: WorkerNetDeps): Router {
  const router = Router();

  const RegisterBody = z.object({
    workerId: z.string().min(1),
    capabilities: z.array(z.string()).default([]),
    token: z.string().min(1),
  });

  router.post("/register", (req: Request, res: Response): void => {
    const parsed = RegisterBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    if (!authorized(deps.tokens, parsed.data.workerId, parsed.data.token)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    const { workerId, capabilities } = parsed.data;
    void deps.prisma.worker
      .upsert({
        where: { id: workerId },
        create: { id: workerId, capabilities, status: "online" },
        update: { capabilities, status: "online", lastHeartbeat: new Date() },
      })
      .then((w) => res.json({ id: w.id, capabilities: w.capabilities, status: w.status }));
  });

  router.post("/:id/heartbeat", (req: Request, res: Response): void => {
    const id = req.params.id as string;
    if (!authorized(deps.tokens, id, (req.body as { token?: unknown })?.token)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    void deps.prisma.worker
      .update({ where: { id }, data: { lastHeartbeat: new Date(), status: "online" } })
      .then(() => res.json({ ok: true }))
      .catch(() => res.status(404).json({ error: "not-registered" }));
  });

  router.get("/", (_req: Request, res: Response, next: NextFunction): void => {
    void deps.prisma.worker
      .findMany({ orderBy: { id: "asc" } })
      .then((workers) => res.json({ workers }))
      .catch(next);
  });

  const ClaimBody = z.object({
    workerId: z.string().min(1),
    capabilities: z.array(z.string()).default([]),
    token: z.string().min(1),
  });

  router.post("/tasks/claim", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = ClaimBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    if (!authorized(deps.tokens, parsed.data.workerId, parsed.data.token)) {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    void deps.queue
      .dequeue({ id: parsed.data.workerId, capabilities: parsed.data.capabilities, auth: "http-worker" })
      .then((task) => (task === null ? res.status(204).end() : res.json(task)))
      .catch(next);
  });

  const FinishBody = z.object({
    workerId: z.string().min(1),
    token: z.string().min(1),
    output: z.unknown().optional(),
    code: z.string().optional(),
    message: z.string().optional(),
  });

  // Lease check: only the lease holder may finish a task. Anyone else gets a
  // 409, and the task stays exactly where it was.
  async function holderOr409(taskId: string, workerId: string, token: string, res: Response): Promise<boolean> {
    if (!authorized(deps.tokens, workerId, token)) {
      res.status(403).json({ error: "forbidden" });
      return false;
    }
    const task = await deps.store.get(taskId).catch(() => null);
    if (task === null || task.state !== "running" || task.lease?.workerId !== workerId) {
      res.status(409).json({ error: "not-lease-holder" });
      return false;
    }
    return true;
  }

  router.post("/tasks/:id/complete", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = FinishBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    const id = req.params.id as string;
    void (async (): Promise<void> => {
      if (!(await holderOr409(id, parsed.data.workerId, parsed.data.token, res))) return;
      await deps.queue.complete(id, parsed.data.output);
      res.json({ ok: true });
    })().catch(next);
  });

  router.post("/tasks/:id/fail", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = FinishBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    const id = req.params.id as string;
    void (async (): Promise<void> => {
      if (!(await holderOr409(id, parsed.data.workerId, parsed.data.token, res))) return;
      await deps.queue.fail(id, {
        code: parsed.data.code ?? "WORKER_ERROR",
        retryable: true,
        message: parsed.data.message ?? "worker reported failure",
      });
      res.json({ ok: true });
    })().catch(next);
  });

  return router;
}
