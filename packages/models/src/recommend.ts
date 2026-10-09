import type { ModelMetadata } from "@personalos/contracts";
import type { BenchmarkReport } from "./benchmark.js";

export interface RankedModel {
  id: string;
  score: number;
  reasons: string[];
}

// Recommendations, not decisions (spec §22: never blind-replace). Explainable
// arithmetic only: benchmark passes dominate, then locality, then cost, then
// context. The user (or DEFAULT_MODEL) picks; this only orders the menu.
export function recommend(
  models: ModelMetadata[],
  benchmarks: Map<string, BenchmarkReport> = new Map(),
): RankedModel[] {
  const ranked = models.map((m) => {
    const bench = benchmarks.get(m.id);
    const reasons: string[] = [];
    let score = 0;
    if (bench) {
      score += (bench.passed / bench.total) * 100;
      reasons.push(`benchmark ${bench.passed}/${bench.total} (avg ${bench.avgLatencyMs}ms)`);
    } else {
      reasons.push("not benchmarked yet");
    }
    if (m.availability === "local") {
      score += 10;
      reasons.push("runs locally (private, free)");
    }
    if (m.costClass === "free") {
      score += 5;
      reasons.push("no per-token cost");
    }
    if (m.contextTokens >= 32000) {
      score += 3;
      reasons.push(`${m.contextTokens} context`);
    }
    return { id: m.id, score: Math.round(score), reasons };
  });
  return ranked.sort((a, b) => b.score - a.score);
}
