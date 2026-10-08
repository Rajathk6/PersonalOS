import type { PermissionRequest, PermissionVerdict, RiskLevel } from "@personalos/contracts";

// Default policy table (NORTH_STAR §Permissions). Code, not config, for now:
// it versions with Core and moves to capability manifests in Phase 7.
// Convention: fs tools carry { path } in argsSummary; shell carries { command }.
export interface PolicyRule {
  tool: string; // exact name or prefix "fs.*"
  verdict: PermissionVerdict;
  reason: string;
}

const DEFAULTS: PolicyRule[] = [
  { tool: "web.fetch", verdict: "Allowed", reason: "read-only public web fetch within caps" },
  { tool: "filesystem.read", verdict: "Allowed", reason: "reads inside the workspace are low-risk" },
  { tool: "filesystem.write", verdict: "Allowed", reason: "writes inside the workspace are reversible" },
  { tool: "git.status", verdict: "Allowed", reason: "read-only" },
  { tool: "git.log", verdict: "Allowed", reason: "read-only" },
  { tool: "filesystem.delete", verdict: "Confirm", reason: "deletion needs a human" },
  { tool: "shell.execute", verdict: "Confirm", reason: "shell always needs a human unless denied outright" },
];

const DESTRUCTIVE = [
  /\brm\s+-rf?\s+(\/|~|\$HOME|\*)/,
  /\b(mkfs|dd\s+.*of=|shutdown|reboot|halt|poweroff)\b/,
  /:\(\)\s*{\s*:\s*\|\s*:\s*&\s*}\s*;?\s*:/, // fork bomb
  /\b(chmod\s+-R\s+777|chown\s+-R)\s+\//,
];

export function isDestructiveCommand(command: string): boolean {
  return DESTRUCTIVE.some((re) => re.test(command));
}

export function decidePolicy(req: PermissionRequest): { verdict: PermissionVerdict; reason: string } {
  // Destructive shell is denied outright — no human prompt can bless `rm -rf /`.
  if (req.tool === "shell.execute") {
    const command = (req.argsSummary as { command?: unknown } | null)?.command;
    if (typeof command === "string" && isDestructiveCommand(command)) {
      return { verdict: "Denied", reason: "matches destructive-command denylist" };
    }
  }
  // Outside-workspace filesystem access is never automatic: the engine cannot
  // tell a user file from a PersonalOS file yet (provenance lands Phase 7+),
  // so a human decides. Tools report insideWorkspace in argsSummary.
  if (req.tool.startsWith("filesystem.")) {
    const summary = (req.argsSummary ?? {}) as { insideWorkspace?: unknown };
    if (summary.insideWorkspace === false) {
      return {
        verdict: req.tool === "filesystem.delete" ? "Denied" : "Confirm",
        reason: "path escapes the workspace; delete-outside is denied, else ask",
      };
    }
  }
  const rule = DEFAULTS.find((r) => r.tool === req.tool);
  if (rule) return { verdict: rule.verdict, reason: rule.reason };
  // Unknown tools default-deny: adding a tool without a policy entry must be
  // a loud failure, never a silent permission.
  return { verdict: "Denied", reason: `no policy entry for tool ${req.tool}` };
}

export function riskOf(tool: string): RiskLevel {
  if (tool === "web.fetch" || tool === "filesystem.read" || tool.startsWith("git.")) return "Low";
  if (tool === "filesystem.write") return "Medium";
  return "High";
}
