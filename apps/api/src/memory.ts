import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { MemoryStore } from "@personalos/memory";
import { MemoryKindSchema } from "@personalos/memory";

// Platform surface for recallable state. Structured personal facts (money,
// holdings) stay relational in Phase 7 capabilities — memory holds context,
// episodes, and preferences, never the books.
export function memoryRouter(store: MemoryStore): Router {
  const router = Router();

  const RememberBody = z.object({
    kind: MemoryKindSchema,
    key: z.string().min(1).max(200).optional(),
    content: z.unknown(),
    importance: z.number().min(0).max(1).optional(),
    confidence: z.number().min(0).max(1).optional(),
    sourceTaskId: z.string().uuid().optional(),
    expiresAt: z.string().datetime({ offset: true }).optional(),
  });

  router.post("/", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = RememberBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    void store
      .remember(parsed.data)
      .then((record) => res.status(201).json(record))
      .catch(next);
  });

  const SearchQuery = z.object({
    kind: MemoryKindSchema.optional(),
    q: z.string().min(1).max(500).optional(),
    minImportance: z.coerce.number().min(0).max(1).default(0),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  });

  router.get("/search", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = SearchQuery.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    const { kind, q, minImportance, limit } = parsed.data;
    void store
      .recall({
        ...(kind !== undefined ? { kind } : {}),
        ...(q !== undefined ? { query: q } : {}),
        minImportance,
        limit,
      })
      .then((records) => res.json({ memories: records }))
      .catch(next);
  });

  router.delete("/:id", (req: Request, res: Response, next: NextFunction): void => {
    void store
      .forget(req.params.id as string)
      .then(() => res.status(204).end())
      .catch(next);
  });

  return router;
}
