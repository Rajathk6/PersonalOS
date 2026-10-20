import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { WatchStore } from "@personalos/watches";
import { checkWatchTargets, candidateHash } from "@personalos/watches";

// Managing YOUR watches: created from chat, but editable here too — they
// belong to you, not to a feature area. Change or drop any time.
export function watchesRouter(store: WatchStore): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response, next: NextFunction): void => {
    void store.list().then((w) => res.json({ watches: w })).catch(next);
  });

  router.post("/", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = z.object({
      name: z.string().min(1).max(120),
      targets: z.array(z.string().url()).min(1).max(10),
      terms: z.array(z.string().min(1)).max(30).default([]),
      intervalMinutes: z.number().int().min(0).max(10080).default(0),
      allowedDomains: z.array(z.string().min(1)).max(10).default([]),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    void store.create(parsed.data).then((w) => res.status(201).json(w)).catch(next);
  });

  router.get("/:id/items", (req: Request, res: Response, next: NextFunction): void => {
    void store
      .items(req.params.id as string, 100)
      .then((items) => res.json({ items }))
      .catch(next);
  });

  router.patch("/:id", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = z.object({
      name: z.string().min(1).max(120).optional(),
      targets: z.array(z.string().url()).min(1).max(10).optional(),
      terms: z.array(z.string().min(1)).max(30).optional(),
      intervalMinutes: z.number().int().min(0).max(10080).optional(),
      allowedDomains: z.array(z.string().min(1)).max(10).optional(),
      enabled: z.boolean().optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid" });
      return;
    }
    void store
      .update(req.params.id as string, parsed.data)
      .then((w) => (w === null ? res.status(404).json({ error: "not-found" }) : res.json(w)))
      .catch(next);
  });

  router.delete("/:id", (req: Request, res: Response, next: NextFunction): void => {
    void store
      .remove(req.params.id as string)
      .then((ok) => (ok ? res.status(204).end() : res.status(404).json({ error: "not-found" })))
      .catch(next);
  });

  // Manual check: "check my watches now".
  router.post("/:id/check", (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      const w = await store.get(req.params.id as string);
      if (w === null) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const { candidates, errors } = await checkWatchTargets(w.targets, w.terms, w.allowedDomains);
      const items = await store.addItems(
        w.id,
        candidates.map((c) => ({ contentHash: candidateHash(c), title: c.title, url: c.url, summary: c.summary })),
      );
      await store.markChecked(w.id);
      res.json({ newItems: items.length, errors });
    })().catch(next);
  });

  return router;
}
