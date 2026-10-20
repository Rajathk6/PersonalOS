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

// FREE cloud models (OpenRouter ":free" tier). No local RAM, much stronger
// reasoning than a 0.5B — the right partner for hard work (eligibility
// analysis, exam prep) and the safety net when the laptop is out of RAM.
// Trade-off, stated plainly: anything sent here leaves the machine.
export const FREE_CLOUD_MODELS: ModelMetadata[] = [
  {
    id: "deepseek/deepseek-chat-v3-0324:free",
    provider: "openrouter",
    contextTokens: 64000,
    modalities: ["text"],
    toolCalling: true,
    structuredOutput: true,
    reasoning: true,
    latencyClass: "cloud",
    costClass: "free",
    availability: "cloud",
    hwReqs: "free tier, rate-limited; data leaves the device",
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct:free",
    provider: "openrouter",
    contextTokens: 128000,
    modalities: ["text"],
    toolCalling: true,
    structuredOutput: true,
    reasoning: false,
    latencyClass: "cloud",
    costClass: "free",
    availability: "cloud",
    hwReqs: "free tier, rate-limited; data leaves the device",
  },
  {
    id: "google/gemini-2.0-flash-exp:free",
    provider: "openrouter",
    contextTokens: 1000000,
    modalities: ["text"],
    toolCalling: true,
    structuredOutput: true,
    reasoning: false,
    latencyClass: "cloud",
    costClass: "free",
    availability: "cloud",
    hwReqs: "free tier, rate-limited; data leaves the device",
  },
];
