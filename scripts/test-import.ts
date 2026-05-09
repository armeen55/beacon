/**
 * Test script for the Profound import pipeline.
 * Run with: npx tsx scripts/test-import.ts
 *
 * Bypasses "server-only" guard since this is a Node script, not a browser bundle.
 */

// Stub out "server-only" so it doesn't throw outside Next.js
require.extensions = require.extensions || {};

// Monkey-patch require to no-op "server-only"
const Module = require("module");
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request: string, ...args: unknown[]) {
  if (request === "server-only") return request;
  return origResolve.call(this, request, ...args);
};
Module._cache["server-only"] = { id: "server-only", exports: {}, loaded: true };

import { join } from "node:path";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { parseCSV } from "../src/lib/persistence/csv-parser";
import { parseProfoundPrompts } from "../src/adapters/profound/prompt-adapter";
import { parseProfoundExecutions } from "../src/adapters/profound/execution-adapter";
import { parseProfoundCitations } from "../src/adapters/profound/citation-adapter";
import { parseProfoundBenchmark } from "../src/adapters/profound/benchmark-adapter";
import { buildEntitySeed } from "../src/adapters/profound/entity-seed";
import { buildDerivedSnapshots } from "../src/derivations/snapshot-builder";

const DATA_DIR = join(process.cwd(), ".data");

function findFile(prefix: string): string | null {
  if (!existsSync(DATA_DIR)) return null;
  const files = readdirSync(DATA_DIR);
  const match = files.find(
    (f: string) => f.startsWith(prefix) && f.endsWith(".csv")
  );
  return match ? join(DATA_DIR, match) : null;
}

async function main() {
  console.log("=== Beacon Import Pipeline Test ===\n");

  // Stage D2 (2026-05-09): require explicit BEACON_TENANT_ID for the
  // entity-seed/snapshot-builder/benchmark-adapter chain.
  const tenantId = process.env.BEACON_TENANT_ID;
  if (!tenantId) {
    console.error(
      "[test-import] BEACON_TENANT_ID env var is required " +
        "(e.g. BEACON_TENANT_ID=tenant-ritz-founder)",
    );
    process.exit(1);
  }

  // Entity seed
  console.log("1. Entity seed...");
  const { entities, ownedDomains, domainToEntityId } = buildEntitySeed("ritz-builders");
  console.log(`   Entities: ${entities.length}`);
  console.log(`   Owned domains: ${ownedDomains.join(", ")}`);

  // Prompt import
  const promptsFile = findFile("prompts_export");
  if (!promptsFile) { console.error("Missing prompts CSV"); return; }
  console.log("\n2. Prompt import...");
  const promptResult = parseProfoundPrompts(promptsFile, "ritz-builders");
  console.log(`   Prompts: ${promptResult.prompts.length}`);
  console.log(`   Warnings: ${promptResult.warnings.length}`);
  if (promptResult.warnings.length > 0) {
    promptResult.warnings.slice(0, 3).forEach(w => console.log(`     ${w}`));
  }

  const promptLookup = new Map<string, string>();
  for (const p of promptResult.prompts) {
    promptLookup.set(p.text, p.id);
  }

  // Execution import
  const rawFile = findFile("profound_raw_data_with_citations");
  if (!rawFile) { console.error("Missing raw CSV"); return; }
  console.log("\n3. Execution import (this may take a moment for 9,596 rows)...");
  const start = Date.now();
  const execResult = parseProfoundExecutions(rawFile, "ritz-builders", "test-run", promptLookup, ownedDomains, tenantId);
  const elapsed = Date.now() - start;
  console.log(`   Observations: ${execResult.observations.length}`);
  console.log(`   Runs: ${execResult.runs.length}`);
  console.log(`   Answer texts: ${Object.keys(execResult.answerTexts).length}`);
  console.log(`   Warnings: ${execResult.warnings.length}`);
  console.log(`   Elapsed: ${elapsed}ms`);
  if (execResult.warnings.length > 0) {
    execResult.warnings.slice(0, 5).forEach(w => console.log(`     ${w}`));
  }

  // Quick sanity: check brand mention counts
  const mentioned = execResult.observations.filter(o => o.tracked_brand_mentioned === true).length;
  const notMentioned = execResult.observations.filter(o => o.tracked_brand_mentioned === false).length;
  console.log(`   Brand mentioned: ${mentioned}/${execResult.observations.length} (${(mentioned / execResult.observations.length * 100).toFixed(1)}%)`);

  // Derived snapshots
  console.log("\n3b. Deriving Beacon-native snapshots...");
  const ownedEntityId = entities.find(e => e.is_owned && e.entity_type === "brand")?.id ?? "ritz";
  const derivedSnapshots = buildDerivedSnapshots(execResult.observations, ownedEntityId, tenantId);
  console.log(`   Derived snapshots: ${derivedSnapshots.length}`);
  const byScope = new Map<string, number>();
  for (const s of derivedSnapshots) {
    byScope.set(s.scope_type, (byScope.get(s.scope_type) ?? 0) + 1);
  }
  for (const [scope, count] of byScope) {
    console.log(`     ${scope}: ${count}`);
  }
  if (derivedSnapshots.length > 0) {
    const sample = derivedSnapshots[0];
    console.log(`   Sample: ${sample.date} ${sample.scope_type}=${sample.scope_id} ${sample.platform} vis=${sample.visibility_score}% mentions=${sample.mention_count}/${sample.total_possible}`);
  }

  // Citation import
  const citFile = findFile("profound_citations_data");
  if (!citFile) { console.error("Missing citations CSV"); return; }
  console.log("\n4. Citation import (85k rows)...");
  const citStart = Date.now();
  const citResult = parseProfoundCitations(citFile, ownedDomains, domainToEntityId);
  const citElapsed = Date.now() - citStart;
  let totalCitations = 0;
  for (const [, citations] of citResult.citationsByDate) totalCitations += citations.length;
  console.log(`   Total citations: ${totalCitations}`);
  console.log(`   Date shards: ${citResult.citationsByDate.size}`);
  console.log(`   Warnings: ${citResult.warnings.length}`);
  console.log(`   Elapsed: ${citElapsed}ms`);

  // Benchmark import
  const benchFile = findFile("profound_summarized_export");
  if (benchFile) {
    console.log("\n5. Benchmark import...");
    const entityLookup = new Map<string, string>();
    for (const e of entities) {
      if (e.name) entityLookup.set(e.name, e.id);
    }
    const benchResult = parseProfoundBenchmark(benchFile, "ritz-builders", entityLookup, tenantId);
    console.log(`   Snapshots: ${benchResult.snapshots.length}`);
    console.log(`   Entity candidates: ${benchResult.entityCandidates.length}`);
    console.log(`   Warnings: ${benchResult.warnings.length}`);
    console.log(`   Top 10 entity candidates:`);
    benchResult.entityCandidates.slice(0, 10).forEach(c =>
      console.log(`     ${c.name} (${c.classification}, ${c.row_count} rows)`)
    );
  }

  console.log("\n=== IMPORT TEST COMPLETE ===");
}

main().catch(console.error);
