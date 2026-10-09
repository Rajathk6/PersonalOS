import type { CapabilityManifest } from "@personalos/contracts";

// Second vertical through the door. Eligibility analysis and exam guidance
// (the LLM part) arrive later — v0.1 proves deterministic discovery first:
// fetch, keyword-match, dedup, notify. No model output in the loop.
export const jobsManifest: CapabilityManifest = {
  name: "jobs",
  version: "0.1.0",
  actions: ["watch.create", "check", "findings"],
  entities: ["watch", "finding"],
  workflows: [],
  tools: ["jobs.check"],
  permissions: ["jobs.read", "jobs.write"],
  compat: { runtime: "personalos/0" },
};
