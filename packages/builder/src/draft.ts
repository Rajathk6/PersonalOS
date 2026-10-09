import type { CapabilityManifest, ModelProvider } from "@personalos/contracts";
import { CapabilityManifestSchema } from "@personalos/contracts";
import { extractJson } from "@personalos/agents";
import { CORE_RUNTIME } from "@personalos/capabilities";

const SYSTEM = `You design PersonalOS capability manifests. Reply with ONLY this JSON, no other words:
{"name":"...","version":"0.1.0","actions":["..."],"entities":["..."],"workflows":[],"tools":[],"permissions":[],"compat":{"runtime":"${CORE_RUNTIME}"}}
Rules: name is lowercase-hyphenated. actions are verb.noun strings. tools lists ONLY tool names from the available list (or empty). permissions lists ONLY permission names from the available list (or empty). workflows is []. compat.runtime is exactly "${CORE_RUNTIME}". JSON only.`;

// Drafting only: the model proposes a DESIGN, never code. Two attempts max —
// a model that cannot emit a valid manifest twice is not argued with further.
export async function draftManifest(
  model: ModelProvider,
  modelId: string,
  description: string,
  availableTools: string[],
  availablePermissions: string[],
): Promise<CapabilityManifest> {
  const attempts = [
    `Domain: ${description}\nAvailable tools: ${availableTools.join(", ") || "(none)"}\nAvailable permissions: ${availablePermissions.join(", ") || "(none)"}`,
    "Your last reply was not a valid manifest. Reply with ONLY the JSON object, no other words.",
  ];
  let lastError = "no attempts";
  for (const user of attempts) {
    const res = await model.generate({
      modelId,
      maxTokens: 250,
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
      return CapabilityManifestSchema.parse(parsed) as CapabilityManifest;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "invalid manifest shape";
    }
  }
  throw new Error(`builder drafting failed: ${lastError}`);
}
