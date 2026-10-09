import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { MemoryStore } from "./store.js";

const TEST_URL = process.env["TEST_DATABASE_URL"];

// Written, not run (prototype rule): first execution in the test pass later.
describe.skipIf(!TEST_URL)("memory store (real Postgres)", () => {
  let db: PrismaClient;
  let store: MemoryStore;
  const created: string[] = [];

  beforeAll(() => {
    if (!TEST_URL) throw new Error("TEST_DATABASE_URL required");
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    store = new MemoryStore(db);
  });

  afterEach(async () => {
    if (created.length > 0) {
      await db.memory.deleteMany({ where: { id: { in: created } } });
      created.length = 0;
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("upserts keyed user facts instead of duplicating", async () => {
    const first = await store.remember({ kind: "user", key: "profile", content: { tz: "IST" } });
    created.push(first.id);
    const second = await store.remember({ kind: "user", key: "profile", content: { tz: "IST", lang: "en" } });
    expect(second.id).toBe(first.id);
    expect(await db.memory.count({ where: { kind: "user", key: "profile" } })).toBe(1);
  });

  it("ranks recall by importance, filters by kind/query/floor/expiry", async () => {
    const low = await store.remember({ kind: "episodic", content: { text: "ate lunch" }, importance: 0.1 });
    const high = await store.remember({ kind: "episodic", content: { text: "ate lunch with boss" }, importance: 0.9 });
    const dead = await store.remember({
      kind: "episodic", content: { text: "lunch expired" },
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    created.push(low.id, high.id, dead.id);
    const ranked = await store.recall({ kind: "episodic", query: "lunch" });
    expect(ranked.map((r) => r.id)).toEqual([high.id, low.id]);
    expect(ranked.find((r) => r.id === dead.id)).toBeUndefined();
    expect(await store.recall({ query: "lunch", minImportance: 0.5 })).toHaveLength(1);
  });

  it("forgets on demand", async () => {
    const m = await store.remember({ kind: "task", content: { text: "scratch" } });
    await store.forget(m.id);
    expect(await store.recall({ query: "scratch" })).toHaveLength(0);
  });
});
