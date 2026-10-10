import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { ToolExecutor } from "@personalos/tools";
import type { FinanceStore } from "./store.js";
import { formatINR } from "./store.js";

// Domain routes for the finance vertical. Generic platform routes (/tasks,
// /memory, /schedules) stay untouched — this router is capability-owned.
export function financeRouter(store: FinanceStore, executor: ToolExecutor): Router {
  const router = Router();

  router.get("/accounts", (_req: Request, res: Response, next: NextFunction): void => {
    void store
      .summary()
      .then((s) => res.json({ accounts: s.accounts.map((a) => a.account) }))
      .catch(next);
  });

  router.post("/accounts", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = z.object({ name: z.string().min(1), type: z.string().default("cash") }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    void store
      .createAccount(parsed.data.name, parsed.data.type)
      .then((a) => res.status(201).json(a))
      .catch((err: unknown) => {
        if (typeof err === "object" && err !== null && "code" in err && err.code === "P2002") {
          res.status(409).json({ error: "duplicate", message: "account exists" });
          return;
        }
        next(err);
      });
  });

  // Writes go through the executor (permission + audit), never straight to
  // the store — the route handler must not bypass the wall it advertises.
  for (const [path, tool] of [["/expenses", "finance.record_expense"], ["/income", "finance.record_income"]] as const) {
    router.post(path, (req: Request, res: Response, next: NextFunction): void => {
      void executor
        .execute(tool, req.body, "user")
        .then((result) => {
          if (!result.success) {
            res.status(result.error_code === "CONFIRMATION_REQUIRED" ? 202 : 400).json(result);
            return;
          }
          res.status(201).json(result);
        })
        .catch(next);
    });
  }

  router.get("/summary", (_req: Request, res: Response, next: NextFunction): void => {
    void store
      .summary()
      .then((s) => res.json({
        ...s,
        netWorth: formatINR(s.netWorthPaise),
        monthSpend: formatINR(s.monthSpendPaise),
      }))
      .catch(next);
  });

  return router;
}
