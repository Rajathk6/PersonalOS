import { createHash } from "node:crypto";
import type { OfficialSource } from "./sources.js";
import { isOfficialUrl } from "./sources.js";

export interface HarvestedItem {
  sourceOrg: string;
  sourceId: string;
  title: string;
  url: string;
  summary: string | null;
  publishedAt: string | null;
  applyUrl: string | null;
  contentHash: string;
}

export interface SourceResult {
  sourceId: string;
  ok: boolean;
  items: HarvestedItem[];
  error?: string;
}

export interface HarvestOptions {
  timeoutMs?: number;
  maxItems?: number;
  userAgent?: string;
  // Skip the second fetch (detail page) — used by the tiny always-on device.
  skipApplyLookup?: boolean;
}

const DEFAULT_UA = "PersonalOS/0.4 (personal job alerts; local-first)";

function hashOf(title: string, url: string): string {
  return createHash("sha256").update(`${title.trim().toLowerCase()}|${url.trim().toLowerCase()}`).digest("hex").slice(0, 32);
}

async function fetchText(url: string, timeoutMs: number, userAgent: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": userAgent, Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function absolute(href: string, base: string): string | null {
  try {
    return new URL(href, base).toString();
  } catch {
    return null;
  }
}

// RSS/Atom without a dependency: item boundaries, then the few fields we
// need. Deliberately simple — gov feeds are plain RSS 2.0.
export function parseRss(xml: string, base: string): { title: string; url: string; summary: string | null; publishedAt: string | null }[] {
  const items = xml.split(/<item[\s>]/i).slice(1);
  const out: { title: string; url: string; summary: string | null; publishedAt: string | null }[] = [];
  for (const chunk of items) {
    const title = stripTags(chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
    const linkRaw = chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i)?.[1] ?? chunk.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "";
    const url = absolute(stripTags(linkRaw), base);
    if (!title || !url) continue;
    const summary = stripTags(chunk.match(/<description[^>]*>([\s\S]*?)<\/description>/i)?.[1] ?? "").slice(0, 600);
    const pub = stripTags(chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i)?.[1] ?? "");
    const publishedAt = pub === "" ? null : new Date(pub).toISOString().slice(0, 10);
    out.push({ title, url, summary: summary === "" ? null : summary, publishedAt });
  }
  return out;
}

// Server-rendered listing: every <a href> whose anchor text (or href) looks
// like a job/exam document. PDFs count — most gov circulars ARE PDFs, and a
// PDF link is a strong signal on its own.
export function parseListingLinks(
  html: string,
  base: string,
  keywords: string[],
  exclude: string[] = [],
): { title: string; url: string }[] {
  const out: { title: string; url: string }[] = [];
  const seen = new Set<string>();
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? "";
    const text = stripTags(m[2] ?? "");
    if (text.length < 6 || text.length > 300) continue;
    const hay = `${text} ${href}`.toLowerCase();
    if (exclude.some((k) => hay.includes(k.toLowerCase()))) continue;
    const isPdf = /\.pdf(\?|#|$)/i.test(href);
    const matches = keywords.some((k) => hay.includes(k.toLowerCase()));
    if (!matches && !isPdf) continue;
    const url = absolute(href, base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ title: text, url });
  }
  return out;
}

// Apply link from the OFFICIAL detail page: the first link whose text says
// apply/register. Stays on the official domain by construction.
export function extractApplyLink(html: string, base: string, source: OfficialSource, phrases: string[]): string | null {
  const re = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const href = m[1] ?? "";
    const text = stripTags(m[2] ?? "").toLowerCase();
    if (!phrases.some((p) => text.includes(p.toLowerCase()))) continue;
    const url = absolute(href, base);
    if (!url || !isOfficialUrl(url, source)) continue;
    return url;
  }
  return null;
}

// One source, one pass. Failure is contained: the caller keeps going.
export async function harvestSource(
  source: OfficialSource,
  opts: HarvestOptions = {},
): Promise<SourceResult> {
  const timeoutMs = opts.timeoutMs ?? 20000;
  const userAgent = opts.userAgent ?? DEFAULT_UA;
  const maxItems = opts.maxItems ?? 40;
  try {
    const body = await fetchText(source.listingUrl, timeoutMs, userAgent);
    const raw: { title: string; url: string; summary: string | null; publishedAt: string | null }[] =
      source.kind === "rss"
        ? parseRss(body, source.listingUrl)
        : parseListingLinks(body, source.listingUrl, source.linkKeywords, source.linkExclude).map((l) => ({
            title: l.title,
            url: l.url,
            summary: null,
            publishedAt: null,
          }));
    const items: HarvestedItem[] = [];
    for (const r of raw) {
      if (items.length >= maxItems) break;
      // AUTHENTICITY GATE: only the publisher's own domain survives.
      if (!isOfficialUrl(r.url, source)) continue;
      let applyUrl: string | null = null;
      if (!opts.skipApplyLookup && !r.url.toLowerCase().includes(".pdf")) {
        try {
          const detail = await fetchText(r.url, timeoutMs, userAgent);
          applyUrl = extractApplyLink(detail, r.url, source, source.applyPhrases);
        } catch {
          applyUrl = null; // detail page unreachable — keep the notification anyway
        }
      }
      items.push({
        sourceOrg: source.org,
        sourceId: source.id,
        title: r.title,
        url: r.url,
        summary: r.summary,
        publishedAt: r.publishedAt,
        applyUrl,
        contentHash: hashOf(r.title, r.url),
      });
    }
    return { sourceId: source.id, ok: true, items };
  } catch (err) {
    return {
      sourceId: source.id,
      ok: false,
      items: [],
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

export async function harvestAll(
  sources: OfficialSource[],
  opts: HarvestOptions = {},
): Promise<SourceResult[]> {
  const results: SourceResult[] = [];
  for (const s of sources) {
    results.push(await harvestSource(s, opts));
  }
  return results;
}
