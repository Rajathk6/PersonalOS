import type { ModelProvider, ModelRequest, ModelResponse } from "@personalos/contracts";
import { z } from "zod";

// Ollama chat response (non-streaming). Validated, never trusted raw.
const ChatResponseSchema = z.object({
  message: z.object({ role: z.string(), content: z.string() }),
});

export interface OllamaProviderOptions {
  baseUrl: string; // injected from config; never hard-coded, never localhost-assumed here
  timeoutMs: number;
}

export class ModelError extends Error {
  constructor(
    readonly code: "MODEL_TIMEOUT" | "MODEL_UNAVAILABLE" | "MODEL_BAD_RESPONSE",
    message: string,
  ) {
    super(message);
  }
}

// THE ONLY module allowed to speak HTTP to Ollama (ADR-003). Everything else
// — handlers, workers, routes, schedulers — goes through ModelProvider or
// ModelRouter. Enforced by grep in the Phase 2 gate (no other file may
// contain "11434" or "/api/chat").
export class OllamaProvider implements ModelProvider {
  readonly id = "ollama";
  readonly metadata = {
    id: "ollama",
    provider: "ollama",
    contextTokens: 0, // per-model metadata lives in the registry entry, not here
    modalities: ["text"],
    toolCalling: false,
    structuredOutput: false,
    reasoning: false,
    latencyClass: "local",
    costClass: "free",
    availability: "local" as const,
  };

  constructor(private readonly opts: OllamaProviderOptions) {}

  async generate(request: ModelRequest): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(`${this.opts.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: request.modelId,
          messages: request.messages,
          stream: false,
          // Latency/cost control (router concerns): callers cap output length.
          ...(request.maxTokens !== undefined ? { options: { num_predict: request.maxTokens } } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ModelError("MODEL_UNAVAILABLE", `ollama HTTP ${res.status}`);
      }
      const parsed = ChatResponseSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new ModelError("MODEL_BAD_RESPONSE", "ollama returned an unexpected body");
      }
      return { text: parsed.data.message.content };
    } catch (err) {
      if (err instanceof ModelError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ModelError("MODEL_TIMEOUT", `ollama timed out after ${this.opts.timeoutMs}ms`);
      }
      throw new ModelError("MODEL_UNAVAILABLE", err instanceof Error ? err.message : "ollama unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
}
