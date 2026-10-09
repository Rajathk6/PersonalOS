import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { z } from "zod";

type Db = PrismaClient | Prisma.TransactionClient;

// Six kinds (spec §39), one store. Write-side rules fight the garbage dump:
// keyed kinds upsert (latest fact wins, no duplicates), unkeyed kinds append,
// expired rows are invisible to recall. Ranking (not a write gate) decides
// what surfaces: importance first, freshness second.
export const MemoryKindSchema = z.enum(["working", "episodic", "semantic", "user", "procedural", "task"]);
export type MemoryKind = z.infer<typeof MemoryKindSchema>;

const RememberSchema = z.object({
  kind: MemoryKindSchema,
  key: z.string().min(1).max(200).optional(),
  content: z.unknown(),
  importance: z.number().min(0).max(1).default(0.5),
  confidence: z.number().min(0).max(1).default(1.0),
  sourceTaskId: z.string().uuid().optional(),
  expiresAt: z.string().datetime({ offset: true }).optional(),
});

export type RememberInput = z.input<typeof RememberSchema>;

export interface MemoryRecord {
  id: string;
  kind: MemoryKind;
  key: string | null;
  content: unknown;
  importance: number;
  confidence: number;
  sourceTaskId: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

const RecallSchema = z.object({
  kind: MemoryKindSchema.optional(),
  query: z.string().min(1).max(500).optional(),
  minImportance: z.number().min(0).max(1).default(0),
  limit: z.number().int().min(1).max(100).default(20),
});

export type RecallQuery = z.input<typeof RecallSchema>;

function toRecord(row: {
  id: string; kind: string; key: string | null; content: Prisma.JsonValue;
  importance: number; confidence: number; sourceTaskId: string | null;
  expiresAt: Date | null; createdAt: Date; updatedAt: Date;
}): MemoryRecord {
  return {
    id: row.id,
    kind: MemoryKindSchema.parse(row.kind),
    key: row.key,
    content: row.content,
    importance: row.importance,
    confidence: row.confidence,
    sourceTaskId: row.sourceTaskId,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export class MemoryStore {
  constructor(private readonly db: Db) {}

  // Keyed remember upserts: "user profile" rewritten ten times stays one row.
  // Unkeyed remember appends: episodes accumulate, recall ranks them.
  async remember(raw: RememberInput, db: Db = this.db): Promise<MemoryRecord> {
    const input = RememberSchema.parse(raw);
    const data = {
      content: input.content as Prisma.InputJsonValue,
      importance: input.importance,
      confidence: input.confidence,
      sourceTaskId: input.sourceTaskId ?? null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    };
    if (input.key !== undefined) {
      const row = await db.memory.upsert({
        where: { kind_key: { kind: input.kind, key: input.key } },
        create: { kind: input.kind, key: input.key, ...data },
        update: { ...data },
      });
      return toRecord(row);
    }
    const row = await db.memory.create({ data: { kind: input.kind, key: null, ...data } });
    return toRecord(row);
  }

  // Keyword over the JSON body + importance floor + expiry filter, ranked
  // importance-first/freshness-second. Semantic/vector ranking plugs in here
  // later without changing callers.
  async recall(raw: RecallQuery, db: Db = this.db): Promise<MemoryRecord[]> {
    const q = RecallSchema.parse(raw);
    const rows = await db.$queryRaw<
      {
        id: string; kind: string; key: string | null; content: Prisma.JsonValue;
        importance: number; confidence: number; sourceTaskId: string | null;
        expiresAt: Date | null; createdAt: Date; updatedAt: Date;
      }[]
    >(Prisma.sql`
      SELECT id, kind, key, content, importance, confidence,
             source_task_id AS "sourceTaskId", expires_at AS "expiresAt",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM memories
      WHERE (expires_at IS NULL OR expires_at > now())
        AND importance >= ${q.minImportance}
        ${q.kind === undefined ? Prisma.empty : Prisma.sql`AND kind = ${q.kind}`}
        ${q.query === undefined ? Prisma.empty : Prisma.sql`AND content::text ILIKE ${"%" + q.query + "%"}`}
      ORDER BY importance DESC, updated_at DESC
      LIMIT ${q.limit}
    `);
    return rows.map(toRecord);
  }

  async forget(id: string, db: Db = this.db): Promise<void> {
    await db.memory.delete({ where: { id } });
  }
}
