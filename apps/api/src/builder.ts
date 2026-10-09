import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import type { CapabilityManifest } from "@personalos/contracts";
import { z } from "zod";
import type { PgQueue, TaskHandler, TaskRepository } from "@personalos/core";
import type { ModelRegistry } from "@personalos/models";
import type { CapabilityRegistry } from "@personalos/capabilities";
import type { ToolRegistry } from "@personalos/tools";
import { KNOWN_PERMISSIONS } from "@personalos/tools";
import { draftManifest, reviewManifest } from "@personalos/builder";
import { sanitizeManifest } from "@personalos/builder";
import { pickModel } from "./agent.js";

export interface BuilderDeps {
  prisma: PrismaClient;
  store: TaskRepository;
  queue: PgQueue;
  models: ModelRegistry;
  defaultModel: string;
  capabilities: CapabilityRegistry;
  tools: ToolRegistry;
}

// Requirement -> design -> review -> approval -> install. The LLM drafts and
// the human approves; deterministic review stands between them so neither a
// confused model nor a hasty tap can install something unsafe. Approved
// designs register with EMPTY handlers/tools — code still gets written by a
// human (or a future codegen phase), never hallucinated into place.
export function builderRouter(deps: BuilderDeps): Router {
  const router = Router();

  router.post("/propose", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = z.object({ description: z.string().min(10).max(2000) }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", message: "description (10-2000 chars) required" });
      return;
    }
    void deps.queue
      .enqueue({ type: "builder.propose", input: { description: parsed.data.description }, priority: 0 })
      .then((task) => res.status(201).json(task))
      .catch(next);
  });

  router.get("/proposals", (_req: Request, res: Response, next: NextFunction): void => {
    void deps.prisma.capabilityProposal
      .findMany({ orderBy: { createdAt: "desc" }, take: 50 })
      .then((rows) => res.json({ proposals: rows }))
      .catch(next);
  });

  router.post("/proposals/:id/approve", (req: Request, res: Response, next: NextFunction): void => {
    void (async (): Promise<void> => {
      const proposal = await deps.prisma.capabilityProposal.findUnique({ where: { id: req.params.id as string } });
      if (proposal === null) {
        res.status(404).json({ error: "not-found" });
        return;
      }
      if (proposal.status !== "reviewed") {
        res.status(409).json({ error: "illegal-transition", message: `proposal is ${proposal.status}, not reviewed` });
        return;
      }
      const review = proposal.review as { passed?: unknown };
      if (review.passed !== true) {
        res.status(409).json({ error: "review-failed", message: "security review did not pass" });
        return;
      }
      const manifest = proposal.manifest as unknown as CapabilityManifest;
      await deps.capabilities.install({ manifest, handlers: new Map(), tools: [] });
      const doc = JSON.parse(JSON.stringify(manifest)) as Prisma.InputJsonValue;
      await deps.prisma.installedCapability.upsert({
        where: { name: manifest.name },
        create: { name: manifest.name, version: manifest.version, manifest: doc, enabled: true },
        update: { version: manifest.version, manifest: doc, enabled: true },
      });
      const updated = await deps.prisma.capabilityProposal.update({
        where: { id: proposal.id },
        data: { status: "installed" },
      });
      res.json(updated);
    })().catch(next);
  });

  return router;
}

export function builderProposeHandler(deps: BuilderDeps): TaskHandler {
  return async (task) => {
    const parsed = z.object({ description: z.string().min(10) }).safeParse(task.input);
    if (!parsed.success) {
      throw Object.assign(new Error("builder.propose needs { description }"), { code: "BUILDER_BAD_INPUT" });
    }
    const picked = pickModel(deps.models, deps.defaultModel);
    const provider = deps.models.get(picked.id).provider;
    const toolList = deps.tools.list();
    const drafted = await draftManifest(
      provider,
      picked.id,
      parsed.data.description,
      toolList.map((t) => t.name),
      KNOWN_PERMISSIONS,
    );
    // Normalize before review: drop what doesn't exist, re-slug bad names.
    // Review still sees everything via warnings — normalization is reported.
    const { manifest, dropped } = sanitizeManifest(
      drafted,
      toolList.map((t) => t.name),
      KNOWN_PERMISSIONS,
      parsed.data.description,
    );
    const review = reviewManifest(manifest, {
      knownTools: toolList.map((t) => ({ name: t.name, risk: t.risk as "Low" | "Medium" | "High" | "Critical" })),
      knownPermissions: KNOWN_PERMISSIONS,
      installedNames: deps.capabilities.list().map((m) => m.name),
    });
    for (const note of dropped) review.findings.push({ level: "warning", message: `normalized: ${note}` });
    const proposal = await deps.prisma.capabilityProposal.create({
      data: {
        description: parsed.data.description,
        manifest: JSON.parse(JSON.stringify(manifest)) as Prisma.InputJsonValue,
        review: JSON.parse(JSON.stringify(review)) as Prisma.InputJsonValue,
        status: review.passed ? "reviewed" : "rejected",
      },
    });
    return { proposalId: proposal.id, passed: review.passed, findings: review.findings.length, model: picked.id };
  };
}
