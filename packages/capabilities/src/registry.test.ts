import { describe, expect, it } from "vitest";
import { CapabilityRegistry, CORE_RUNTIME } from "./registry.js";

const good = {
  name: "demo",
  version: "0.1.0",
  actions: ["x"],
  entities: [],
  workflows: [],
  tools: [],
  permissions: [],
  compat: { runtime: CORE_RUNTIME },
};

// Written, not run (prototype rule).
describe("CapabilityRegistry", () => {
  it("installs a valid manifest through the lifecycle", async () => {
    const recorded: unknown[] = [];
    const registry = new CapabilityRegistry(async (m, enabled) => { recorded.push([m.name, enabled]); });
    const installed = await registry.install({ manifest: good, handlers: new Map(), tools: [] });
    expect(installed.name).toBe("demo");
    expect(registry.list().map((m) => m.name)).toEqual(["demo"]);
    expect(recorded).toEqual([["demo", true]]);
  });

  it("rejects bad manifests and incompatible runtimes", async () => {
    const registry = new CapabilityRegistry();
    await expect(
      registry.install({ manifest: { ...good, compat: { runtime: "other/9" } }, handlers: new Map(), tools: [] }),
    ).rejects.toThrowError(/INCOMPATIBLE|incompatible|needs/i);
    await expect(
      registry.install({ manifest: { ...good, name: "" }, handlers: new Map(), tools: [] }),
    ).rejects.toThrowError();
    await expect(
      registry.install({ manifest: good, handlers: new Map(), tools: [] }),
    ).resolves.toBeDefined();
    await expect(
      registry.install({ manifest: good, handlers: new Map(), tools: [] }),
    ).rejects.toThrowError(/already registered/);
  });
});
