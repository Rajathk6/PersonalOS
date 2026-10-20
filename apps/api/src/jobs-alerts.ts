import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import type { MemoryStore } from "@personalos/memory";
import {
  OFFICIAL_SOURCES,
  harvestAll,
  matchEligibility,
  sourceById,
} from "@personalos/jobs";
import type {
  HarvestedItem,
  NotificationStore,
  UserProfile,
} from "@personalos/jobs";

export interface JobsAlertDeps {
  prisma: PrismaClient;
  notifications: NotificationStore;
  memory: MemoryStore;
  // Where harvested items are pushed from an always-on device (the
  // middleman phone) — same contract, different source of the fetch.
  onNewNotifications?: (items: { title: string; url: string; sourceOrg: string }[]) => Promise<void>;
}

const PROFILE_KEY = "job-profile";

const ProfileSchema = z.object({
  field: z.string().min(1).default("engineering"),
  qualifications: z.array(z.string()).default(["b.tech", "b.e."]),
  graduationYears: z.array(z.number().int()).optional(),
  ageLimit: z.object({ min: z.number().optional(), max: z.number().optional() }).optional(),
  categories: z.array(z.string()).default([]),
  states: z.array(z.string()).default([]),
  extraKeywords: z.array(z.string()).default([]),
  excludedKeywords: z.array(z.string()).default([]),
});

// Zod's inferred type carries explicit undefined on optional keys, which
// exactOptionalPropertyTypes rejects — omit absent keys instead.
function toProfile(data: z.infer<typeof ProfileSchema>): UserProfile {
  return {
    field: data.field,
    qualifications: data.qualifications,
    categories: data.categories,
    states: data.states,
    extraKeywords: data.extraKeywords,
    excludedKeywords: data.excludedKeywords,
    ...(data.graduationYears !== undefined ? { graduationYears: data.graduationYears } : {}),
    ...(data.ageLimit !== undefined ? { ageLimit: data.ageLimit } : {}),
  };
}

// The profile lives in MEMORY (it is a fact about the user, not a
// transaction) — one keyed record, upserted.
export async function loadProfile(memory: MemoryStore): Promise<UserProfile> {
  const rec = await memory.recall({ kind: "user", limit: 50 });
  const found = rec.find((r) => r.key === PROFILE_KEY);
  if (found === undefined) {
    return ProfileSchema.parse({});
  }
  const content = found.content as { profile?: unknown };
  return toProfile(ProfileSchema.parse(content.profile ?? {}));
}

export function jobsAlertRouter(deps: JobsAlertDeps): Router {
  const router = Router();

  // Sources we know about, and whether the last harvest could reach them.
  router.get("/sources", (_req: Request, res: Response): void => {
    res.json({
      sources: OFFICIAL_SOURCES.map((s) => ({
        id: s.id, org: s.org, name: s.name, homepage: s.homepage,
        listingUrl: s.listingUrl, kind: s.kind, domains: s.domains, note: s.note,
      })),
    });
  });

  router.get("/profile", (_req: Request, res: Response, next: NextFunction): void => {
    void loadProfile(deps.memory)
      .then((p) => res.json({ profile: p }))
      .catch(next);
  });

  router.post("/profile", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = ProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    void deps.memory
      .remember({
        kind: "user",
        key: PROFILE_KEY,
        content: { profile: parsed.data },
        importance: 0.95,
      })
      .then((r) => res.json({ profile: toProfile(parsed.data), memoryId: r.id }))
      .catch(next);
  });

  // Run a harvest right now (laptop or the always-on device). Per-source
  // failures are reported, never fatal: one blocked site must not stop the
  // rest of the pipeline.
  router.post("/harvest", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = z.object({
      sourceIds: z.array(z.string()).optional(),
      skipApplyLookup: z.boolean().default(false),
    }).safeParse(req.body ?? {});
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    void (async (): Promise<void> => {
      const wanted = parsed.data.sourceIds !== undefined
        ? parsed.data.sourceIds.map((id) => sourceById(id)).filter((s) => s !== undefined)
        : OFFICIAL_SOURCES;
      const results = await harvestAll(wanted, { skipApplyLookup: parsed.data.skipApplyLookup });
      const profile = await loadProfile(deps.memory);
      const all: HarvestedItem[] = [];
      for (const r of results) all.push(...r.items);
      const { inserted, duplicates } = await deps.notifications.ingest(
        all,
        (item) => matchEligibility(profile, item.title, item.summary),
        "laptop",
      );
      if (inserted.length > 0) {
        await deps.onNewNotifications?.(inserted.map((n) => ({ title: n.title, url: n.applyUrl ?? n.sourceUrl, sourceOrg: n.sourceOrg })));
      }
      res.json({
        sources: results.map((r) => ({ id: r.sourceId, ok: r.ok, items: r.items.length, error: r.error })),
        inserted: inserted.length,
        duplicates,
      });
    })().catch(next);
  });

  // Intake for the always-on device: it harvested on its own network and
  // hands the items over. Same dedup, same matching, one contract.
  router.post("/intake", (req: Request, res: Response, next: NextFunction): void => {    const parsed = z.object({
      harvestedBy: z.string().min(1).default("middleman"),
      items: z.array(z.object({
        sourceOrg: z.string().min(1),
        sourceId: z.string().min(1).default("unknown"),
        title: z.string().min(1),
        url: z.string().url(),
        summary: z.string().nullable().default(null),
        publishedAt: z.string().nullable().default(null),
        applyUrl: z.string().nullable().default(null),
        contentHash: z.string().min(8),
      })).max(200),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    void (async (): Promise<void> => {
      const profile = await loadProfile(deps.memory);
      const { inserted, duplicates } = await deps.notifications.ingest(
        parsed.data.items as HarvestedItem[],
        (item) => matchEligibility(profile, item.title, item.summary),
        parsed.data.harvestedBy,
      );
      if (inserted.length > 0) {
        await deps.onNewNotifications?.(inserted.map((n) => ({ title: n.title, url: n.applyUrl ?? n.sourceUrl, sourceOrg: n.sourceOrg })));
      }
      res.json({ inserted: inserted.length, duplicates });
    })().catch(next);
  });

  router.get("/notifications", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = z.object({
      minScore: z.coerce.number().min(0).max(100).default(0),
      limit: z.coerce.number().int().min(1).max(100).default(30),
    }).safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    void deps.notifications
      .list({ minScore: parsed.data.minScore, limit: parsed.data.limit })
      .then((rows) => res.json({ notifications: rows }))
      .catch(next);
  });

  return router;
}
