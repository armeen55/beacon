/**
 * One-shot CLI: run the URL-level Z-score engine against the current data.
 * Use after a CSV import to refresh `url-change-outcomes.json` with the
 * latest observation history.
 *
 * Usage: npx tsx scripts/run-url-watcher.ts
 */

// Stub modules that can't run outside Next.js (same shims as run-import.ts).
// Wrapped in an IIFE so the `Module` identifier doesn't collide with the
// sibling script in the same tsc scope.
(function installShims() {
const mod = require("module");
const origLoad = mod._load;
mod._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/cache") return { revalidatePath: () => {}, unstable_cache: (fn: unknown) => fn };
  if (request === "next/headers") return { cookies: () => ({ get: () => null }), headers: () => new Map() };
  if (request.endsWith("seed-data.server") || request.includes("seed-data.server")) {
    // Watcher needs real changelogEntries \u2014 read the persisted store directly.
    const fs = require("node:fs");
    const path = require("node:path");
    const storePath = path.resolve(__dirname, "..", ".data", "imported-changes.json");
    let changelogEntries: unknown[] = [];
    try {
      changelogEntries = JSON.parse(fs.readFileSync(storePath, "utf8"));
    } catch (e) {
      console.warn("[watcher-shim] failed to read imported-changes.json", e);
    }
    return {
      importRuns: [],
      hasActiveExperiment: () => false,
      results: [],
      changelogEntries,
      opportunities: [],
      competitors: [],
      briefs: [],
      competitorSnapshots: [],
    };
  }
  return origLoad.call(this, request, parent, isMain);
};
})();

async function runUrlWatcherMain() {
  const { runUrlWatcher } = require("../src/domains/product/url-watcher");

  console.log("Running URL watcher (Z-score engine) against current data...");
  const t0 = Date.now();
  const result = await runUrlWatcher("manual:post-import");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\n\u2713 URL watcher completed in ${elapsed}s`);
  console.log("\nResult:");
  for (const [k, v] of Object.entries(result)) {
    console.log(`  ${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`);
  }
}

runUrlWatcherMain().catch((e) => {
  console.error("\n\u2717 URL watcher failed:");
  console.error(e);
  process.exit(1);
});

export {};
