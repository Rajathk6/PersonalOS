import type { ModelProvider } from "@personalos/contracts";

export interface BenchmarkTask {
  name: string;
  prompt: string;
  maxTokens: number;
  // Pass rule per task, kept trivially checkable (no judge model needed).
  check: (text: string) => boolean;
}

export interface BenchmarkResult {
  task: string;
  ok: boolean;
  latencyMs: number;
  excerpt: string;
}

// Micro-benchmark (spec §22): two tiny tasks, not a leaderboard. It answers
// "does this model follow basic instructions at all" — adoption advice, never
// an automatic switch. Small on purpose: each task costs a CPU generation.
export const BENCHMARK_TASKS: BenchmarkTask[] = [
  {
    name: "json-format",
    prompt: 'Reply with ONLY this JSON and no other words: {"ok":true}',
    maxTokens: 30,
    check: (text) => {
      try {
        return (JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as { ok?: unknown }).ok === true;
      } catch {
        return false;
      }
    },
  },
  {
    name: "exact-instruction",
    prompt: "Reply with exactly this one word and nothing else: mango",
    maxTokens: 10,
    check: (text) => text.trim().toLowerCase() === "mango",
  },
];

export interface BenchmarkReport {
  modelId: string;
  passed: number;
  total: number;
  avgLatencyMs: number;
  results: BenchmarkResult[];
}

export async function runBenchmark(
  provider: ModelProvider,
  modelId: string,
  tasks: BenchmarkTask[] = BENCHMARK_TASKS,
): Promise<BenchmarkReport> {
  const results: BenchmarkResult[] = [];
  for (const task of tasks) {
    const t0 = Date.now();
    let ok = false;
    let excerpt = "";
    try {
      const res = await provider.generate({ modelId, maxTokens: task.maxTokens, messages: [{ role: "user", content: task.prompt }] });
      excerpt = res.text.slice(0, 120);
      ok = task.check(res.text);
    } catch {
      excerpt = "generate() threw";
      ok = false;
    }
    results.push({ task: task.name, ok, latencyMs: Date.now() - t0, excerpt });
  }
  const passed = results.filter((r) => r.ok).length;
  return {
    modelId,
    passed,
    total: results.length,
    avgLatencyMs: Math.round(results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, results.length)),
    results,
  };
}
