import type { PrismaClient } from "@prisma/client";
import type { BenchmarkReport } from "./benchmark.js";

// Benchmark evidence store. Latest report per model is what recommend() eats;
// history stays queryable for "did this model get worse" questions later.
export class BenchmarkStore {
  constructor(private readonly db: PrismaClient) {}

  async save(report: BenchmarkReport): Promise<void> {
    for (const r of report.results) {
      await this.db.modelBenchmark.create({
        data: { modelId: report.modelId, task: r.task, ok: r.ok, latencyMs: r.latencyMs },
      });
    }
  }

  async latest(): Promise<Map<string, BenchmarkReport>> {
    const rows = await this.db.modelBenchmark.findMany({ orderBy: { ranAt: "desc" }, take: 500 });
    const byModel = new Map<string, { results: { task: string; ok: boolean; latencyMs: number }[] }>();
    for (const row of rows) {
      // Latest run per (model, task) wins; older runs are history only.
      let entry = byModel.get(row.modelId);
      if (!entry) {
        entry = { results: [] };
        byModel.set(row.modelId, entry);
      }
      if (!entry.results.some((r) => r.task === row.task)) {
        entry.results.push({ task: row.task, ok: row.ok, latencyMs: row.latencyMs });
      }
    }
    const out = new Map<string, BenchmarkReport>();
    for (const [modelId, entry] of byModel) {
      const passed = entry.results.filter((r) => r.ok).length;
      out.set(modelId, {
        modelId,
        passed,
        total: entry.results.length,
        avgLatencyMs: Math.round(
          entry.results.reduce((s, r) => s + r.latencyMs, 0) / Math.max(1, entry.results.length),
        ),
        results: entry.results.map((r) => ({ ...r, excerpt: "" })),
      });
    }
    return out;
  }
}
