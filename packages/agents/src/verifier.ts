import type { ModelProvider } from "@personalos/contracts";
import { z } from "zod";
import { extractJson } from "./planner.js";

const VerdictSchema = z.object({ ok: z.boolean(), reason: z.string().min(1).max(500) });

export interface Verification {
  ok: boolean;
  reason: string;
}

const SYSTEM = `You check whether a finished task achieved its goal. Reply with ONLY this JSON, no other words:
{"ok":true,"reason":"..."}
Rules: ok=true only if the result clearly satisfies the goal. reason is one short sentence. JSON only.`;

// Second pair of eyes (spec §4): never executes anything, only judges output.
// Same frugality as the planner — one call, one retry, tiny prompts.
export async function verify(
  model: ModelProvider,
  modelId: string,
  goal: string,
  result: unknown,
): Promise<Verification> {
  const attempts = [
    `Goal: ${goal}\nResult: ${JSON.stringify(result).slice(0, 2000)}`,
    "Your last reply was not valid JSON. Reply with ONLY the JSON object, no other words.",
  ];
  let lastError = "no attempts";
  for (const user of attempts) {
    const res = await model.generate({
      modelId,
      maxTokens: 200,
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
      return VerdictSchema.parse(parsed) as Verification;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "invalid verdict shape";
    }
  }
  throw new Error(`verifier failed: ${lastError}`);
}
