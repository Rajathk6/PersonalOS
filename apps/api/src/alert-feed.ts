import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { MemoryStore } from "@personalos/memory";
import type { NotificationStore } from "@personalos/jobs";
import { loadProfile } from "./jobs-alerts.js";

export interface AlertFeedDeps {
  prisma: PrismaClient;
  notifications: NotificationStore;
  memory: MemoryStore;
}

// The user's alert feed: what we found, why we think it fits, and the
// OFFICIAL link. Only matching items surface by default; the official source
// and the apply link are always shown, because a job alert without a real
// application link is just noise.
export function alertFeedRouter(deps: AlertFeedDeps): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response, next: NextFunction): void => {
    const minScoreRaw = req.query["minScore"];
    const limitRaw = req.query["limit"];
    const minScore = minScoreRaw === undefined ? 20 : Number(minScoreRaw);
    const limit = limitRaw === undefined ? 20 : Number(limitRaw);
    void (async (): Promise<void> => {
      const profile = await loadProfile(deps.memory);
      const rows = await deps.notifications.list({ minScore, limit });
      res.json({
        profile: { field: profile.field, qualifications: profile.qualifications },
        notifications: rows.map((n) => ({
          title: n.title,
          sourceOrg: n.sourceOrg,
          sourceUrl: n.sourceUrl,
          applyUrl: n.applyUrl,
          eligibility: n.eligibility,
          score: n.matchScore,
          reasons: n.matchReasons,
          foundAt: n.createdAt,
        })),
      });
    })().catch(next);
  });

  return router;
}
