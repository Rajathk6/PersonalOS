import type { CapabilityManifest } from "@personalos/contracts";
import { CapabilityManifestSchema, ContractError, Registry, validateLifecycle } from "@personalos/contracts";

// Single source of compat truth: capabilities declare "personalos/<major>".
// Bump the major only on breaking Core contract changes (STABLE interfaces).
export const CORE_RUNTIME = "personalos/0";

export interface InstallRecord {
  (manifest: CapabilityManifest, enabled: boolean): Promise<void>;
}

export interface CapabilityBundle {
  manifest: CapabilityManifest;
  handlers: Map<string, (task: never) => Promise<unknown>>;
  tools: (import("@personalos/contracts").Tool & { version: string })[];
}

// The extension mechanism (spec §17/42): validate manifest, check compat,
// walk the lifecycle, record the install. Code still ships in-release —
// dynamic loading is Phase 11 — but every vertical enters through THIS door,
// so Core never learns finance/jobs/whatever specifics.
export class CapabilityRegistry {
  private readonly manifests = new Registry<CapabilityManifest>();

  constructor(private readonly record?: InstallRecord) {}

  async install(bundle: CapabilityBundle): Promise<CapabilityManifest> {
    // Manifests are JSON documents: round-tripping strips the explicit
    // undefineds zod produces, satisfying exactOptionalPropertyTypes honestly
    // (absent means absent, the same as over the wire).
    const manifest = JSON.parse(JSON.stringify(
      CapabilityManifestSchema.parse(bundle.manifest),
    )) as CapabilityManifest;
    const [runtime, major] = manifest.compat.runtime.split("/");
    if (runtime !== "personalos" || major === undefined) {
      throw new ContractError("INCOMPATIBLE_VERSION", `${manifest.name} declares bad runtime ${manifest.compat.runtime}`);
    }
    if (`${runtime}/${major}` !== CORE_RUNTIME) {
      throw new ContractError(
        "INCOMPATIBLE_VERSION",
        `${manifest.name} needs ${manifest.compat.runtime}, core is ${CORE_RUNTIME}`,
      );
    }
    // Fresh installs walk DISCOVERED -> VALIDATING -> INSTALLED -> ENABLED.
    validateLifecycle("DISCOVERED", "VALIDATING");
    validateLifecycle("VALIDATING", "INSTALLED");
    this.manifests.register(manifest);
    validateLifecycle("INSTALLED", "ENABLED");
    await this.record?.(manifest, true);
    return manifest;
  }

  get(name: string, version?: string): CapabilityManifest {
    return this.manifests.get(name, version);
  }

  list(): CapabilityManifest[] {
    return this.manifests.list();
  }
}
