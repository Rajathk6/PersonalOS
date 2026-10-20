// Standalone harvester — runs on ANY node-capable device (laptop, Pi, or the
// always-on phone via Termux). It fetches official sources, then PUSHES the
// items to the main server's intake endpoint. The main server owns storage,
// matching, dedup, and alerting; this side is deliberately dumb so it can
// live on a weak device.
//
// Usage:
//   PERSONALOS_API=http://100.x.y.z:3000 PERSONALOS_TOKEN=... node dist/cli.js
//   node dist/cli.js --dry-run        (print only, no push)
import { OFFICIAL_SOURCES } from "./sources.js";
import { harvestAll } from "./harvest.js";
import type { HarvestedItem } from "./harvest.js";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.split("=")[1];
}

const api = process.env["PERSONALOS_API"];
const token = process.env["PERSONALOS_TOKEN"];
const dryRun = process.argv.includes("--dry-run");
const skipApply = process.argv.includes("--skip-apply");
const timeout = Number(arg("timeout") ?? process.env["PERSONALOS_TIMEOUT_MS"] ?? 20000);
const only = arg("source");

if (!dryRun && (api === undefined || token === undefined)) {
  console.error("PERSONALOS_API and PERSONALOS_TOKEN are required (or use --dry-run)");
  process.exit(1);
}

const sources = only !== undefined ? OFFICIAL_SOURCES.filter((s) => s.id === only) : OFFICIAL_SOURCES;
const results = await harvestAll(sources, { timeoutMs: timeout, skipApplyLookup: skipApply });
const items: HarvestedItem[] = results.flatMap((r) => r.items);

for (const r of results) {
  console.log(`${r.ok ? "ok " : "ERR"} ${r.sourceId}: ${r.items.length} item(s)${r.error === undefined ? "" : ` — ${r.error}`}`);
}

if (dryRun) {
  for (const i of items) console.log(`  ${i.title.slice(0, 90)} :: ${i.url}`);
  console.log(`dry run: ${items.length} item(s) not pushed`);
} else {
  const res = await fetch(`${api}/job-alerts/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ harvestedBy: process.env["PERSONALOS_NODE"] ?? "always-on-node", items }),
  });
  const body = (await res.json()) as { inserted?: number; duplicates?: number; error?: string };
  if (!res.ok) {
    console.error(`push failed: HTTP ${res.status} ${body.error ?? ""}`);
    process.exit(1);
  }
  console.log(`pushed: ${body.inserted ?? 0} new, ${body.duplicates ?? 0} duplicate(s)`);
}
