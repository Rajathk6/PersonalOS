import type { Tool, ToolResult } from "@personalos/contracts";
import { z } from "zod";
import type { WatchStore } from "./store.js";
import { checkWatchTargets, candidateHash, readPage } from "./watcher.js";

const CreateInput = z.object({
  name: z.string().min(1).max(120),
  targets: z.array(z.string().url()).min(1).max(10),
  terms: z.array(z.string().min(1)).max(30).default([]),
  intervalMinutes: z.number().int().min(0).max(10080).default(0),
  allowedDomains: z.array(z.string().min(1)).max(10).default([]),
});

// Generic watch tools — the capability-independent verbs the chat agent uses
// for ANY kind of "keep me posted on this". Government jobs, a vendor's
// release notes, a competitor's blog: same three tools.
export function watchTools(store: WatchStore): (Tool & { version: string })[] {
  const create: Tool & { version: string } = {
    name: "watch.create",
    version: "1.0",
    description: "Create a watch: keep checking these pages for these words and notify me",
    inputSchema: { name: "short label", targets: "page URLs", terms: "words to look for", intervalMinutes: "0 = manual only" },
    requiredPermission: "watch.write",
    risk: "Low",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = CreateInput.safeParse(input);
      if (!parsed.success) {
        return { success: false, error_code: "BAD_INPUT", retryable: false, message: "name + targets (URLs) required" };
      }
      const w = await store.create(parsed.data);
      return {
        success: true, error_code: null, retryable: false,
        message: `watch "${w.name}" created (${w.targets.length} target(s), terms: ${w.terms.join(", ") || "any change"})`,
        metadata: { watchId: w.id },
      };
    },
  };

  const check: Tool & { version: string } = {
    name: "watch.check",
    version: "1.0",
    description: "Check my watches now and tell me what is new",
    inputSchema: { watchId: "optional; all enabled watches when omitted" },
    requiredPermission: "watch.read",
    risk: "Low",
    execute: async (input: unknown): Promise<ToolResult> => {
      const watchId = (input as { watchId?: unknown } | null)?.watchId;
      const watches = (await store.list()).filter(
        (w) => w.enabled && (watchId === undefined || w.id === watchId),
      );
      let fresh = 0;
      for (const w of watches) {
        const { candidates, errors } = await checkWatchTargets(w.targets, w.terms, w.allowedDomains);
        const items = await store.addItems(
          w.id,
          candidates.map((c) => ({ contentHash: candidateHash(c), title: c.title, url: c.url, summary: c.summary })),
        );
        fresh += items.length;
        await store.markChecked(w.id);
        if (errors.length > 0) {
          return { success: false, error_code: "WATCH_FETCH_FAILED", retryable: true, message: errors[0] ?? "fetch failed" };
        }
      }
      return {
        success: true, error_code: null, retryable: false,
        message: `checked ${watches.length} watch(es), ${fresh} new item(s)`,
        metadata: { watches: watches.length, fresh },
      };
    },
  };

  const pageRead: Tool & { version: string } = {
    name: "page.read",
    version: "1.0",
    description: "Read a link the user gave me: title, main text and links on it",
    inputSchema: { url: "the URL to read" },
    requiredPermission: "web.fetch",
    risk: "Low",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = z.object({ url: z.string().url() }).safeParse(input);
      if (!parsed.success) {
        return { success: false, error_code: "BAD_INPUT", retryable: false, message: "url required" };
      }
      try {
        const digest = await readPage(parsed.data.url);
        return {
          success: true, error_code: null, retryable: false,
          message: `${digest.title} (${digest.text.length} chars read)`,
          metadata: {
            title: digest.title,
            text: digest.text.slice(0, 4000),
            links: digest.links.slice(0, 40),
            truncated: digest.truncated,
          },
        };
      } catch (err) {
        return { success: false, error_code: "FETCH_FAILED", retryable: true, message: err instanceof Error ? err.message : "fetch failed" };
      }
    },
  };

  const list: Tool & { version: string } = {
    name: "watch.list",
    version: "1.0",
    description: "List my watches and the newest items they found",
    inputSchema: {},
    requiredPermission: "watch.read",
    risk: "Low",
    execute: async (): Promise<ToolResult> => {
      const watches = await store.list();
      const items = await store.items(undefined, 20);
      const lines = watches.map((w) => `- ${w.name}: ${w.targets.join(", ")} [${w.terms.join(", ") || "any"}]`);
      return {
        success: true, error_code: null, retryable: false,
        message: lines.length === 0 ? "no watches yet" : `${watches.length} watch(es):\n${lines.join("\n")}`,
        metadata: { watches, items },
      };
    },
  };

  return [create, check, pageRead, list];
}
