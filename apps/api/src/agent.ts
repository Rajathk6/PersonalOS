import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import { z } from "zod";
import type { PgQueue, TaskHandler, TaskRepository } from "@personalos/core";
import type { ModelProvider } from "@personalos/contracts";
import type { ModelRegistry } from "@personalos/models";
import { route } from "@personalos/models";
import type { MemoryStore } from "@personalos/memory";
import { plan, verify } from "@personalos/agents";

export interface AgentDeps {
  store: TaskRepository;
  queue: PgQueue;
  models: ModelRegistry;
  defaultModel: string;
  memory: MemoryStore;
}

const RunBodySchema = z.object({ goal: z.string().min(1).max(2000) });
const VerifyBodySchema = z.object({ taskId: z.string().min(1), goal: z.string().min(1).max(2000) });
const AgentRunInput = z.object({ goal: z.string().min(1) });
const AgentVerifyInput = z.object({ taskId: z.string().min(1), goal: z.string().min(1) });

// Everything is a task: /agent/run and /agent/verify only enqueue. The LLM
// work happens inside worker handlers, never in the request path (a generation
// takes ~100s on CPU — requests must stay fast).
export function agentRouter(deps: AgentDeps): Router {
  const router = Router();

  router.post("/run", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = RunBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    void deps.queue
      .enqueue({ type: "agent.run", input: { goal: parsed.data.goal }, priority: 0 })
      .then((task) => res.status(201).json(task))
      .catch(next);
  });

  router.post("/verify", (req: Request, res: Response, next: NextFunction): void => {
    const parsed = VerifyBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "invalid", details: parsed.error.flatten().fieldErrors });
      return;
    }
    void deps.queue
      .enqueue({ type: "agent.verify", input: { taskId: parsed.data.taskId, goal: parsed.data.goal }, priority: 0 })
      .then((task) => res.status(201).json(task))
      .catch(next);
  });

  return router;
}

export function pickModel(models: ModelRegistry, defaultModel: string): { id: string; provider: ModelProvider } {
  // Router picks by hints; the configured default wins ties (local-first
  // privacy out of the box, override via config with no code change).
  const ordered = [...models.list()].sort((a, b) =>
    a.id === defaultModel ? -1 : b.id === defaultModel ? 1 : 0,
  );
  const meta = route(ordered, { privacySensitive: true });
  return { id: meta.id, provider: models.get(meta.id).provider };
}

// Planner role: goal -> child tasks. Creates real queued tasks and returns
// their ids; the worker loop (not the planner) runs them.
export function agentRunHandler(deps: AgentDeps): TaskHandler {
  return async (task) => {
    const parsed = AgentRunInput.safeParse(task.input);
    if (!parsed.success) {
      throw Object.assign(new Error("agent.run needs { goal }"), { code: "AGENT_BAD_INPUT" });
    }
    const picked = pickModel(deps.models, deps.defaultModel);
    const provider = deps.models.get(picked.id).provider;
    const planned = await plan(provider, picked.id, parsed.data.goal);
    const childIds: string[] = [];
    for (const child of planned.tasks) {
      const created = await deps.queue.enqueue({
        type: child.type,
        input: child.input ?? {},
        priority: 0,
        ...(child.notBefore !== undefined ? { notBefore: child.notBefore } : {}),
      });
      childIds.push(created.id);
    }
    // Task memory: the plan outlives the run, so a future planner (or the
    // user asking "what did you do?") can retrieve it without LLM archaeology.
    await deps.memory.remember({
      kind: "task",
      key: `agentrun-${task.id}`,
      content: { goal: parsed.data.goal, model: picked.id, childIds },
      importance: 0.6,
      sourceTaskId: task.id,
    });
    return { goal: parsed.data.goal, model: picked.id, planned: planned.tasks.length, childIds };
  };
}

// Verifier role: judges a finished task's output against the goal. Only runs
// on done tasks; anything else is a retryable early wake (Phase 5 will add
// proper wait-for-dependency instead of burning retries).
export function agentVerifyHandler(deps: AgentDeps): TaskHandler {
  return async (task) => {
    const parsed = AgentVerifyInput.safeParse(task.input);
    if (!parsed.success) {
      throw Object.assign(new Error("agent.verify needs { taskId, goal }"), { code: "AGENT_BAD_INPUT" });
    }
    const target = await deps.store.get(parsed.data.taskId);
    if (target.state !== "done") {
      throw Object.assign(new Error(`target ${target.id} is ${target.state}, not done`), {
        code: "VERIFY_EARLY",
      });
    }
    const picked = pickModel(deps.models, deps.defaultModel);
    const provider = deps.models.get(picked.id).provider;
    const verdict = await verify(provider, picked.id, parsed.data.goal, target.output);
    // Episodic memory: what happened and whether it worked — the raw material
    // for adaptation (Phase 11+) instead of repeated mistakes.
    await deps.memory.remember({
      kind: "episodic",
      content: { goal: parsed.data.goal, taskId: target.id, ok: verdict.ok, reason: verdict.reason },
      importance: verdict.ok ? 0.4 : 0.8,
      sourceTaskId: task.id,
    });
    return { taskId: target.id, model: picked.id, ...verdict };
  };
}
