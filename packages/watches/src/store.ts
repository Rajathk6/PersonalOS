import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";

type Db = PrismaClient;

export const WatchSchema = z.object({
  name: z.string().min(1).max(120),
  targets: z.array(z.string().url()).min(1).max(10),
  // Plain-language terms. A page qualifies if ANY term appears in its
  // title/text. Empty = "anything that changed" (diff-style watching).
  terms: z.array(z.string().min(1)).max(30).default([]),
  intervalMinutes: z.number().int().min(0).max(10080).default(0),
  // Authenticity constraint (optional): only links on these domains count.
  allowedDomains: z.array(z.string().min(1)).max(10).default([]),
  extra: z.record(z.string(), z.unknown()).default({}),
});

export type WatchInput = z.input<typeof WatchSchema>;

export interface Watch {
  id: string;
  name: string;
  targets: string[];
  terms: string[];
  intervalMinutes: number;
  allowedDomains: string[];
  extra: Record<string, unknown>;
  enabled: boolean;
  lastCheckedAt: string | null;
  createdAt: string;
}

export interface WatchItem {
  id: string;
  watchId: string;
  contentHash: string;
  title: string;
  url: string;
  summary: string | null;
  extra: Record<string, unknown>;
  foundAt: string;
}

function toWatch(row: {
  id: string; name: string; targets: string[]; terms: string[]; intervalMinutes: number;
  allowedDomains: string[]; extra: Prisma.JsonValue; enabled: boolean;
  lastCheckedAt: Date | null; createdAt: Date;
}): Watch {
  return {
    id: row.id,
    name: row.name,
    targets: row.targets,
    terms: row.terms,
    intervalMinutes: row.intervalMinutes,
    allowedDomains: row.allowedDomains,
    extra: (row.extra ?? {}) as Record<string, unknown>,
    enabled: row.enabled,
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

function toItem(row: {
  id: string; watchId: string; contentHash: string; title: string; url: string;
  summary: string | null; extra: Prisma.JsonValue; foundAt: Date;
}): WatchItem {
  return {
    id: row.id,
    watchId: row.watchId,
    contentHash: row.contentHash,
    title: row.title,
    url: row.url,
    summary: row.summary,
    extra: (row.extra ?? {}) as Record<string, unknown>,
    foundAt: row.foundAt.toISOString(),
  };
}

// Watches are USER-OWNED and changeable at any time: created from chat,
// edited, paused, deleted. Nothing here is hard-coded to a domain — "notify
// me about govt jobs" is just a watch with certain terms.
export class WatchStore {
  constructor(private readonly db: Db) {}

  async create(input: WatchInput, db: Db = this.db): Promise<Watch> {
    const w = WatchSchema.parse(input);
    const row = await db.watch.create({
      data: {
        name: w.name,
        targets: w.targets,
        terms: w.terms,
        intervalMinutes: w.intervalMinutes,
        allowedDomains: w.allowedDomains,
        extra: w.extra as Prisma.InputJsonValue,
      },
    });
    return toWatch(row);
  }

  async list(db: Db = this.db): Promise<Watch[]> {
    void db;
    const rows = await this.db.watch.findMany({ orderBy: { createdAt: "desc" } });
    return rows.map(toWatch);
  }

  async get(id: string): Promise<Watch | null> {
    const row = await this.db.watch.findUnique({ where: { id } });
    return row === null ? null : toWatch(row);
  }

  async update(id: string, patch: {
    name?: string | undefined;
    targets?: string[] | undefined;
    terms?: string[] | undefined;
    intervalMinutes?: number | undefined;
    allowedDomains?: string[] | undefined;
    enabled?: boolean | undefined;
    extra?: Record<string, unknown> | undefined;
  }): Promise<Watch | null> {
    const row = await this.db.watch.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.targets !== undefined ? { targets: patch.targets } : {}),
        ...(patch.terms !== undefined ? { terms: patch.terms } : {}),
        ...(patch.intervalMinutes !== undefined ? { intervalMinutes: patch.intervalMinutes } : {}),
        ...(patch.allowedDomains !== undefined ? { allowedDomains: patch.allowedDomains } : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.extra !== undefined ? { extra: patch.extra as Prisma.InputJsonValue } : {}),
      },
    });
    return toWatch(row);
  }

  async remove(id: string): Promise<boolean> {
    const res = await this.db.watch.deleteMany({ where: { id } });
    return res.count === 1;
  }

  async markChecked(id: string, now: Date = new Date()): Promise<void> {
    await this.db.watch.update({ where: { id }, data: { lastCheckedAt: now } });
  }

  // Dedup by contentHash: the same page/entry is never alerted twice.
  async addItems(
    watchId: string,
    items: { contentHash: string; title: string; url: string; summary?: string | null; extra?: Record<string, unknown> }[],
    db: Db = this.db,
  ): Promise<WatchItem[]> {
    const fresh: WatchItem[] = [];
    for (const item of items) {
      const existing = await db.watchItem.findUnique({ where: { contentHash: item.contentHash } });
      if (existing !== null) continue;
      try {
        const row = await db.watchItem.create({
          data: {
            watchId,
            contentHash: item.contentHash,
            title: item.title,
            url: item.url,
            summary: item.summary ?? null,
            extra: (item.extra ?? {}) as Prisma.InputJsonValue,
          },
        });
        fresh.push(toItem(row));
      } catch {
        // concurrent insert — treat as duplicate
      }
    }
    return fresh;
  }

  async items(watchId?: string, limit = 50): Promise<WatchItem[]> {
    const rows = await this.db.watchItem.findMany({
      where: watchId !== undefined ? { watchId } : {},
      orderBy: { foundAt: "desc" },
      take: limit,
    });
    return rows.map(toItem);
  }

  async unalerted(limit = 30): Promise<(WatchItem & { watchName: string })[]> {
    const rows = await this.db.watchItem.findMany({
      where: { alertedAt: null },
      orderBy: { foundAt: "desc" },
      take: limit,
      include: { watch: { select: { name: true } } },
    });
    return rows.map((r) => ({ ...toItem(r), watchName: r.watch.name }));
  }

  async markAlerted(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.watchItem.updateMany({ where: { id: { in: ids } }, data: { alertedAt: new Date() } });
  }
}
