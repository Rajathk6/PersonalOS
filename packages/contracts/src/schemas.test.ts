// Schema conformance: valid boundary payloads parse, missing required
// fields fail, strict objects reject unknown keys, unions accept every kind.
import { describe, expect, it } from "vitest";
import {
  CapabilityManifestSchema,
  CapabilityStateSchema,
  EventEnvelopeSchema,
  MemoryRecordSchema,
  PermissionResultSchema,
  TaskSchema,
  ToolResultSchema,
} from "./schemas.js";

const AT = "2026-10-08T00:00:00.000Z";

const task = {
  id: "task-1", type: "expense.record", state: "created",
  input: { amount: 235 }, priority: 0, retryCount: 0, maxRetries: 3,
  requiredCapabilities: [], createdAt: AT, updatedAt: AT,
};

const toolResult = {
  success: false, error_code: "TIMEOUT", retryable: true, message: "timed out",
};

const manifest = {
  name: "finance", version: "0.1.0",
  actions: ["expense.record"], entities: ["transaction"], workflows: [],
  tools: ["db.query"], permissions: ["finance.write"], compat: { runtime: "personalos-0" },
};

const event = {
  channel: "task.created", id: "evt-1", at: AT, payload: { taskId: "task-1" },
};

const memory = {
  id: "mem-1", type: "working", content: { note: "oats over zomato" },
  relevance: 0.9, importance: 0.8, confidence: 0.7, freshness: AT,
};

describe("schemas", () => {
  it("parses a valid Task", () => {
    expect(TaskSchema.parse(task)).toMatchObject({ id: "task-1", state: "created" });
  });

  it("parses a valid ToolResult", () => {
    expect(ToolResultSchema.parse(toolResult).retryable).toBe(true);
  });

  it("parses a valid CapabilityManifest", () => {
    expect(CapabilityManifestSchema.parse(manifest).name).toBe("finance");
  });

  it("parses a valid PermissionResult", () => {
    expect(PermissionResultSchema.parse({ verdict: "Confirm" }).verdict).toBe("Confirm");
  });

  it("rejects a ToolResult missing error_code", () => {
    const { success, retryable, message } = toolResult;
    expect(() => ToolResultSchema.parse({ success, retryable, message })).toThrow();
  });

  it("rejects an unknown capability lifecycle value", () => {
    expect(() => CapabilityStateSchema.parse("FLYING")).toThrow();
  });

  it("rejects unknown keys on strict objects", () => {
    expect(() => TaskSchema.parse({ ...task, bogus: 1 })).toThrow();
    expect(() => EventEnvelopeSchema.parse({ ...event, bogus: 1 })).toThrow();
  });

  it("accepts all 6 memory kinds", () => {
    const kinds = ["working", "episodic", "semantic", "user", "procedural", "task"] as const;
    for (const type of kinds) {
      expect(() => MemoryRecordSchema.parse({ ...memory, type })).not.toThrow();
    }
  });
});
