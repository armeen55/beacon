/**
 * Step 1: pool census. History depth D, pool size P (pages averaging at
 * least 200 impressions per 28 day window, outside the ledger exclusion
 * set), per traffic tier and per page family, plus the calibration and
 * evaluation split preview. Snapshot only; no database reads.
 */

import { normalizePathKey } from "@/domains/proof-gsc/validation/series";
import { buildPool, splitPool } from "@/domains/proof-gsc/validation/placebo-design";
import { daysBetween } from "@/domains/proof-gsc/validation/series";
import { RUN_ID, loadLedgerRows, loadSnapshotIndex, stepOutputPath, writeJson } from "./lib";

function countBy<T>(items: ReadonlyArray<T>, keyOf: (t: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const k = keyOf(it);
    out[k] = (out[k] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)));
}

async function main(): Promise<void> {
  const { index, manifest } = loadSnapshotIndex();
  const ledger = loadLedgerRows();
  const exclude = new Set<string>();
  for (const r of ledger) {
    exclude.add(normalizePathKey(r.page));
    for (const cp of r.control_pages ?? []) exclude.add(normalizePathKey(cp));
  }
  const pool = buildPool({ index, excludePaths: exclude, minBaselineImpressions: 200 });
  const { calibration, evaluation } = splitPool(pool);
  const D = daysBetween(manifest.minDate, manifest.maxDate) + 1;

  const out = {
    runId: RUN_ID,
    snapshot: { minDate: manifest.minDate, maxDate: manifest.maxDate, D },
    totalSnapshotPages: index.pages.size,
    ledgerExclusionPaths: exclude.size,
    poolSize: pool.length,
    byTier: countBy(pool, (p) => p.tier),
    byFamily: countBy(pool, (p) => p.family),
    byTierAndFamily: countBy(pool, (p) => `${p.tier}::${p.family}`),
    split: {
      calibrationPages: calibration.length,
      evaluationPages: evaluation.length,
      calibrationByTier: countBy(calibration, (p) => p.tier),
      evaluationByTier: countBy(evaluation, (p) => p.tier),
    },
    note:
      "D = 480 exceeds the 112 day minimum for calendar-disjoint 28 day calibration/evaluation placement (protocol 2.2); backfill already done, no stop condition",
  };
  writeJson(stepOutputPath("step1-census"), out);
  console.log(`[step1] D=${D} pool P=${pool.length}`);
  console.log(`  tiers    ${JSON.stringify(out.byTier)}`);
  console.log(`  families ${JSON.stringify(out.byFamily)}`);
  console.log(`  split    calibration ${calibration.length} / evaluation ${evaluation.length}`);
}

main().catch((e) => {
  console.error("[step1] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
