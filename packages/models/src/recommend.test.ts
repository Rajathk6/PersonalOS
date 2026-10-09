import { describe, expect, it } from "vitest";
import { recommend } from "./recommend.js";
import { qwen25_3b } from "./catalog.js";
import type { BenchmarkReport } from "./benchmark.js";

// Written, not run (prototype rule).
describe("recommend", () => {
  it("ranks benchmarked local free models first, with reasons", () => {
    const cloud = { ...qwen25_3b, id: "cloud-x", provider: "openrouter", availability: "cloud" as const, costClass: "paid" };
    const bench = new Map<string, BenchmarkReport>([
      ["qwen2.5:3b", { modelId: "qwen2.5:3b", passed: 2, total: 2, avgLatencyMs: 90000, results: [] }],
      ["cloud-x", { modelId: "cloud-x", passed: 2, total: 2, avgLatencyMs: 2000, results: [] }],
    ]);
    const ranked = recommend([cloud, qwen25_3b], bench);
    expect(ranked[0]?.id).toBe("qwen2.5:3b");
    expect(ranked[0]?.reasons.join(" ")).toMatch(/locally/);
  });

  it("works with no benchmarks at all", () => {
    const ranked = recommend([qwen25_3b]);
    expect(ranked[0]?.id).toBe("qwen2.5:3b");
    expect(ranked[0]?.reasons).toContain("not benchmarked yet");
  });
});
