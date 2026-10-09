import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { PrismaClient } from "@prisma/client";
import { FinanceStore, formatINR } from "./store.js";

const TEST_URL = process.env["TEST_DATABASE_URL"];

// Written, not run (prototype rule): integer-math determinism checks.
describe.skipIf(!TEST_URL)("finance store (real Postgres)", () => {
  let db: PrismaClient;
  let store: FinanceStore;

  beforeAll(() => {
    if (!TEST_URL) throw new Error("TEST_DATABASE_URL required");
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    store = new FinanceStore(db);
  });

  afterEach(async () => {
    await db.transaction.deleteMany({});
    await db.account.deleteMany({});
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it("sums integer paise exactly: 10000 - 235 - 99 = 9666", async () => {
    await store.createAccount("cash");
    await store.record("income", { account: "cash", amountPaise: 10000 });
    await store.record("expense", { account: "cash", amountPaise: 235, note: "chicken tikka" });
    await store.record("expense", { account: "cash", amountPaise: 99 });
    const s = await store.summary();
    expect(s.netWorthPaise).toBe(9666);
    expect(s.monthSpendPaise).toBe(334);
    expect(formatINR(9666)).toBe("₹96.66");
  });

  it("rejects unknown accounts and non-positive amounts", async () => {
    await expect(store.record("expense", { account: "nope", amountPaise: 100 })).rejects.toThrowError(/unknown account/);
    await expect(store.record("expense", { account: "cash", amountPaise: 0 })).rejects.toThrowError();
  });
});
