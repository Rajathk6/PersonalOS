// In-memory registry only: durability belongs to 0C repositories, so this
// class holds no singletons and performs no I/O — one instance per owner.
import { ContractError } from "./errors.js";
import type { CapabilityState } from "./types.js";

// Key is name@version so one name can carry several versions side by side.
function key(name: string, version: string): string {
  return `${name}@${version}`;
}

export class Registry<T extends { name: string; version: string }> {
  private readonly entries = new Map<string, T>();

  // Never silently overwrites: same name+version twice is a caller bug.
  register(entry: T): void {
    const k = key(entry.name, entry.version);
    if (this.entries.has(k)) {
      throw new ContractError(
        "DUPLICATE_REGISTRATION",
        `${k} already registered; use replace() for explicit overwrite`,
      );
    }
    this.entries.set(k, entry);
  }

  // Explicit overwrite path; throws when nothing exists so typos can't upsert.
  replace(entry: T): void {
    const k = key(entry.name, entry.version);
    if (!this.entries.has(k)) {
      throw new ContractError("NOT_FOUND", `${k} not registered; register() first`);
    }
    this.entries.set(k, entry);
  }

  // Version omitted only resolves when exactly one version exists, so callers
  // pin versions explicitly until range support lands beyond Phase 0.
  get(name: string, version?: string): T {
    if (version !== undefined) {
      const found = this.entries.get(key(name, version));
      if (found === undefined) {
        throw new ContractError("NOT_FOUND", `${name}@${version} not registered`);
      }
      return found;
    }
    const matches = [...this.entries.values()].filter((e) => e.name === name);
    const only = matches.length === 1 ? matches[0] : undefined;
    if (only === undefined) {
      throw new ContractError(
        "NOT_FOUND",
        matches.length === 0
          ? `${name} not registered`
          : `${name} has ${matches.length} versions; pass an exact version`,
      );
    }
    return only;
  }

  list(): T[] {
    return [...this.entries.values()];
  }

  names(): string[] {
    return [...new Set(this.list().map((e) => e.name))];
  }

  has(name: string, version?: string): boolean {
    try {
      this.get(name, version);
      return true;
    } catch {
      return false;
    }
  }
}

// Edges follow the NORTH_STAR chain; DISABLED/UPDATED return to ENABLED so a
// capability resumes service without reinstalling from DISCOVERED.
const ALLOWED: Record<CapabilityState, readonly CapabilityState[]> = {
  DISCOVERED: ["VALIDATING"],
  VALIDATING: ["INSTALLED"],
  INSTALLED: ["ENABLED"],
  ENABLED: ["DISABLED", "UPDATED", "REMOVED"],
  DISABLED: ["ENABLED", "UPDATED", "REMOVED"],
  UPDATED: ["ENABLED"],
  REMOVED: [],
};

export function validateLifecycle(from: CapabilityState, to: CapabilityState): void {
  const next = ALLOWED[from] ?? [];
  if (!next.includes(to)) {
    throw new ContractError(
      "LIFECYCLE_VIOLATION",
      `illegal capability transition ${from} -> ${to}`,
    );
  }
}
