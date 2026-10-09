import { describe, expect, it, vi } from "vitest";
import { Scheduler } from "./scheduler.js";

// Written, not run (prototype rule): executed in the first test pass later.
// Fake Prisma surface: only what Scheduler touches.
interface FakeJob {
  name: string;
  schedule: string;
  payload: unknown;
  enabled: boolean;
  lastCheckpoint: Date | null;
  lastTaskId: string | null;
}

function fakeDb(jobs: FakeJob[]) {
  return {
    scheduledJob: {
      // Re-filter per call: findMany must see disables, like real Postgres.
      findMany: vi.fn().mockImplementation(async () => jobs.filter((j) => j.enabled)),
      update: vi.fn().mockImplementation(async ({ where, data }: { where: { name: string }; data: Partial<FakeJob> }) => {
        const job = jobs.find((j) => j.name === where.name);
        if (!job) throw new Error("missing");
        Object.assign(job, data);
        return job;
      }),
    },
  };
}

describe("Scheduler", () => {
  it("fires a due job once and advances its checkpoint", async () => {
    const jobs: FakeJob[] = [{
      name: "morning",
      schedule: JSON.stringify({ kind: "every", seconds: 60 }),
      payload: { taskType: "reminder.send", taskInput: { text: "stand" } },
      enabled: true, lastCheckpoint: null, lastTaskId: null,
    }];
    const enqueued: unknown[] = [];
    const sched = new Scheduler(fakeDb(jobs) as never, {
      pollMs: 5,
      enqueue: async (t) => { enqueued.push(t); return { id: "t1" }; },
    });
    sched.start();
    await vi.waitFor(() => expect(enqueued.length).toBe(1));
    await sched.stop();
    expect(jobs[0]?.lastTaskId).toBe("t1");
    expect(jobs[0]?.lastCheckpoint).toBeInstanceOf(Date);
  });

  it("covers an outage with one task carrying missedPeriods, not replays", async () => {
    const jobs: FakeJob[] = [{
      name: "outage",
      schedule: JSON.stringify({ kind: "every", seconds: 60 }),
      payload: { taskType: "reminder.send", taskInput: { text: "stand" } },
      enabled: true,
      lastCheckpoint: new Date(Date.now() - 5 * 60 * 1000),
      lastTaskId: null,
    }];
    const enqueued: { input: unknown }[] = [];
    const sched = new Scheduler(fakeDb(jobs) as never, {
      pollMs: 5,
      enqueue: async (t) => { enqueued.push(t); return { id: "t9" }; },
    });
    sched.start();
    await vi.waitFor(() => expect(enqueued.length).toBe(1));
    await sched.stop();
    expect(enqueued.length).toBe(1);
    expect(enqueued[0]?.input).toMatchObject({ _catchup: { missedPeriods: 4 } });
  });

  it("disables one-shot jobs after firing and skips disabled ones", async () => {
    const jobs: FakeJob[] = [{
      name: "once",
      schedule: JSON.stringify({ kind: "once", at: new Date(Date.now() - 1000).toISOString() }),
      payload: { taskType: "reminder.send", taskInput: { text: "x" } },
      enabled: true, lastCheckpoint: null, lastTaskId: null,
    }];
    let fires = 0;
    const sched = new Scheduler(fakeDb(jobs) as never, {
      pollMs: 5,
      enqueue: async () => { fires += 1; return { id: "t" }; },
    });
    sched.start();
    await vi.waitFor(() => expect(jobs[0]?.enabled).toBe(false));
    await new Promise((r) => setTimeout(r, 30));
    await sched.stop();
    expect(fires).toBe(1);
  });

  it("disables poisoned schedules instead of spinning", async () => {
    const jobs: FakeJob[] = [{
      name: "bad", schedule: "{oops", payload: {}, enabled: true, lastCheckpoint: null, lastTaskId: null,
    }];
    const errors: unknown[] = [];
    const sched = new Scheduler(fakeDb(jobs) as never, {
      pollMs: 5,
      enqueue: async () => ({ id: "t" }),
      onError: (e) => { errors.push(e); },
    });
    sched.start();
    await vi.waitFor(() => expect(jobs[0]?.enabled).toBe(false));
    await sched.stop();
    expect(errors.length).toBeGreaterThan(0);
  });
});
