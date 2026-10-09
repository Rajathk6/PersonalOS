import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import type {
  BenchmarkStore,
  ModelRegistry,
  OllamaProvider,
  OpenRouterProvider,
} from "@personalos/models";
import { discoverOllama, discoverOpenRouter, recommend, runBenchmark } from "@personalos/models";

export interface ModelNetDeps {
  prisma: PrismaClient;
  models: ModelRegistry;
  benchmarks: BenchmarkStore;
  ollama: OllamaProvider;
  openrouter: OpenRouterProvider | null;
  ollamaUrl: string;
  openRouterUrl: string;
  openRouterKey: string | null;
}

// Model ecosystem surface (Phase 10): list, discover, benchmark, recommend.
// Nothing here switches models — adoption stays a human config change
// (DEFAULT_MODEL), exactly as the spec demands.
export function modelRouter(deps: ModelNetDeps): Router {
  const router = Router();

  router.get("/", (_req: Request, res: Response): void => {
    res.json({ models: deps.models.list() });
  });

  router.post("/discover", (_req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      const found = await discoverOllama(deps.ollamaUrl);
      let open: Awaited<ReturnType<typeof discoverOpenRouter>> = [];
      if (deps.openRouterKey !== null) {
        open = await discoverOpenRouter(deps.openRouterUrl, deps.openRouterKey);
      }
      const added: string[] = [];
      const already: string[] = [];
      for (const meta of [...found, ...open]) {
        try {
          deps.models.get(meta.id);
          already.push(meta.id);
        } catch {
          const provider = meta.provider === "openrouter" && deps.openrouter
            ? deps.openrouter
            : deps.ollama;
          deps.models.register({ metadata: meta, provider });
          added.push(meta.id);
        }
      }
      res.json({ added, already });
    })().catch(next);
  });

  router.post("/:id/benchmark", (req: Request, res: Response, next: NextFunction): void => {
    const id = req.params.id as string;
    void (async (): Promise<void> => {
      let entry;
      try {
        entry = deps.models.get(id);
      } catch {
        res.status(404).json({ error: "not-found" });
        return;
      }
      const report = await runBenchmark(entry.provider, id);
      await deps.benchmarks.save(report);
      res.json(report);
    })().catch(next);
  });

  router.get("/recommendations", (_req: Request, res: Response, next: NextFunction): void => {
    void deps.benchmarks
      .latest()
      .then((benchmarks) => res.json({ recommendations: recommend(deps.models.list(), benchmarks) }))
      .catch(next);
  });

  return router;
}
