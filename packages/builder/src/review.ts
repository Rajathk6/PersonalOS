import type { CapabilityManifest, RiskLevel } from "@personalos/contracts";

export interface ReviewFinding {
  level: "error" | "warning";
  message: string;
}

export interface SecurityReview {
  passed: boolean;
  findings: ReviewFinding[];
}

export interface ReviewContext {
  knownTools: { name: string; risk: RiskLevel }[];
  knownPermissions: string[];
  installedNames: string[];
}

// Deterministic security review (no model judging models): every tool the
// manifest wants must exist, every permission must be known, high-risk tools
// require explicit human eyes, names must not collide. A FAILED review blocks
// installation — the user sees findings, not a silent no.
export function reviewManifest(manifest: CapabilityManifest, ctx: ReviewContext): SecurityReview {
  const findings: ReviewFinding[] = [];
  if (ctx.installedNames.includes(manifest.name)) {
    findings.push({ level: "error", message: `capability ${manifest.name} is already installed` });
  }
  for (const tool of manifest.tools) {
    const known = ctx.knownTools.find((t) => t.name === tool);
    if (!known) {
      findings.push({ level: "error", message: `unknown tool ${tool} — add the tool first, never on faith` });
      continue;
    }
    if (known.risk === "High" || known.risk === "Critical") {
      findings.push({ level: "warning", message: `tool ${tool} is ${known.risk}-risk: confirm deliberately` });
    }
  }
  for (const permission of manifest.permissions) {
    if (!ctx.knownPermissions.includes(permission)) {
      findings.push({ level: "error", message: `unknown permission ${permission}` });
    }
  }
  if (manifest.compat.runtime !== "personalos/0") {
    findings.push({ level: "error", message: `unsupported runtime ${manifest.compat.runtime}` });
  }
  return { passed: !findings.some((f) => f.level === "error"), findings };
}
