import type { PrismaClient } from "@prisma/client";

// Pure + deterministic: lowercase substring match. No stemming, no model, no
// scores to explain — a finding exists iff a keyword literally appears.
// Smarter matching (stems, embeddings) must prove itself against this baseline.
export function matchKeywords(text: string, keywords: string[]): string[] {
  const lower = text.toLowerCase();
  return keywords.filter((k) => k.length > 0 && lower.includes(k.toLowerCase()));
}

export function extractTitle(html: string, fallback: string): string {
  const m = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
  const title = (m?.[1] ?? "").trim().replace(/\s+/g, " ");
  return title === "" ? fallback : title;
}

export interface WatchInput {
  name: string;
  keywords: string[];
  sources: string[];
}

export interface NewFinding {
  watchId: string;
  sourceUrl: string;
  title: string;
  snippet: string;
  matchedKeywords: string[];
}

export class JobsStore {
  constructor(private readonly db: PrismaClient) {}

  async createWatch(input: WatchInput) {
    return this.db.jobWatch.create({
      data: { name: input.name, keywords: input.keywords, sources: input.sources },
    });
  }

  async listWatches() {
    return this.db.jobWatch.findMany({ orderBy: { name: "asc" } });
  }

  async listFindings(watchId?: string) {
    return this.db.jobFinding.findMany({
      where: watchId ? { watchId } : {},
      orderBy: { foundAt: "desc" },
      take: 100,
    });
  }

  // Dedup by (watch, url, title): re-checking a quiet page stores nothing new.
  // Returns only genuinely new findings (the notify set), with row ids.
  async recordFindings(candidates: NewFinding[]) {
    const fresh: (NewFinding & { id: string })[] = [];
    for (const c of candidates) {
      const existing = await this.db.jobFinding.findFirst({
        where: { watchId: c.watchId, sourceUrl: c.sourceUrl, title: c.title },
        select: { id: true },
      });
      if (existing) continue;
      const row = await this.db.jobFinding.create({
        data: {
          watchId: c.watchId,
          sourceUrl: c.sourceUrl,
          title: c.title,
          snippet: c.snippet.slice(0, 500),
          matchedKeywords: c.matchedKeywords,
        },
      });
      fresh.push({ ...c, id: row.id });
    }
    return fresh;
  }

  async markChecked(watchId: string, now: Date = new Date()): Promise<void> {
    await this.db.jobWatch.update({ where: { id: watchId }, data: { lastCheckedAt: now } });
  }

  async markNotified(watchId: string, sourceUrl: string, title: string): Promise<void> {
    await this.db.jobFinding.updateMany({ where: { watchId, sourceUrl, title }, data: { notified: true } });
  }
}
