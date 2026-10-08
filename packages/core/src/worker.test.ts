import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import type { Queue, Task } from "@personalos/contracts";
import { WorkerHost } from "./worker.js";

// In-memory fake Queue: honors the contracts interface so the host is tested,
// not the database (real PG covered by queue.integration.test.ts).
function fakeQueue(runner: (task: Task) => void): Queue & { completed: unknown[]; failed: string[] } {
  const state = { completed: [] as unknown[], failed: [] as string[] };
  let done = false;
  return {
    ...state,
    enqueue: () => { throw new Error("not used in host tests"); },
    dequeue: async () => {
      if (done) return null;
      done = true;
      return {
        id: "task-1", type: "demo.ping", state: "running", input: {},
        priority: 0, retryCount: 0, maxRetries: 3, lease: null,
        requiredCapabilities: [], createdAt: "", updatedAt: "",
      } satisfies Task;
    },
    complete: async (_id: string, output: unknown) => { state.completed.push(output); },
    fail: async (_id: string, error: NonNullable<Task["error"]>) => { state.failed.push(error.code); runner({} as Task); },
    parkWaitingForNetwork: async () => undefined,
  };
}

const db = {
  worker: { upsert: vi.fn().mockResolvedValue({}), update: vi.fn().mockResolvedValue({}) },
} as unknown as PrismaClient;

function hostWith(queue: Queue, handlers: Map<string, (t: Task) => Promise<unknown>>): WorkerHost {
  return new WorkerHost(db, queue, {
    workerId: "w1", capabilities: [], pollMs: 5, heartbeatSeconds: 60, handlers,
  });
}

describe("WorkerHost", () => {
  it("completes a task through its registered handler", async () => {
    const queue = fakeQueue(() => undefined);
    const host = hostWith(queue, new Map([["demo.ping", async () => "pong"]]));
    await host.start();
    await vi.waitFor(() => expect(queue.completed).toEqual(["pong"]));
    await host.stop();
  });

  // Missing-handler path needs a real TaskRepository (DB-backed), so it is
  // covered in queue.integration.test.ts against real Postgres instead of
  // asserting against mocks here.

  it("routes handler errors through queue.fail for retry", async () => {
    let calls = 0;
    const queue = fakeQueue(() => { calls += 1; });
    const host = hostWith(
      queue,
      new Map([["demo.ping", async () => { throw new Error("boom"); }]]),
    );
    await host.start();
    await vi.waitFor(() => expect(queue.failed).toEqual(["HANDLER_ERROR"]));
    await host.stop();
    expect(calls).toBe(1);
  });

  it("stop() halts polling", async () => {
    const queue = fakeQueue(() => undefined);
    const dequeues = vi.spyOn(queue, "dequeue");
    const host = hostWith(queue, new Map([["demo.ping", async () => "pong"]]));
    await host.start();
    await vi.waitFor(() => expect(queue.completed).toEqual(["pong"]));
    await host.stop();
    const count = dequeues.mock.calls.length;
    await new Promise((r) => setTimeout(r, 30));
    expect(dequeues.mock.calls.length).toBe(count);
  });
});
