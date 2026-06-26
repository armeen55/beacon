/**
 * Trigger a full Profound import from the CLI.
 * Run with: npx tsx scripts/run-import.ts
 */

// Stub modules that can't run outside Next.js
const Module = require("module");
const origLoad = Module._load;
Module._load = function (request: string, parent: unknown, isMain: boolean) {
  if (request === "server-only") return {};
  if (request === "next/cache") return { revalidatePath: () => {}, unstable_cache: (fn: any) => fn };
  if (request === "next/headers") return { cookies: () => ({ get: () => null }), headers: () => new Map() };
  // seed-data.server has top-level await — stub with minimal shape
  if (request.endsWith("seed-data.server") || request.includes("seed-data.server")) {
    return {
      importRuns: [],
      hasActiveExperiment: () => false,
      results: [],
      changelogEntries: [],
      opportunities: [],
      competitors: [],
      briefs: [],
      competitorSnapshots: [],
    };
  }
  return origLoad.call(this, request, parent, isMain);
};

async function main() {
  const { runProfoundImport } = require("../src/adapters/profound/import-orchestrator");

  console.log("Starting Beacon import pipeline...\n");
  const t0 = Date.now();
  const result = await runProfoundImport("ritz-builders");
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  if (result.success) {
    console.log(`\n✓ Import completed in ${elapsed}s`);
  } else {
    console.error(`\n✗ Import failed after ${elapsed}s`);
  }

  console.log("\nCounts:");
  for (const [key, val] of Object.entries(result.counts)) {
    if ((val as number) > 0) console.log(`  ${key}: ${val}`);
  }

  if (result.ingest_files) {
    console.log("\nFiles used:");
    for (const [kind, files] of Object.entries(result.ingest_files)) {
      if (Array.isArray(files) && files.length > 0) {
        console.log(`  ${kind}: ${files.map((f: string) => f.split("/").pop()).join(", ")}`);
      }
    }
  }

  if (result.unclassified_csv?.length) {
    console.log("\nUnrecognized CSVs (skipped):");
    for (const f of result.unclassified_csv) {
      console.log(`  ${f.split("/").pop()}`);
    }
  }

  if (result.warnings.length > 0) {
    console.log(`\nWarnings (${result.warnings.length}):`);
    result.warnings.slice(0, 10).forEach((w: string) => console.log(`  ${w}`));
    if (result.warnings.length > 10) console.log(`  ... and ${result.warnings.length - 10} more`);
  }

  if (result.errors.length > 0) {
    console.log("\nErrors:");
    result.errors.forEach((e: string) => console.error(`  ${e}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});

export {};
