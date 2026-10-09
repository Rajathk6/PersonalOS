import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ApprovalStore } from "@personalos/core";
import type { ToolExecutor } from "@personalos/tools";

export function approvalRouter(store: ApprovalStore, executor: ToolExecutor): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response, next: NextFunction): void => {
    const status = req.query["status"];
    void (async (): Promise<void> => {
      if (status !== undefined && status !== "pending") {
        res.status(400).json({ error: "invalid", message: "only status=pending is listed for now" });
        return;
      }
      res.json({ approvals: await store.listPending() });
    })().catch(next);
  });

  const ResolveBody = z.object({ by: z.string().min(1).max(100).default("user") });

  for (const action of ["approve", "deny"] as const) {
    router.post(`/:id/${action}`, (req: Request, res: Response, next: NextFunction): void => {
      const parsed = ResolveBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: "invalid" });
        return;
      }
      void executor
        .resolveApproval(req.params.id as string, action === "approve", parsed.data.by)
        .then((result) => {
          if (result.error_code === "ALREADY_RESOLVED") {
            res.status(409).json(result);
            return;
          }
          res.json(result);
        })
        .catch(next);
    });
  }

  return router;
}
