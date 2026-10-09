import type { Tool, ToolResult } from "@personalos/contracts";
import { z } from "zod";
import type { ToolExecutor } from "@personalos/tools";
import type { JobsStore } from "./store.js";
import { extractTitle, matchKeywords } from "./store.js";

const CheckInput = z.object({ watchId: z.string().uuid().optional() });

// Discovery tool: fetch each enabled watch's sources THROUGH web.fetch (so
// caps, blocks, and audit apply), keyword-match deterministically, persist
// deduped findings. Returns the fresh set — notification is the task
// handler's job, not the tool's.
export function jobsTools(store: JobsStore, executor: ToolExecutor): (Tool & { version: string })[] {
  const check: Tool & { version: string } = {
    name: "jobs.check",
    version: "0.1",
    description: "Check job watches for keyword matches (deterministic, deduped)",
    inputSchema: { watchId: "optional UUID; all enabled watches when omitted" },
    requiredPermission: "jobs.write",
    risk: "Low",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = CheckInput.safeParse(input ?? {});
      if (!parsed.success) {
        return { success: false, error_code: "BAD_INPUT", retryable: false, message: "watchId must be a UUID when given" };
      }
      const watches = (await store.listWatches()).filter(
        (w) => w.enabled && (parsed.data.watchId === undefined || w.id === parsed.data.watchId),
      );
      const fresh: { id: string; watchId: string; sourceUrl: string; title: string; matchedKeywords: string[] }[] = [];
      let fetched = 0;
      for (const watch of watches) {
        for (const source of watch.sources) {
          const fetchedRes = await executor.execute("web.fetch", { url: source }, "worker", { capability: "jobs" });
          if (!fetchedRes.success) continue;
          fetched += 1;
          const content = String((fetchedRes.metadata as { content?: unknown } | undefined)?.content ?? "");
          const matched = matchKeywords(content, watch.keywords);
          if (matched.length === 0) continue;
          const found = await store.recordFindings([{
            watchId: watch.id,
            sourceUrl: source,
            title: extractTitle(content, source),
            snippet: content.replace(/\s+/g, " ").slice(0, 500),
            matchedKeywords: matched,
          }]);
          for (const f of found) {
            fresh.push({ id: f.id, watchId: f.watchId, sourceUrl: f.sourceUrl, title: f.title, matchedKeywords: f.matchedKeywords });
          }
        }
        await store.markChecked(watch.id);
      }
      return {
        success: true, error_code: null, retryable: false,
        message: `checked ${watches.length} watch(es), fetched ${fetched} page(s), ${fresh.length} new finding(s)`,
        metadata: { watches: watches.length, fetched, fresh },
      };
    },
  };
  return [check];
}
