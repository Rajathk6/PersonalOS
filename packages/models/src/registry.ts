import type { ModelMetadata, ModelProvider } from "@personalos/contracts";
import { ContractError } from "@personalos/contracts";

export interface RegisteredModel {
  metadata: ModelMetadata;
  provider: ModelProvider;
}

// Which model exists and where it runs (NORTH_STAR §21-22). One entry per
// model id; providers are instances so tests can inject fakes.
export class ModelRegistry {
  private readonly entries = new Map<string, RegisteredModel>();

  register(entry: RegisteredModel): void {
    if (this.entries.has(entry.metadata.id)) {
      throw new ContractError("DUPLICATE_REGISTRATION", `${entry.metadata.id} already registered`);
    }
    this.entries.set(entry.metadata.id, entry);
  }

  get(modelId: string): RegisteredModel {
    const found = this.entries.get(modelId);
    if (found === undefined) throw new ContractError("NOT_FOUND", `model ${modelId} not registered`);
    return found;
  }

  list(): ModelMetadata[] {
    return [...this.entries.values()].map((e) => e.metadata);
  }
}

export interface RouteHints {
  privacySensitive?: boolean; // true -> local models only
  needsToolCalling?: boolean;
  needsLongContext?: boolean; // >8k tokens
  prefersCoding?: boolean;
}

// Picks a model without calling one (NORTH_STAR §23). Phase 2 rules are
// deliberately small: hard constraints filter, then first fit wins. Cost/
// latency/benchmarking depth arrives with the Phase 10 model ecosystem.
export function route(models: ModelMetadata[], hints: RouteHints = {}): ModelMetadata {
  let pool = models;
  if (hints.privacySensitive === true) pool = pool.filter((m) => m.availability === "local");
  if (hints.needsToolCalling === true) pool = pool.filter((m) => m.toolCalling);
  if (hints.needsLongContext === true) pool = pool.filter((m) => m.contextTokens >= 8000);
  if (hints.prefersCoding === true) {
    // Metadata has no coding flag (frozen DRAFT), so reasoning is a soft
    // preference, never a filter: fall back to the pool when nothing declares it.
    const coders = pool.filter((m) => m.reasoning);
    if (coders.length > 0) pool = coders;
  }
  const picked = pool[0];
  if (picked === undefined) throw new ContractError("NOT_FOUND", "no registered model satisfies the route hints");
  return picked;
}
