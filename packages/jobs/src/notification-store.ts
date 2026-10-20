import type { JobNotification as JobNotificationRow, PrismaClient } from "@prisma/client";
import type { HarvestedItem } from "./harvest.js";
import type { MatchResult } from "./profile.js";

export interface StoredNotification {
  id: string;
  contentHash: string;
  sourceOrg: string;
  sourceUrl: string;
  title: string;
  applyUrl: string | null;
  eligibility: string;
  matchScore: number;
  matchReasons: string[];
  createdAt: string;
}

// Deduplication is by contentHash — the SAME circular from any source, any
// run, is stored once. That is what stops a daily harvester from becoming a
// daily spam machine.
export class NotificationStore {
  constructor(private readonly db: PrismaClient) {}

  async ingest(
    items: HarvestedItem[],
    match: (item: HarvestedItem) => MatchResult,
    harvestedBy = "laptop",
  ): Promise<{ inserted: StoredNotification[]; duplicates: number }> {
    const inserted: StoredNotification[] = [];
    let duplicates = 0;
    for (const item of items) {
      const exists = await this.db.jobNotification.findUnique({ where: { contentHash: item.contentHash } });
      if (exists !== null) {
        duplicates += 1;
        continue;
      }
      const m = match(item);
      try {
        const row = await this.db.jobNotification.create({
          data: {
            contentHash: item.contentHash,
            sourceOrg: item.sourceOrg,
            sourceUrl: item.url,
            title: item.title,
            summary: item.summary,
            applyUrl: item.applyUrl,
            publishedAt: item.publishedAt,
            eligibility: m.verdict,
            matchScore: m.score,
            matchReasons: m.reasons,
            harvestedBy,
          },
        });
        inserted.push(toStored(row));
      } catch {
        // Unique race (two harvesters at once) — treat as duplicate.
        duplicates += 1;
      }
    }
    return { inserted, duplicates };
  }

  async list(opts: { minScore?: number; limit?: number; since?: Date } = {}): Promise<StoredNotification[]> {
    const rows = await this.db.jobNotification.findMany({
      where: {
        ...(opts.minScore !== undefined ? { matchScore: { gte: opts.minScore } } : {}),
        ...(opts.since !== undefined ? { createdAt: { gte: opts.since } } : {}),
      },
      orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
      take: opts.limit ?? 50,
    });
    return rows.map(toStored);
  }

  async markAlerted(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.jobNotification.updateMany({
      where: { id: { in: ids } },
      data: { alertedAt: new Date() },
    });
  }

  async unalerted(minScore: number, limit = 20): Promise<StoredNotification[]> {
    const rows = await this.db.jobNotification.findMany({
      where: { alertedAt: null, matchScore: { gte: minScore } },
      orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
      take: limit,
    });
    return rows.map(toStored);
  }
}

function toStored(row: JobNotificationRow): StoredNotification {
  return {
    id: row.id,
    contentHash: row.contentHash,
    sourceOrg: row.sourceOrg,
    sourceUrl: row.sourceUrl,
    title: row.title,
    applyUrl: row.applyUrl,
    eligibility: row.eligibility ?? "unreviewed",
    matchScore: row.matchScore,
    matchReasons: row.matchReasons,
    createdAt: row.createdAt.toISOString(),
  };
}
