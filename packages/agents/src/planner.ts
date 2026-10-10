import type { ModelProvider } from "@personalos/contracts";
import { z } from "zod";

const PlannedTaskSchema = z.object({
  type: z.string().min(1),
  input: z.unknown(),
  notBefore: z.string().datetime({ offset: true }).optional(),
});

const PlanSchema = z.object({ tasks: z.array(PlannedTaskSchema).min(1).max(10) });

export type PlannedTask = z.infer<typeof PlannedTaskSchema>;
export interface Plan {
  tasks: PlannedTask[];
}

// Pull the first {...} out of model chatter. Small models narrate despite
// "JSON only" instructions; this keeps planning working without a retry storm.
export function extractJson(text: string): string | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

const SYSTEM = `You turn a personal goal into machine tasks. Reply with ONLY this JSON, no other words:
{"tasks":[{"type":"...","input":{...}}]}
Available types:
- reminder.send needs {"text":"..."} plus optional "at" ISO datetime (for anything with a time: remind, wake, call, pay by date).
- memory.note needs {"text":"..."} (for noting things down, remembering facts/preferences; no time involved).
Rules: pick the type that fits; reminder for timed things, note for timeless ones. Max 5 tasks. JSON only.`;

// Logical role, not a process (spec §4): borrows whatever model the router
// picked. Prompts stay tiny — 3B models are weak narrators and CPU inference
// is ~100s a call, so every wasted token is felt.
export async function plan(
  model: ModelProvider,
  modelId: string,
  goal: string,
): Promise<Plan> {
  const attempts = [
    `Goal: ${goal}`,
    "Your last reply was not valid JSON. Reply with ONLY the JSON object, no other words.",
  ];
  let lastError = "no attempts";
  for (const user of attempts) {
    const res = await model.generate({
      modelId,
      maxTokens: 300,
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    });
    const candidate = extractJson(res.text);
    if (candidate === null) {
      lastError = "no JSON object in reply";
      continue;
    }
    try {
      const parsed: unknown = JSON.parse(candidate);
      return PlanSchema.parse(parsed) as Plan;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "invalid plan shape";
    }
  }
  throw new Error(`planner failed: ${lastError}`);
}
