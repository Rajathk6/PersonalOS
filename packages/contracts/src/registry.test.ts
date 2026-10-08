// Registry behavior: identity is name@version, overwrites are explicit,
// lookups are exact. Lifecycle edges mirror validateLifecycle in registry.ts.
import { describe, expect, it } from "vitest";
import { ContractError } from "./errors.js";
import { Registry, validateLifecycle } from "./registry.js";
import type { CapabilityState } from "./types.js";

interface Pkg {
  name: string;
  version: string;
  payload: number;
}

function pkg(version: string, payload = 1): Pkg {
  return { name: "finance", version, payload };
}

// Unwraps the ContractError code or fails the test when nothing is thrown.
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(ContractError);
    return (err as ContractError).code;
  }
  throw new Error("expected ContractError");
}

describe("Registry", () => {
  it("registers, gets, and lists entries", () => {
    const reg = new Registry<Pkg>();
    reg.register(pkg("1.0.0"));
    reg.register(pkg("2.0.0", 2));
    expect(reg.get("finance", "1.0.0")).toEqual(pkg("1.0.0"));
    expect(reg.get("finance", "2.0.0").payload).toBe(2);
    expect(reg.list()).toHaveLength(2);
    expect(reg.names()).toEqual(["finance"]);
    expect(reg.has("finance", "2.0.0")).toBe(true);
    expect(reg.has("finance", "9.9.9")).toBe(false);
  });

  it("rejects duplicate name+version without silent overwrite", () => {
    const reg = new Registry<Pkg>();
    reg.register(pkg("1.0.0"));
    expect(codeOf(() => reg.register(pkg("1.0.0", 99)))).toBe("DUPLICATE_REGISTRATION");
    expect(reg.get("finance", "1.0.0").payload).toBe(1); // original untouched
  });

  it("replaces an existing entry via explicit replace()", () => {
    const reg = new Registry<Pkg>();
    reg.register(pkg("1.0.0"));
    reg.replace(pkg("1.0.0", 42));
    expect(reg.get("finance", "1.0.0").payload).toBe(42);
    expect(codeOf(() => reg.replace(pkg("9.9.9")))).toBe("NOT_FOUND"); // no upserts
  });

  it("throws NOT_FOUND for unknown name or version", () => {
    const reg = new Registry<Pkg>();
    reg.register(pkg("1.0.0"));
    expect(codeOf(() => reg.get("jobs", "1.0.0"))).toBe("NOT_FOUND");
    expect(codeOf(() => reg.get("finance", "2.0.0"))).toBe("NOT_FOUND");
    expect(codeOf(() => reg.get("missing"))).toBe("NOT_FOUND");
  });

  it("accepts the full legal lifecycle path", () => {
    const edges: Array<[CapabilityState, CapabilityState]> = [
      ["DISCOVERED", "VALIDATING"],
      ["VALIDATING", "INSTALLED"],
      ["INSTALLED", "ENABLED"],
      ["ENABLED", "DISABLED"],
      ["DISABLED", "REMOVED"],
    ];
    for (const [from, to] of edges) {
      expect(() => validateLifecycle(from, to)).not.toThrow();
    }
  });

  it("rejects skipping validation (DISCOVERED -> INSTALLED)", () => {
    expect(codeOf(() => validateLifecycle("DISCOVERED", "INSTALLED"))).toBe("LIFECYCLE_VIOLATION");
  });

  it("rejects moving backwards (ENABLED -> VALIDATING)", () => {
    expect(codeOf(() => validateLifecycle("ENABLED", "VALIDATING"))).toBe("LIFECYCLE_VIOLATION");
  });

  it("rejects leaving the terminal state (REMOVED -> ENABLED)", () => {
    expect(codeOf(() => validateLifecycle("REMOVED", "ENABLED"))).toBe("LIFECYCLE_VIOLATION");
  });
});
