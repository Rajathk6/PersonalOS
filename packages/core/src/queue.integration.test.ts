import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { PgQueue } from "./queue.js";
import { TaskRepository } from "./task-store.js";
import { WorkerHost } from "./worker.js";
import { recoverOnBoot } from "./recovery.js";

const TEST_URL = process.env["TEST_DATABASE_URL"];

// Loud skip (not silent pass): without its own database these tests refuse to
// run, because pointing them at the dev DB would pollute real work.
// Local: CREATE DATABASE personalos_test + migrate deploy, then export TEST_DATABASE_URL.
// CI provides it via the postgres service.
describe.skipIf(!TEST_URL)("queue + recovery (real Postgres)", () => {
  let db: PrismaClient;
  let store: TaskRepository;
  let queue: PgQueue;
  const created: string[] = [];

  beforeAll(() => {
    if (!TEST_URL) throw new Error("TEST_DATABASE_URL is required for integration tests");
    db = new PrismaClient({ datasourceUrl: TEST_URL });
    store = new TaskRepository(db);
    queue = new PgQueue(db, 60);
  });

  afterEach(async () => {
    if (created.length > 0) {
      await db.task.deleteMany({ where: { id: { in: created } } });
      created.length = 0;
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  async function enqueued(type: string, extra: Record<string, unknown> = {}) {
    const t = await queue.enqueue({ type, input: {}, priority: 0, ...extra });
    created.push(t.id);
    return t;
  }

  it("leases to one worker; a second dequeue skips the leased row", async () => {
    const t = await enqueued("demo.ping");
    const mine = await queue.dequeue({ id: "w1", capabilities: [], auth: "test" });
    expect(mine?.id).toBe(t.id);
    expect(mine?.lease?.workerId).toBe("w1");
    expect(await queue.dequeue({ id: "w2", capabilities: [], auth: "test" })).toBeNull();
  });

  it("matches requiredCapabilities against the worker", async () => {
    const createdTask = await store.create({
      type: "demo.heavy", input: {}, requiredCapabilities: ["local_llm"],
    });
    created.push(createdTask.id);
    await store.transition(createdTask.id, "queued");
    const light = await queue.dequeue({ id: "w-light", capabilities: [], auth: "test" });
    expect(light).toBeNull();
    const heavy = await queue.dequeue({ id: "w-gpu", capabilities: ["local_llm"], auth: "test" });
    expect(heavy?.id).toBe(createdTask.id);
  });

  it("survives a worker crash: expired lease is redelivered with retryCount+1", async () => {
    const t = await enqueued("demo.ping");
    await queue.dequeue({ id: "crasher", capabilities: [], auth: "test" });
    // Simulate the crash: worker dies holding the lease; on reboot the lease
    // is long expired, so recovery must hand the task to someone else.
    await db.task.update({
      where: { id: t.id },
      data: { leaseExpiresAt: new Date(Date.now() - 60_000) },
    });
    const report = await recoverOnBoot(db, 60);
    expect(report.requeued).toBe(1);
    const again = await queue.dequeue({ id: "w2", capabilities: [], auth: "test" });
    if (again === null) throw new Error("expected redelivery after recovery");
    expect(again.id).toBe(t.id);
    expect(again.retryCount).toBe(1);
    await queue.complete(again.id, "done-after-crash");
    expect((await store.get(t.id)).state).toBe("done");
  });

  it("terminally fails when the retry budget is exhausted", async () => {
    const createdTask = await store.create({ type: "demo.flaky", input: {}, maxRetries: 0 });
    created.push(createdTask.id);
    await store.transition(createdTask.id, "queued");
    await queue.dequeue({ id: "w1", capabilities: [], auth: "test" });
    await queue.fail(createdTask.id, { code: "BOOM", retryable: true, message: "boom" });
    const final = await store.get(createdTask.id);
    expect(final.state).toBe("failed");
    expect(final.error?.code).toBe("BOOM");
  });

  it("idempotent create returns the same row, never a duplicate", async () => {
    const first = await store.create({ type: "demo.once", input: { n: 1 }, idempotencyKey: "k-1" });
    created.push(first.id);
    const second = await store.create({ type: "demo.once", input: { n: 1 }, idempotencyKey: "k-1" });
    expect(second.id).toBe(first.id);
    expect(await db.task.count({ where: { idempotencyKey: "k-1" } })).toBe(1);
  });

  it("leaves waiting_for_network rows parked during recovery", async () => {
    const createdTask = await store.create({ type: "demo.offline", input: {} });
    created.push(createdTask.id);
    await store.transition(createdTask.id, "queued");
    await store.transition(createdTask.id, "waiting_for_network");
    const report = await recoverOnBoot(db, 60);
    expect(report.parkedWaiting).toBe(1);
    expect((await store.get(createdTask.id)).state).toBe("waiting_for_network");
  });

  it("fails a task fast when no handler is registered", async () => {
    const t = await enqueued("demo.unknown-type");
    const host = new WorkerHost(db, queue, {
      workerId: "w1", capabilities: [], pollMs: 5, heartbeatSeconds: 60, handlers: new Map(),
    });
    await host.start();
    await vi.waitFor(async () => expect((await store.get(t.id)).state).toBe("failed"));
    const final = await store.get(t.id);
    expect(final.error?.code).toBe("HANDLER_MISSING");
    expect(final.retryCount).toBe(0);
    await host.stop();
  });
});
