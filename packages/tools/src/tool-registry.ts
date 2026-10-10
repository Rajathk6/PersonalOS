import type { Tool } from "@personalos/contracts";
import { ContractError } from "@personalos/contracts";

// Tools are versioned like capabilities (one name, many versions side by
// side); unversioned get() resolves only when exactly one version exists,
// mirroring the contracts Registry behavior callers already know.
export class ToolRegistry {
  private readonly entries = new Map<string, Tool & { version: string }>();

  register(tool: Tool & { version: string }): void {
    const key = `${tool.name}@${tool.version}`;
    if (this.entries.has(key)) {
      throw new ContractError("DUPLICATE_REGISTRATION", `${key} already registered`);
    }
    this.entries.set(key, tool);
  }

  get(name: string, version?: string): Tool & { version: string } {
    if (version !== undefined) {
      const found = this.entries.get(`${name}@${version}`);
      if (found === undefined) throw new ContractError("NOT_FOUND", `${name}@${version} not registered`);
      return found;
    }
    const matches = [...this.entries.values()].filter((t) => t.name === name);
    if (matches.length !== 1) {
      throw new ContractError(
        "NOT_FOUND",
        matches.length === 0 ? `${name} not registered` : `${name} has ${matches.length} versions; pass an exact version`,
      );
    }
    const only = matches[0];
    if (only === undefined) throw new ContractError("NOT_FOUND", `${name} not registered`);
    return only;
  }

  list(): { name: string; version: string; description: string; risk: string; inputSchema: unknown }[] {
    return [...this.entries.values()].map((t) => ({
      name: t.name,
      version: t.version,
      description: t.description,
      risk: t.risk,
      inputSchema: t.inputSchema,
    }));
  }
}
