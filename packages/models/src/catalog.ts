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

// The low-RAM twin. A 3B model needs ~2.6GB just to load; on a 12GB laptop
// that also runs a browser, that is often unavailable — the 1.5B fits in
// ~1.3GB and is the fallback whenever the bigger one cannot load.
export const qwen25_15b: ModelMetadata = {
  id: "qwen2.5:1.5b",
  provider: "ollama",
  contextTokens: 32768,
  modalities: ["text"],
  toolCalling: false,
  structuredOutput: false,
  reasoning: false,
  latencyClass: "local-cpu",
  costClass: "free",
  availability: "local",
  hwReqs: "~1.3GB resident — the low-memory fallback",
};

// The emergency tier. ~700MB resident, so it fits even when a browser and
// an IDE are eating the RAM. Weak, but it keeps the chat ANSWERING instead
// of failing outright.
export const qwen25_05b: ModelMetadata = {
  id: "qwen2.5:0.5b",
  provider: "ollama",
  contextTokens: 8192,
  modalities: ["text"],
  toolCalling: false,
  structuredOutput: false,
  reasoning: false,
  latencyClass: "local-cpu",
  costClass: "free",
  availability: "local",
  hwReqs: "~700MB resident — emergency tier for busy laptops",
};

// FREE cloud models are DISCOVERED, not hard-coded: OpenRouter's free tier
// changes weekly (models get paid, new ones appear). This catalog only
// holds the PREFERENCE ORDER — actual free models are read from
// /api/v1/models at boot, so a stale slug can never break the system.
//
// A hardcoded slug that 404s costs one fast failed request; a hardcoded
// list of DEAD models was exactly the bug we hit.
export const FREE_CLOUD_PREFERENCE = [
  // Bigger + tool-capable first: these do the real reasoning.
  "minimax/minimax-m3.1-flash:free",
  "nvidia/nemotron-3.5-super-vl:free",
  "poolside/laguna-s-2.1:free",
  "thinkingmachines/inkling:free",
  "liquid/lfm-2.5-2.6b:free",
];

export const FREE_CLOUD_MODELS: ModelMetadata[] = FREE_CLOUD_PREFERENCE.map((id) => ({
  id,
  provider: "openrouter",
  contextTokens: 32768,
  modalities: ["text"],
  toolCalling: true,
  structuredOutput: true,
  reasoning: false,
  latencyClass: "cloud",
  costClass: "free",
  availability: "cloud" as const,
  hwReqs: "free tier, rate-limited; data leaves the device",
}));
