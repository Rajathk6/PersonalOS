import type { ModelMetadata } from "@personalos/contracts";
import { z } from "zod";

const TagsSchema = z.object({
  models: z.array(z.object({ name: z.string(), size: z.number().optional() })).default([]),
});

const ShowSchema = z.object({
  details: z.object({
    parameter_size: z.string().optional(),
    quantization_level: z.string().optional(),
  }).partial().default({}),
  model_info: z.record(z.string(), z.unknown()).default({}),
});

// New-model discovery (spec §22): inspect metadata, never blind-replace —
// callers register only ids they don't already have. Context length is
// best-effort (Ollama doesn't always report it); estimates are marked in
// hwReqs so nobody mistakes them for measured facts.
export async function discoverOllama(baseUrl: string, timeoutMs = 15000): Promise<ModelMetadata[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!res.ok) return [];
    const tags = TagsSchema.parse(await res.json());
    const out: ModelMetadata[] = [];
    for (const m of tags.models) {
      out.push(await describeOllama(baseUrl, m.name, m.size ?? 0, timeoutMs));
    }
    return out;
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function describeOllama(baseUrl: string, name: string, size: number, timeoutMs: number): Promise<ModelMetadata> {
  let contextTokens = 4096;
  let estimated = true;
  let quant = "unknown";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: name }),
        signal: controller.signal,
      });
      if (res.ok) {
        const show = ShowSchema.parse(await res.json());
        quant = show.details.quantization_level ?? quant;
        for (const [key, value] of Object.entries(show.model_info)) {
          if (key.toLowerCase().includes("context_length") && typeof value === "number") {
            contextTokens = value;
            estimated = false;
            break;
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  } catch {
    // Metadata is advisory; a model that lists is still usable.
  }
  return {
    id: name,
    provider: "ollama",
    contextTokens,
    modalities: ["text"],
    toolCalling: false,
    structuredOutput: false,
    reasoning: false,
    latencyClass: "local-cpu",
    costClass: "free",
    availability: "local",
    hwReqs: `~${Math.round(size / 1e9)}GB download${estimated ? "; context length estimated, not reported" : ""}${quant !== "unknown" ? `; ${quant}` : ""}`,
  };
}

const OpenRouterModelsSchema = z.object({
  data: z.array(z.object({
    id: z.string(),
    context_length: z.number().optional(),
    pricing: z.object({ prompt: z.string().optional(), completion: z.string().optional() }).partial().default({}),
  })).default([]),
});

export async function discoverOpenRouter(baseUrl: string, apiKey: string, timeoutMs = 15000): Promise<ModelMetadata[]> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: controller.signal,
      });
      if (!res.ok) return [];
      const parsed = OpenRouterModelsSchema.parse(await res.json());
      return parsed.data.map((m) => ({
        id: m.id,
        provider: "openrouter",
        contextTokens: m.context_length ?? 8192,
        modalities: ["text"],
        toolCalling: true,
        structuredOutput: true,
        reasoning: false,
        latencyClass: "cloud",
        costClass: m.pricing.prompt === "0" ? "free" : "paid",
        availability: "cloud" as const,
      }));
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return [];
  }
}
