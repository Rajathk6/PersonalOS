import { afterEach, describe, expect, it, vi } from "vitest";
import { OllamaProvider, ModelError } from "./ollama-provider.js";

const provider = (): OllamaProvider =>
  new OllamaProvider({ baseUrl: "http://127.0.0.1:11434", timeoutMs: 1000 });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OllamaProvider", () => {
  it("maps a chat response to ModelResponse text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "hello" } }),
    }));
    const res = await provider().generate({ messages: [{ role: "user", content: "hi" }] });
    expect(res.text).toBe("hello");
  });

  it("posts non-streaming chat to /api/chat with the requested model", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ message: { role: "assistant", content: "x" } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await provider().generate({ modelId: "qwen2.5:3b", messages: [] });
    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(JSON.parse(init.body)).toMatchObject({ model: "qwen2.5:3b", stream: false });
  });

  it("turns HTTP errors into MODEL_UNAVAILABLE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 500 }));
    await expect(provider().generate({ messages: [] })).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });
  });

  it("turns aborts into MODEL_TIMEOUT", async () => {
    const abort = (): never => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    };
    vi.stubGlobal("fetch", vi.fn().mockImplementation(abort));
    await expect(provider().generate({ messages: [] })).rejects.toMatchObject({
      code: "MODEL_TIMEOUT",
    });
  });

  it("rejects malformed bodies as MODEL_BAD_RESPONSE", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ nope: 1 }) }));
    const err = await provider().generate({ messages: [] }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe("MODEL_BAD_RESPONSE");
  });
});
