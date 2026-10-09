import { describe, expect, it } from "vitest";
import type { Tool } from "@personalos/contracts";
import { DefaultPermissionEngine } from "./engine.js";
import { ToolExecutor } from "./executor.js";
import { ToolRegistry } from "./tool-registry.js";

// Written, not run (prototype rule): approval parking + double-tap safety.
describe("approval flow", () => {
  function setup() {
    const registry = new ToolRegistry();
    const gated: Tool & { version: string } = {
      name: "shell.execute",
      version: "1.0",
      description: "gated",
      inputSchema: {},
      requiredPermission: "shell.execute",
      risk: "High",
      execute: async () => ({ success: true, error_code: null, retryable: false, message: "ran" }),
    };
    registry.register(gated);
    const approvals = new Map<string, { status: string; toolName: string; input: unknown }>();
    let n = 0;
    const port = {
      request: async (input: { toolName: string; input: unknown; actor: string; reason: string }) => {
        const id = `a${(n += 1)}`;
        approvals.set(id, { status: "pending", toolName: input.toolName, input: input.input });
        return { id };
      },
      get: async (id: string) => approvals.get(id) ?? null,
      resolvePending: async (id: string, status: "approved" | "denied") => {
        const a = approvals.get(id);
        if (!a || a.status !== "pending") return false;
        a.status = status;
        return true;
      },
      markExecuted: async (id: string) => {
        approvals.get(id)!.status = "executed";
      },
    };
    const executor = new ToolExecutor(registry, new DefaultPermissionEngine(), {
      sandboxRoot: "/tmp",
      approvals: port,
      audit: async () => undefined,
    });
    return { executor, approvals };
  }

  it("parks Confirm tools and executes once on approve", async () => {
    const { executor } = setup();
    const parked = await executor.execute("shell.execute", { command: "echo hi" }, "user");
    expect(parked.error_code).toBe("CONFIRMATION_REQUIRED");
    const id = (parked.metadata as { approvalId: string }).approvalId;
    const done = await executor.resolveApproval(id, true, "phone");
    expect(done.success).toBe(true);
    const again = await executor.resolveApproval(id, true, "phone");
    expect(again.error_code).toBe("ALREADY_RESOLVED");
  });

  it("deny runs nothing", async () => {
    const { executor } = setup();
    const parked = await executor.execute("shell.execute", { command: "echo hi" }, "user");
    const id = (parked.metadata as { approvalId: string }).approvalId;
    const denied = await executor.resolveApproval(id, false, "phone");
    expect(denied.error_code).toBe("DENIED_BY_HUMAN");
  });
});
