import type { PermissionEngine, PermissionRequest, PermissionVerdict } from "@personalos/contracts";
import { decidePolicy } from "./policy.js";

// The security boundary (ADR-007): models propose, this disposes. Pure
// function over the policy table — no I/O, no model calls, no exceptions for
// policy outcomes (Denied is a verdict, not a crash).
export class DefaultPermissionEngine implements PermissionEngine {
  async evaluate(req: PermissionRequest): Promise<PermissionVerdict> {
    return decidePolicy(req).verdict;
  }

  async evaluateWithReason(req: PermissionRequest): Promise<{ verdict: PermissionVerdict; reason: string }> {
    return decidePolicy(req);
  }
}
