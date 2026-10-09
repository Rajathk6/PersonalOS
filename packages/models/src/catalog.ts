import type { ModelMetadata } from "@personalos/contracts";

// Known-good local models for this hardware (i7/12GB, no GPU). Metadata only —
// downloading and serving is the operator's job (see Phase 2 notes), so this
// file never triggers downloads or spawns processes.
export const qwen25_3b: ModelMetadata = {
  id: "qwen2.5:3b",
  provider: "ollama",
  contextTokens: 32768,
  modalities: ["text"],
  toolCalling: false,
  structuredOutput: false,
  reasoning: false,
  latencyClass: "local-cpu",
  costClass: "free",
  availability: "local",
  hwReqs: "12GB RAM, CPU-only OK (~2GB resident)",
};
