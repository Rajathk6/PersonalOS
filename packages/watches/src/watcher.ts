import { createHash } from "node:crypto";

export interface WatchCandidate {
  title: string;
  url: string;
  summary: string | null;
}

function hashOf(title: string, url: string): string {
  return createHash("sha256").update(`${title.trim().toLowerCase()}|${url.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

function stripTags(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ").replace(/\s+/g, " ").trim();
}

async function fetchText(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "PersonalOS/0.5 (personal watcher; local-first)", Accept: "text/html,application/xhtml+xml,*/*;q=0.8" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

// Read a page the user pasted and answer from it: title, cleaned text, and
// the outgoing links. This is the "what is this link?" capability.
export interface PageDigest {
  url: string;
  title: string;
  text: string;
  links: { text: string; url: string }[];
  truncated: boolean;
  rendered?: boolean; // true when a JS-shell page was rendered by the reader
}

// Modern government sites are JavaScript apps: a plain fetch returns
// "please enable JavaScript" and nothing useful. The reader proxy renders
// the page to text. Trade-off, stated plainly: the URL passes through a
// third party (only the address — we never send private pages there).
const READER_PREFIX = "https://r.jina.ai/";

async function tryReader(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${READER_PREFIX}${url}`, {
        signal: controller.signal,
        headers: { "User-Agent": "PersonalOS/0.5 (page reader)" },
      });
      if (!res.ok) return null;
      const text = await res.text();
      // The reader answers with a JSON error object when it cannot render —
      // that is NOT content and must not be handed to the model as a page.
      if (text.trim() === "") return null;
      if (text.trimStart().startsWith("{") && /"(AssertionFailureError|cause|status)/.test(text.slice(0, 400))) {
        return null;
      }
      return text;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return null;
  }
}

// Read a page the user pasted and answer from it: title, cleaned text, and
// the outgoing links. This is the "what is this link?" capability.
export async function readPage(url: string, timeoutMs = 10000): Promise<PageDigest> {
  const html = await fetchText(url, timeoutMs);
  const title = stripTags(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? url);
  const text = stripTags(html).slice(0, 3000);
  const links: { text: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null && links.length < 120) {
    const label = stripTags(m[2] ?? "").slice(0, 160);
    if (label.length < 3) continue;
    let abs: string;
    try {
      abs = new URL(m[1] ?? "", url).toString();
    } catch {
      continue;
    }
    if (seen.has(abs)) continue;
    seen.add(abs);
    links.push({ text: label, url: abs });
  }
  // JS shell? Try the renderer before giving the model an empty page.
  const looksEmpty = text.length < 400 || /enable javascript|please enable|requires javascript/i.test(text);
  if (looksEmpty) {
    const rendered = await tryReader(url, Math.min(timeoutMs, 10000));
    if (rendered !== null) {
      return { url, title, text: rendered.slice(0, 3000), links, truncated: rendered.length > 3000, rendered: true };
    }
  }
  return { url, title, text, links, truncated: text.length >= 3000 };
}

// One watch check: fetch the target(s), find items that look new, return
// candidates. Terms are plain words — a page qualifies if any term appears
// in its text. With NO terms, every link on the page is a candidate (the
// "what changed here?" style watch).
export async function checkWatchTargets(
  targets: string[],
  terms: string[],
  allowedDomains: string[],
  timeoutMs = 20000,
): Promise<{ candidates: WatchCandidate[]; errors: string[] }> {
  const candidates: WatchCandidate[] = [];
  const errors: string[] = [];
  const lowerTerms = terms.map((t) => t.toLowerCase()).filter((t) => t !== "");
  for (const target of targets) {
    try {
      const html = await fetchText(target, timeoutMs);
      const baseHost = new URL(target).hostname.toLowerCase();
      const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) !== null) {
        const label = stripTags(m[2] ?? "").slice(0, 200);
        if (label.length < 4) continue;
        let abs: string;
        try {
          abs = new URL(m[1] ?? "", target).toString();
        } catch {
          continue;
        }
        const host = new URL(abs).hostname.toLowerCase();
        if (allowedDomains.length > 0) {
          const ok = allowedDomains.some(
            (d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`),
          );
          if (!ok) continue;
        } else if (host !== baseHost && !host.endsWith(`.${baseHost}`)) {
          continue; // stay on the watched site unless the user allowed more
        }
        if (lowerTerms.length > 0) {
          const hay = `${label} ${abs}`.toLowerCase();
          if (!lowerTerms.some((t) => hay.includes(t))) continue;
        }
        candidates.push({ title: label, url: abs, summary: null });
        if (candidates.length >= 60) break;
      }
    } catch (err) {
      errors.push(`${target}: ${err instanceof Error ? err.message : "fetch failed"}`);
    }
  }
  return { candidates, errors };
}

export function candidateHash(c: WatchCandidate): string {
  return hashOf(c.title, c.url);
}
