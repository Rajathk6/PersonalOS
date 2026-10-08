import type {
  PermissionRequest,
  Tool,
  ToolResult,
} from "@personalos/contracts";
import type { DefaultPermissionEngine } from "./engine.js";
import { resolveInside } from "./fs-tools.js";
import type { ToolRegistry } from "./tool-registry.js";

export interface AuditSink {
  (entry: {
    who: string;
    action: string;
    policy: string;
    workerId?: string;
    toolName: string;
    taskId?: string;
    result: string;
    detail: Record<string, unknown>;
  }): Promise<void>;
}

export interface ExecutorOptions {
  sandboxRoot: string; // workspace dir; enriches filesystem verdicts with insideWorkspace
  audit: AuditSink;
}

// The gate (ARCHITECTURE §2/§7): no tool runs without a verdict. Confirm
// verdicts do NOT execute — they return CONFIRMATION_REQUIRED so the caller
// (later: approval queue + phone) can park the action. Durable approvals land
// with scheduler/phone phases; nothing here invents an approval.
export class ToolExecutor {
  constructor(
    private readonly tools: ToolRegistry,
    private readonly engine: DefaultPermissionEngine,
    private readonly opts: ExecutorOptions,
  ) {}

  async execute(
    name: string,
    input: unknown,
    actor: PermissionRequest["actor"],
    context: { workerId?: string; taskId?: string; capability?: string } = {},
  ): Promise<ToolResult> {
    let tool: Tool;
    try {
      tool = this.tools.get(name);
    } catch {
      // Probes count too: an unknown tool name is itself audit-worthy.
      await this.opts.audit({
        who: actor, action: `tool.${name}`, policy: "Denied", toolName: name,
        result: "unknown-tool", detail: { reason: "not registered" },
      });
      return { success: false, error_code: "UNKNOWN_TOOL", retryable: false, message: `unknown tool ${name}` };
    }
    const argsSummary = this.summarize(name, input);
    const req: PermissionRequest = {
      tool: name,
      risk: tool.risk,
      argsSummary,
      actor,
      ...(context.capability !== undefined ? { capability: context.capability } : {}),
    };
    // Engine decides; policy table explains. Both recorded for audit.
    const { verdict, reason } = await this.engine.evaluateWithReason(req);
    const base = { who: actor, action: `tool.${name}` };
    const ids = {
      ...(context.workerId !== undefined ? { workerId: context.workerId } : {}),
      toolName: name,
      ...(context.taskId !== undefined ? { taskId: context.taskId } : {}),
    };
    if (verdict === "Denied") {
      await this.opts.audit({
        ...base, ...ids, policy: "Denied",
        result: "denied", detail: { reason },
      });
      return { success: false, error_code: "DENIED", retryable: false, message: `denied: ${reason}` };
    }
    if (verdict === "Confirm") {
      await this.opts.audit({
        ...base, ...ids, policy: "Confirm",
        result: "confirmation-required", detail: { reason },
      });
      return {
        success: false, error_code: "CONFIRMATION_REQUIRED", retryable: false,
        message: `needs human confirmation: ${reason}`,
      };
    }
    let result: ToolResult;
    try {
      result = await tool.execute(input);
    } catch (err) {
      result = {
        success: false, error_code: "TOOL_CRASH", retryable: false,
        message: err instanceof Error ? err.message : "tool threw",
      };
    }
    await this.opts.audit({
      ...base, ...ids, policy: "Allowed",
      result: result.success ? "ok" : (result.error_code ?? "failed"),
      detail: { reason },
    });
    return result;
  }

  private summarize(name: string, input: unknown): unknown {
    if (name.startsWith("filesystem.") && typeof input === "object" && input !== null && "path" in input) {
      const rel = (input as { path: unknown }).path;
      if (typeof rel === "string") {
        const { inside } = resolveInside(this.opts.sandboxRoot, rel);
        return { ...(input as Record<string, unknown>), insideWorkspace: inside };
      }
    }
    return input;
  }
}
