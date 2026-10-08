import { describe, expect, it } from "vitest";
import { assertTransition, canTransition } from "./transitions.js";

describe("task state machine", () => {
  it("allows the happy path created -> queued -> running -> done", () => {
    expect(canTransition("created", "queued")).toBe(true);
    expect(canTransition("queued", "running")).toBe(true);
    expect(canTransition("running", "done")).toBe(true);
  });

  it("allows retry requeue, network parking, and cancellation", () => {
    expect(canTransition("running", "queued")).toBe(true);
    expect(canTransition("running", "failed")).toBe(true);
    expect(canTransition("queued", "waiting_for_network")).toBe(true);
    expect(canTransition("waiting_for_network", "queued")).toBe(true);
    for (const from of ["created", "queued", "running", "waiting_for_network"] as const) {
      expect(canTransition(from, "cancelled")).toBe(true);
    }
  });

  it("forbids skipping queue, reviving terminals, and leaving park to running", () => {
    expect(canTransition("created", "running")).toBe(false);
    expect(canTransition("done", "queued")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
    expect(canTransition("cancelled", "queued")).toBe(false);
    expect(canTransition("waiting_for_network", "running")).toBe(false);
    expect(canTransition("done", "failed")).toBe(false);
  });

  it("assertTransition throws VALIDATION_FAILED on illegal edges", () => {
    expect(() => assertTransition("created", "running")).toThrowError(/created -> running/);
    expect(() => assertTransition("done", "queued")).toThrowError(/done -> queued/);
  });
});
