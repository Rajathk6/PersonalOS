import { z } from "zod";
import type { Task } from "@personalos/contracts";
import type { PgQueue, TaskHandler, TaskRepository } from "@personalos/core";
import type { ModelRegistry } from "@personalos/models";
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
}

export function defaultHandlers(deps: HandlerDeps): Map<string, TaskHandler> {
  const agentDeps = { store: deps.store, queue: deps.queue, models: deps.models, defaultModel: deps.defaultModel };
  return new Map([
    ["reminder.send", reminderSend],
    ["agent.run", agentRunHandler(agentDeps)],
    ["agent.verify", agentVerifyHandler(agentDeps)],
  ]);
}
