/**
 * CX1.4 — Backfill tenant_id on all existing .data/*.json records.
 *
 * Stamps `tenant_id: "tenant-ritz-founder"` on every record that is
 * missing the field. Idempotent — running twice produces the same result.
 * Skips stores that are global/aggregate (no tenant_id by design).
 *
 * Writes directly to disk (bypasses json-store.ts server-only guard).
 *
 * Usage:
 *   npx tsx scripts/backfill-tenant-id.ts
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DATA_DIR = join(process.cwd(), ".data");
const TENANT_ID = "tenant-ritz-founder";

// Stores that need tenant_id (array-of-objects shape)
const TENANT_SCOPED_STORES = [
  "imported-results",
  "imported-changes",
  "imported-opportunities",
  "imported-competitors",
  "import-runs",
  "event-decisions",
  "candidate-links",
  "pages",
  "page-snapshots",
  "page-snapshots-prev",
  "page-guardrails",
  "page-issues",
  "scan-findings",
  "observation-runs",
  "scan-runs",
  "daily-metric-snapshots",
  "experiments",
  "change-outcomes",
  "change-contracts",
  "truth-labels",
  "tracked-prompts",
  "tracked-entities",
  "prompt-answer-observations",
  "local-reviews",
  "page-visibility",
  "recommendation-responses",
  "action-states",
  "brief-states",
  "rollout-executions",
  "pattern-evidence",
  "frontier-attack-packages",
  "tracked-missing-pages",
  "asset-responses",
  "outcome-store",
  "competitor-page-evidence",
  "source-pattern-evidence",
  "render-checks",
  "page-snapshot-diffs",
];

// Stores that are singleton objects (not arrays) but need tenant_id
const SINGLETON_STORES = [
  "answer-intelligence-index",
  "citation-evidence-index",
];

// Stores explicitly EXCLUDED (global aggregates, no tenant_id)
const EXCLUDED_STORES = [
  "tenants",            // the tenant registry itself
  "change-patterns",    // global aggregate (CX4 replaces)
  "triage-rules",       // global
  "confidence-calibration", // global (doesn't exist as file yet)
  "business-config",    // config, not per-tenant data
  "competitor-universe", // config
  "competitor-monitoring", // operator config
  "co-mention-matrix",  // derived from answer intelligence
  "exit-gates",         // operator state
  "milestone-state",    // operator state
  "scan-state",         // transient
  "last-scan-result",   // transient
  "sitemap-reconciliation", // transient
  "prompt-library",     // template library (not per-tenant data)
  "answer-texts",       // keyed by observation_id, shared
  "cost-ledger",        // already has tenant_id per entry
];

type AnyRecord = Record<string, unknown>;

let totalStamped = 0;
let totalSkipped = 0;
let totalFiles = 0;

function backfillArray(storeName: string): void {
  const filePath = join(DATA_DIR, `${storeName}.json`);
  if (!existsSync(filePath)) {
    console.log(`  SKIP ${storeName} (file not found)`);
    return;
  }

  let records: AnyRecord[];
  try {
    const raw = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      console.log(`  SKIP ${storeName} (not an array — use singleton handler)`);
      return;
    }
    records = parsed;
  } catch {
    console.log(`  SKIP ${storeName} (parse error)`);
    return;
  }

  let stamped = 0;
  for (const rec of records) {
    if (!rec.tenant_id) {
      rec.tenant_id = TENANT_ID;
      stamped++;
    }
  }

  if (stamped > 0) {
    writeFileSync(filePath, JSON.stringify(records, null, 2), "utf-8");
  }

  totalStamped += stamped;
  totalSkipped += records.length - stamped;
  totalFiles++;
  console.log(
    `  ${storeName}: ${records.length} records, ${stamped} stamped, ${records.length - stamped} already had tenant_id`,
  );
}

function backfillSingleton(storeName: string): void {
  const filePath = join(DATA_DIR, `${storeName}.json`);
  if (!existsSync(filePath)) {
    console.log(`  SKIP ${storeName} (file not found)`);
    return;
  }

  let record: AnyRecord;
  try {
    record = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch {
    console.log(`  SKIP ${storeName} (parse error)`);
    return;
  }

  if (Array.isArray(record)) {
    // Sometimes these are wrapped in an array with one element
    if (record.length === 1 && typeof record[0] === "object") {
      if (!record[0].tenant_id) {
        record[0].tenant_id = TENANT_ID;
        writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
        console.log(`  ${storeName}: singleton (array-wrapped) stamped`);
        totalStamped++;
      } else {
        console.log(`  ${storeName}: singleton already had tenant_id`);
        totalSkipped++;
      }
    } else {
      // It's actually an array store, backfill each element
      backfillArray(storeName);
    }
  } else if (typeof record === "object" && record !== null) {
    if (!record.tenant_id) {
      record.tenant_id = TENANT_ID;
      writeFileSync(filePath, JSON.stringify(record, null, 2), "utf-8");
      console.log(`  ${storeName}: singleton stamped`);
      totalStamped++;
    } else {
      console.log(`  ${storeName}: singleton already had tenant_id`);
      totalSkipped++;
    }
  }
  totalFiles++;
}

function main(): void {
  console.log(`Backfilling tenant_id = "${TENANT_ID}" on .data/*.json stores\n`);

  console.log("Array stores:");
  for (const store of TENANT_SCOPED_STORES) {
    backfillArray(store);
  }

  console.log("\nSingleton stores:");
  for (const store of SINGLETON_STORES) {
    backfillSingleton(store);
  }

  console.log("\nExcluded (global/config):");
  for (const store of EXCLUDED_STORES) {
    console.log(`  ${store} — intentionally no tenant_id`);
  }

  console.log(`\nDone: ${totalFiles} files processed, ${totalStamped} records stamped, ${totalSkipped} already had tenant_id`);
}

main();
