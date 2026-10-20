import { z } from "zod";
import type { Task } from "@personalos/contracts";
import type { PgQueue, TaskHandler, TaskRepository } from "@personalos/core";
import type { MemoryStore } from "@personalos/memory";
import type { ModelRegistry } from "@personalos/models";
import type { ToolExecutor, ToolRegistry } from "@personalos/tools";
import { agentRunHandler, agentVerifyHandler } from "./agent.js";
import { logger } from "./logger.js";

const ReminderInputSchema = z.object({
  text: z.string().min(1),
  at: z.string().datetime({ offset: true }).optional(),
});

// Phase 1 demo handler (ROADMAP: reminders). Delivery channel is the process
// log for now — real notification providers (push/email/desktop) arrive as
// permission-gated tools in Phase 3+, so this handler never pretends to ping
// a phone. Output shape is the contract Phase 3 will keep.
export const reminderSend: TaskHandler = async (task: Task): Promise<unknown> => {
  const parsed = ReminderInputSchema.safeParse(task.input);
  if (!parsed.success) {
    throw Object.assign(new Error("reminder input invalid: text (string) required"), {
      code: "REMINDER_INVALID",
    });
  }
  const deliveredAt = new Date().toISOString();
  logger.info({ text: parsed.data.text, at: parsed.data.at }, "reminder delivered");
  return { deliveredAt, text: parsed.data.text, channel: "log" };
};

export interface HandlerDeps {
  store: TaskRepository;
  queue: PgQueue;
  models: ModelRegistry;
  defaultModel: string;
  memory: MemoryStore;
  tools: ToolRegistry;
  executor: ToolExecutor;
}

export function defaultHandlers(deps: HandlerDeps): Map<string, TaskHandler> {
  const agentDeps = { store: deps.store, queue: deps.queue, models: deps.models, defaultModel: deps.defaultModel, memory: deps.memory, tools: deps.tools, executor: deps.executor };
  return new Map([
    ["reminder.send", reminderSend],
    ["memory.note", memoryNoteHandler(deps.memory)],
    ["agent.run", agentRunHandler(agentDeps)],
    ["agent.verify", agentVerifyHandler(agentDeps)],
  ]);
}

// The planner's second verb: "note X down" becomes a stored memory without
// any LLM in the loop at execution time (the planning call already happened).
function memoryNoteHandler(memory: HandlerDeps["memory"]): TaskHandler {
  return async (task: Task): Promise<unknown> => {
    const parsed = z
      .object({
        text: z.string().min(1),
        kind: z.enum(["user", "episodic", "semantic", "task"]).default("episodic"),
        key: z.string().min(1).max(200).optional(),
        importance: z.number().min(0).max(1).default(0.6),
      })
      .safeParse(task.input);
    if (!parsed.success) {
      throw Object.assign(new Error("memory.note needs { text }"), { code: "NOTE_BAD_INPUT" });
    }
    const record = await memory.remember({
      kind: parsed.data.kind,
      ...(parsed.data.key !== undefined ? { key: parsed.data.key } : {}),
      content: { text: parsed.data.text },
      importance: parsed.data.importance,
      sourceTaskId: task.id,
    });
    return { memoryId: record.id, text: parsed.data.text };
  };
}
