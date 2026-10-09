import type { ModelProvider, ModelResponse } from "@personalos/contracts";
import { z } from "zod";
import { ModelError } from "./ollama-provider.js";

const CompletionSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1),
});

// Cloud provider (OpenAI-compatible). Registered ONLY when OPENROUTER_API_KEY
// is set — no key, no provider, no accidental cloud spend on a ₹0 budget.
// Never the default while a local model satisfies the hints (router rule).
export class OpenRouterProvider implements ModelProvider {
  readonly id = "openrouter";
  readonly metadata = {
    id: "openrouter",
    provider: "openrouter",
    contextTokens: 0,
    modalities: ["text"],
    toolCalling: true,
    structuredOutput: true,
    reasoning: false,
    latencyClass: "cloud",
    costClass: "paid",
    availability: "cloud" as const,
  };

  constructor(
    private readonly opts: { baseUrl: string; apiKey: string; timeoutMs: number },
  ) {}

  async generate(request: Parameters<ModelProvider["generate"]>[0]): Promise<ModelResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs);
    try {
      const res = await fetch(`${this.opts.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.opts.apiKey}`,
        },
        body: JSON.stringify({
          model: request.modelId,
          messages: request.messages,
          ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new ModelError("MODEL_UNAVAILABLE", `openrouter HTTP ${res.status}`);
      }
      const parsed = CompletionSchema.safeParse(await res.json());
      if (!parsed.success) {
        throw new ModelError("MODEL_BAD_RESPONSE", "openrouter returned an unexpected body");
      }
      const first = parsed.data.choices[0];
      return { text: first?.message.content ?? "" };
    } catch (err) {
      if (err instanceof ModelError) throw err;
      if (err instanceof Error && err.name === "AbortError") {
        throw new ModelError("MODEL_TIMEOUT", `openrouter timed out after ${this.opts.timeoutMs}ms`);
      }
      throw new ModelError("MODEL_UNAVAILABLE", err instanceof Error ? err.message : "openrouter unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
}
