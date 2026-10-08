import { describe, expect, it } from "vitest";
import type { ModelMetadata } from "@personalos/contracts";
import { ModelRegistry, route } from "./registry.js";
import { qwen25_3b } from "./catalog.js";

const cloudPro: ModelMetadata = {
  ...qwen25_3b,
  id: "cloud-pro",
  provider: "openrouter",
  availability: "cloud",
  toolCalling: true,
  contextTokens: 128000,
  costClass: "paid",
};

describe("ModelRegistry", () => {
  it("registers, gets, and lists; duplicates throw", async () => {
    const { OllamaProvider } = await import("./ollama-provider.js");
    const registry = new ModelRegistry();
    registry.register({
      metadata: qwen25_3b,
      provider: new OllamaProvider({ baseUrl: "http://x", timeoutMs: 1 }),
    });
    expect(registry.get("qwen2.5:3b").metadata.provider).toBe("ollama");
    expect(registry.list().map((m) => m.id)).toEqual(["qwen2.5:3b"]);
    expect(() => registry.register({
      metadata: qwen25_3b,
      provider: registry.get("qwen2.5:3b").provider,
    })).toThrowError(/already registered/);
    expect(() => registry.get("missing")).toThrowError(/not registered/);
  });
});

describe("route", () => {
  const models = [qwen25_3b, cloudPro];

  it("keeps local models for privacy-sensitive work", () => {
    expect(route(models, { privacySensitive: true }).id).toBe("qwen2.5:3b");
  });

  it("requires tool calling and long context when asked", () => {
    expect(route(models, { needsToolCalling: true }).id).toBe("cloud-pro");
    expect(route(models, { needsLongContext: true }).id).toBe("qwen2.5:3b");
  });

  it("throws when nothing satisfies the hints", () => {
    expect(() => route([qwen25_3b], { needsToolCalling: true })).toThrowError(/no registered model/);
  });
});
