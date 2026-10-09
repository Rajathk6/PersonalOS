import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ToolExecutor } from "@personalos/tools";

// Direct tool invocation for the user (dashboard/phone/CLI). Workers and
// handlers call the executor in-process; this is the same gate over HTTP.
// Confirm-gated tools return 202 with an approvalId instead of executing.
export function toolRunRouter(executor: ToolExecutor): Router {
  const router = Router();

  const RunBody = z.object({ input: z.unknown().optional(), taskId: z.string().uuid().optional() });

  router.post("/:name/run", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = RunBody.safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    const name = req.params.name as string;
    void executor
      .execute(name, parsed.data.input, "user", {
        ...(parsed.data.taskId !== undefined ? { taskId: parsed.data.taskId } : {}),
      })
      .then((result) => {
        if (result.success) {
          res.json(result);
          return;
        }
        if (result.error_code === "CONFIRMATION_REQUIRED") {
          res.status(202).json(result);
          return;
        }
        if (result.error_code === "DENIED") {
          res.status(403).json(result);
          return;
        }
        res.status(400).json(result);
      })
      .catch(next);
  });

  return router;
}
