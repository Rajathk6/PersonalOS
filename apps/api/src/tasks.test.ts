import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import type { RunningService } from "./bootstrap.js";

const TEST_URL = process.env["TEST_DATABASE_URL"];
const TOKEN = "test-token-1a";

// Full vertical slice against real Postgres + real HTTP: POST a task, watch
// the in-process worker finish it, read it back. Module imports are dynamic
// so env (DATABASE_URL/API_TOKEN for config/auth) is set before app modules
// evaluate — static imports would hoist above these assignments.
describe.skipIf(!TEST_URL)("task routes + worker slice", () => {
  let prisma: PrismaClient;
  let svc: RunningService;
  let base: string;
  const created: string[] = [];

  const api = async (path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> => {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${TOKEN}`, ...(init?.headers ?? {}) },
    });
    return { status: res.status, body: (await res.json()) as unknown };
  };

  beforeAll(async () => {
    if (!TEST_URL) throw new Error("TEST_DATABASE_URL required");
    process.env["DATABASE_URL"] = TEST_URL;
    process.env["API_TOKEN"] = TOKEN;
    prisma = new PrismaClient({ datasourceUrl: TEST_URL });
    const { bootstrap } = await import("./bootstrap.js");
    svc = await bootstrap(prisma, {
      port: 0,
      workerEnabled: true,
      workerId: "test-worker",
      capabilities: [],
      pollMs: 10,
      heartbeatSeconds: 60,
      leaseSeconds: 30,
      ollamaUrl: "http://127.0.0.1:1",
      modelTimeoutMs: 1000,
      defaultModel: "qwen2.5:3b",
      openRouterKey: null,
      openRouterUrl: "https://openrouter.ai/api/v1",
      schedulerEnabled: false,
      schedulerPollMs: 50,
      workerTokens: new Map(),
      livenessSweepS: 60,
      offlineAfterS: 120,
      workspaceDir: mkdtempSync(path.join(tmpdir(), "pos-test-ws-")),
    });
    base = `http://127.0.0.1:${svc.port}`;
  });

  afterEach(async () => {
    if (created.length > 0) {
      await prisma.task.deleteMany({ where: { id: { in: created } } });
      created.length = 0;
    }
  });

  afterAll(async () => {
    await svc.stop();
  });

  it("creates a task (201) and reads it back", async () => {
    const { status, body } = await api("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "reminder.send", input: { text: "stand up" } }),
    });
    expect(status).toBe(201);
    const id = (body as { id: string }).id;
    created.push(id);
    const got = await api(`/tasks/${id}`);
    expect(got.status).toBe(200);
    expect((got.body as { type: string }).type).toBe("reminder.send");
  });

  it("rejects unauthenticated, invalid, and missing tasks", async () => {
    const anon = await fetch(`${base}/tasks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(anon.status).toBe(401);
    const bad = await api("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input: {} }),
    });
    expect(bad.status).toBe(400);
    expect(await (await api("/tasks/00000000-0000-0000-0000-000000000000")).status).toBe(404);
  });

  it("runs a reminder end to end: queued -> done with delivery output", async () => {
    const { body } = await api("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "reminder.send", input: { text: "leave at 6" } }),
    });
    const id = (body as { id: string }).id;
    created.push(id);
    await vi.waitFor(async () => {
      const got = await api(`/tasks/${id}`);
      expect((got.body as { state: string }).state).toBe("done");
    });
    const final = (await api(`/tasks/${id}`)).body as {
      output: { channel: string; text: string };
    };
    expect(final.output.channel).toBe("log");
    expect(final.output.text).toBe("leave at 6");
  });

  it("cancels a future task; cancelling done is a 409", async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const { body } = await api("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "reminder.send", input: { text: "later" }, notBefore: future }),
    });
    const id = (body as { id: string }).id;
    created.push(id);
    const cancelled = await api(`/tasks/${id}/cancel`, { method: "POST" });
    expect(cancelled.status).toBe(200);
    expect((cancelled.body as { state: string }).state).toBe("cancelled");

    const quick = await api("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "reminder.send", input: { text: "now" } }),
    });
    const quickId = ((quick.body as { id: string }).id);
    created.push(quickId);
    await vi.waitFor(async () => {
      const got = await api(`/tasks/${quickId}`);
      expect((got.body as { state: string }).state).toBe("done");
    });
    expect((await api(`/tasks/${quickId}/cancel`, { method: "POST" })).status).toBe(409);
  });

  it("lists tasks filtered by state", async () => {
    const { body } = await api("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "reminder.send",
        input: { text: "list me" },
        notBefore: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    });
    const id = (body as { id: string }).id;
    created.push(id);
    const listed = (await api("/tasks?state=queued")).body as { tasks: { id: string }[] };
    expect(listed.tasks.map((t) => t.id)).toContain(id);
  });

  it("reports a live database and an enabled worker on /health", async () => {
    const got = await api("/health");
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ status: "ok", db: "online", worker: "enabled" });
  });
});
