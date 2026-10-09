import type { CapabilityManifest } from "@personalos/contracts";

export interface Sanitized {
  manifest: CapabilityManifest;
  dropped: string[];
}

// Normalizes a drafted manifest against reality: unknown tools/permissions
// are dropped (never installed on faith), bad names are re-slugged from the
// description, runtime is pinned to ours. Every change is REPORTED as a
// review warning — normalization is visible, never silent.
export function sanitizeManifest(
  draft: CapabilityManifest,
  knownTools: string[],
  knownPermissions: string[],
  description: string,
): Sanitized {
  const dropped: string[] = [];
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter((w) => w !== "" && !["my", "a", "an", "the", "for", "with", "and", "to", "of"].includes(w))
    .slice(0, 4)
    .join("-") || "custom-domain";
  let name = draft.name;
  if (!/^[a-z0-9-]{1,60}$/.test(name)) {
    dropped.push(`name "${draft.name}" invalid, re-slugged to "${slug}"`);
    name = slug;
  }
  const version = /^\d+\.\d+\.\d+$/.test(draft.version) ? draft.version : "0.1.0";
  if (version !== draft.version) dropped.push(`version "${draft.version}" invalid, set to 0.1.0`);
  const tools = draft.tools.filter((t) => {
    if (!knownTools.includes(t)) {
      dropped.push(`unknown tool "${t}" dropped`);
      return false;
    }
    return true;
  });
  const permissions = draft.permissions.filter((p) => {
    if (!knownPermissions.includes(p)) {
      dropped.push(`unknown permission "${p}" dropped`);
      return false;
    }
    return true;
  });
  const actions = draft.actions.filter((a) => typeof a === "string" && a.length > 0).slice(0, 20);
  const entities = draft.entities.filter((e) => typeof e === "string" && e.length > 0).slice(0, 20);
  if (draft.compat.runtime !== "personalos/0") {
    dropped.push(`runtime "${draft.compat.runtime}" pinned to personalos/0`);
  }
  return {
    manifest: {
      name,
      version,
      actions,
      entities,
      workflows: [],
      tools,
      permissions,
      compat: { runtime: "personalos/0" },
    },
    dropped,
  };
}
