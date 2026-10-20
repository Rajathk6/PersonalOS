import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type { MemoryStore } from "@personalos/memory";
import type { NotificationStore } from "@personalos/jobs";
import type { WatchStore } from "@personalos/watches";
import { loadProfile } from "./jobs-alerts.js";

export interface AlertFeedDeps {
  prisma: PrismaClient;
  notifications: NotificationStore;
  memory: MemoryStore;
  watches: WatchStore;
}

// ONE feed for everything the user asked to be kept posted on: generic
// watches AND the job-alert pipeline. Same shape, same source of truth
// (whatever the user set up), no per-feature area.
export function alertFeedRouter(deps: AlertFeedDeps): Router {
  const router = Router();

  router.get("/", (req: Request, res: Response, next: NextFunction): void => {
    const minScoreRaw = req.query["minScore"];
    const limitRaw = req.query["limit"];
    const minScore = minScoreRaw === undefined ? 0 : Number(minScoreRaw);
    const limit = limitRaw === undefined ? 20 : Number(limitRaw);
    void (async (): Promise<void> => {
      const profile = await loadProfile(deps.memory);
      const [watchItems, jobRows] = await Promise.all([
        deps.watches.unalerted(limit),
        deps.notifications.list({ minScore, limit }),
      ]);
      const feed = [
        ...watchItems.map((w) => ({
          kind: "watch" as const,
          itemId: w.id,
          title: w.title,
          source: w.watchName,
          sourceUrl: w.url,
          applyUrl: null,
          eligibility: "watch",
          score: null,
          reasons: [] as string[],
          foundAt: w.foundAt,
        })),
        ...jobRows.map((n) => ({
          kind: "job" as const,
          itemId: null,
          title: n.title,
          source: n.sourceOrg,
          sourceUrl: n.sourceUrl,
          applyUrl: n.applyUrl,
          eligibility: n.eligibility,
          score: n.matchScore,
          reasons: n.matchReasons,
          foundAt: n.createdAt,
        })),
      ]
        .sort((a, b) => (a.foundAt < b.foundAt ? 1 : -1))
        .slice(0, limit);
      res.json({ profile: { field: profile.field }, notifications: feed });
    })().catch(next);
  });

  return router;
}
