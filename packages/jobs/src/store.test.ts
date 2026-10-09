import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { JobsStore, extractTitle, matchKeywords } from "./store.js";

const TEST_URL = process.env["TEST_DATABASE_URL"];

// Written, not run (prototype rule).
describe("matchKeywords + extractTitle (pure)", () => {
  it("matches case-insensitively, ignores empties", () => {
    expect(matchKeywords("Junior ENGINEER wanted", ["engineer", "", "syllabus"])).toEqual(["engineer"]);
    expect(matchKeywords("nothing here", ["engineer"])).toEqual([]);
  });

  it("pulls <title> with fallback", () => {
    expect(extractTitle("<html><title>SSC CGL 2026</title></html>", "u")).toBe("SSC CGL 2026");
    expect(extractTitle("no title here", "u")).toBe("u");
  });
});

describe.skipIf(!TEST_URL)("jobs store dedup (real Postgres)", () => {
  let db: PrismaClient;
  let store: JobsStore;

  beforeAll(() => {
    if (!TEST_URL) throw new Error("TEST_DATABASE_URL required");
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    store = new JobsStore(db);
  });

  afterEach(async () => {
    await db.jobFinding.deleteMany({});
    await db.jobWatch.deleteMany({});
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("stores a finding once no matter how often it is seen", async () => {
    const watch = await store.createWatch({ name: "eng", keywords: ["engineer"], sources: ["https://example.com/jobs"] });
    const candidate = {
      watchId: watch.id, sourceUrl: "https://example.com/jobs",
      title: "Junior Engineer", snippet: "x", matchedKeywords: ["engineer"],
    };
    expect(await store.recordFindings([candidate])).toHaveLength(1);
    expect(await store.recordFindings([candidate])).toHaveLength(0);
    expect(await db.jobFinding.count({})).toBe(1);
  });
});
