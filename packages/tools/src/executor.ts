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
  // Durable approvals (Phase 9): when present, Confirm verdicts park here and
  // return an approvalId; absent preserves the old message-only behavior.
  // Structural (not imported) so tools never depends on core's ApprovalStore.
  approvals?: {
    request(input: {
      toolName: string; input: unknown; actor: string;
      workerId?: string; taskId?: string; reason: string;
    }): Promise<{ id: string }>;
    get(id: string): Promise<{ status: string; toolName: string; input: unknown } | null>;
    resolvePending(id: string, status: "approved" | "denied"): Promise<boolean>;
    markExecuted(id: string, result: unknown, ok: boolean): Promise<void>;
  };
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
      let approvalId: string | null = null;
      if (this.opts.approvals !== undefined) {
        const approval = await this.opts.approvals.request({
          toolName: name,
          input,
          actor,
          ...(context.workerId !== undefined ? { workerId: context.workerId } : {}),
          ...(context.taskId !== undefined ? { taskId: context.taskId } : {}),
          reason,
        });
        approvalId = approval.id;
      }
      await this.opts.audit({
        ...base, ...ids, policy: "Confirm",
        result: "confirmation-required", detail: { reason },
      });
      return {
        success: false, error_code: "CONFIRMATION_REQUIRED", retryable: false,
        message: approvalId === null
          ? `needs human confirmation: ${reason}`
          : `parked for human confirmation (approval ${approvalId}): ${reason}`,
        ...(approvalId === null ? {} : { metadata: { approvalId } }),
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

  // Second half of human-in-the-loop: approve (or deny) a parked action.
  // Approve runs the tool NOW and records the outcome; deny runs nothing.
  // Double approval is a no-op returning the stored outcome shape, never a
  // second execution.
  async resolveApproval(id: string, approve: boolean, approver: string): Promise<ToolResult> {
    const port = this.opts.approvals;
    if (port === undefined) {
      return { success: false, error_code: "NO_APPROVAL_STORE", retryable: false, message: "approvals not configured" };
    }
    if (!approve) {
      const claimed = await port.resolvePending(id, "denied");
      return claimed
        ? { success: false, error_code: "DENIED_BY_HUMAN", retryable: false, message: `approval ${id} denied by ${approver}` }
        : { success: false, error_code: "ALREADY_RESOLVED", retryable: false, message: `approval ${id} already resolved` };
    }
    const approval = await port.get(id);
    if (approval === null || approval.status !== "pending") {
      return { success: false, error_code: "ALREADY_RESOLVED", retryable: false, message: `approval ${id} already resolved` };
    }
    const claimed = await port.resolvePending(id, "approved");
    if (!claimed) {
      return { success: false, error_code: "ALREADY_RESOLVED", retryable: false, message: `approval ${id} already resolved` };
    }
    let tool: Tool;
    try {
      tool = this.tools.get(approval.toolName);
    } catch {
      await port.markExecuted(id, { error: "tool no longer registered" }, false);
      return { success: false, error_code: "UNKNOWN_TOOL", retryable: false, message: `tool ${approval.toolName} gone` };
    }
    let result: ToolResult;
    try {
      result = await tool.execute(approval.input);
    } catch (err) {
      result = { success: false, error_code: "TOOL_CRASH", retryable: false, message: err instanceof Error ? err.message : "tool threw" };
    }
    await port.markExecuted(id, result, result.success);
    await this.opts.audit({
      who: approver, action: `tool.${approval.toolName}`, policy: "Confirm-approved",
      toolName: approval.toolName,
      result: result.success ? "ok" : (result.error_code ?? "failed"),
      detail: { approvalId: id },
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
