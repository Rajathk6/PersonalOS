import type { Tool, ToolResult } from "@personalos/contracts";
import { z } from "zod";

const FetchInput = z.object({ url: z.string().min(1) });

// Private-range guards for literal IPs (no DNS resolution here — hostnames
// pass through, documented limitation; a resolving guard lands with the
// Phase 7 capability sandbox). Metadata + localhost never fetchable.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "metadata.google.internal") return true;
  if (/^127\./.test(h) || h === "::1") return true;
  if (/^169\.254\./.test(h)) return true; // cloud metadata
  if (/^10\./.test(h) || /^192\.168\./.test(h)) return true;
  const m172 = h.match(/^172\.(\d+)\./);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  return false;
}

export function webTools(): (Tool & { version: string })[] {
  const fetchTool: Tool & { version: string } = {
    name: "web.fetch",
    version: "1.0",
    description: "GET a public http(s) URL as text (1MB cap, 30s timeout)",
    inputSchema: { url: "public http(s) URL" },
    requiredPermission: "web.fetch",
    risk: "Low",
    execute: async (input: unknown): Promise<ToolResult> => {
      const parsed = FetchInput.safeParse(input);
      if (!parsed.success) return { success: false, error_code: "BAD_INPUT", retryable: false, message: "url (string) required" };
      let url: URL;
      try {
        url = new URL(parsed.data.url);
      } catch {
        return { success: false, error_code: "BAD_INPUT", retryable: false, message: "not a valid URL" };
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { success: false, error_code: "BLOCKED", retryable: false, message: "only http(s) URLs" };
      }
      if (isBlockedHost(url.hostname)) {
        return { success: false, error_code: "BLOCKED", retryable: false, message: "private/local hosts are not fetchable" };
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const res = await fetch(url.toString(), {
          signal: controller.signal,
          headers: { "User-Agent": "PersonalOS/0.3 (local-first)" },
        });
        if (!res.ok) {
          return { success: false, error_code: `HTTP_${res.status}`, retryable: res.status >= 500, message: `fetch failed: HTTP ${res.status}` };
        }
        const text = await res.text();
        // 1MB cap honors the ~1Mbps reality: never buffer the whole internet.
        const capped = text.slice(0, 1024 * 1024);
        return {
          success: true, error_code: null, retryable: false,
          message: `fetched ${url.hostname} (${capped.length} chars)`,
          metadata: { url: url.toString(), status: res.status, content: capped, truncated: text.length > capped.length },
        };
      } catch (err) {
        const timeout = err instanceof Error && err.name === "AbortError";
        return {
          success: false, error_code: timeout ? "TIMEOUT" : "FETCH_FAILED", retryable: true,
          message: timeout ? "fetch timed out after 30s" : "fetch failed",
        };
      } finally {
        clearTimeout(timer);
      }
    },
  };
  return [fetchTool];
}
