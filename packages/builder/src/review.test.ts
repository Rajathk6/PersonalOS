import { describe, expect, it } from "vitest";
import { reviewManifest } from "./review.js";
import type { CapabilityManifest } from "@personalos/contracts";

const base: CapabilityManifest = {
  name: "reading",
  version: "0.1.0",
  actions: ["book.finish"],
  entities: ["book"],
  workflows: [],
  tools: ["filesystem.write"],
  permissions: ["fs.write"],
  compat: { runtime: "personalos/0" },
};

const ctx = {
  knownTools: [{ name: "filesystem.write", risk: "Medium" as const }, { name: "shell.execute", risk: "High" as const }],
  knownPermissions: ["fs.write", "fs.read"],
  installedNames: ["finance"],
};

// Written, not run (prototype rule).
describe("reviewManifest", () => {
  it("passes a clean manifest", () => {
    const r = reviewManifest(base, ctx);
    expect(r.passed).toBe(true);
    expect(r.findings).toHaveLength(0);
  });

  it("errors on unknown tools/permissions, collisions, runtimes", () => {
    const bad = reviewManifest(
      { ...base, name: "finance", tools: ["nope.tool"], permissions: ["nope.perm"], compat: { runtime: "other/9" } },
      ctx,
    );
    expect(bad.passed).toBe(false);
    expect(bad.findings.filter((f) => f.level === "error")).toHaveLength(4);
  });

  it("warns (not errors) on high-risk tools", () => {
    const r = reviewManifest({ ...base, tools: ["shell.execute"] }, ctx);
    expect(r.passed).toBe(true);
    expect(r.findings[0]?.level).toBe("warning");
  });
});
