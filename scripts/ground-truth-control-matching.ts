/**
 * Ground-truth control-matching (master plan items 33 + 36) against REAL
 * Iranopedia data. Read-only report: for the most recent shipped-change
 * ledger rows, runs the new matcher (matchControlsForShip) over each row's
 * ACTUAL raw candidate pool (loadControlCandidates, same source
 * auto-record-on-ship.ts uses) and reports what the matcher WOULD have
 * selected vs what was actually recorded on the row. Never writes anything.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-control-matching.ts
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { matchControlsForShip } from "@/domains/proof-gsc/auto-record-on-ship";
import {
  loadPageSurgeonContext,
  topPagesByDemand,
} from "@/domains/recommendation-intelligence/page-surgeon/assemble-packet";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
process.env.BEACON_TENANT_ID = TENANT;

const N_ROWS = 3;

async function main() {
  console.log(`\n=== control-matching ground-truth - tenant=${TENANT} ===\n`);

  const records = await loadShippedChanges();
  console.log(`Ledger rows loaded: ${records.length}`);
  if (records.length === 0) {
    console.log("No shipped-change records for this tenant - nothing to check.");
    return;
  }

  const sorted = [...records].sort((a, b) => (a.shippedAt < b.shippedAt ? 1 : -1));
  const recent = sorted.slice(0, N_ROWS);

  for (const r of recent) {
    console.log(`\n--- ${r.path} (${r.actionType}) shipped ${r.shippedAt.slice(0, 10)} ---`);
    console.log(`  Actually recorded controlPages (${r.controlPages.length}): ${r.controlPages.join(", ") || "(none)"}`);
    console.log(`  controlMatchWeak on record: ${r.controlMatchWeak === true}`);
    if (r.controlMatchNotes?.length) {
      console.log(`  controlMatchNotes on record:`);
      for (const n of r.controlMatchNotes) console.log(`    - ${n}`);
    }

    // Re-derive the SAME raw candidate pool auto-record-on-ship.ts would pull
    // today (top-12 by demand, excluding the treated page). This is a live
    // read against current GSC data, so it will not exactly reproduce what
    // the candidate pool looked like the day this row was actually shipped -
    // the point is to see whether the matcher's math finds real scale/trend/
    // overlap problems in the pool that exists NOW, not to replay history.
    let rawCandidates: string[] = [];
    try {
      const ctx = await loadPageSurgeonContext(TENANT);
      rawCandidates = topPagesByDemand(ctx, 12)
        .map((u) => canonicalizeCitationUrl(u) ?? u)
        .filter((u) => u && u !== r.page);
    } catch (e) {
      console.log(`  (could not load raw candidates: ${e instanceof Error ? e.message : String(e)})`);
      continue;
    }

    if (rawCandidates.length === 0) {
      console.log("  (no raw candidates available today - skipping matcher re-run)");
      continue;
    }

    try {
      const matched = await matchControlsForShip({
        tenantId: TENANT,
        treatedPage: r.page,
        candidates: rawCandidates,
        shipDate: r.shippedAt.slice(0, 10),
      });
      console.log(`  Matcher WOULD select today (${matched.kept.length}, usedFallback=${matched.usedFallback}): ${matched.kept.join(", ") || "(none)"}`);
      const excluded = matched.matched.filter((m) => m.verdict === "excluded");
      if (excluded.length > 0) {
        console.log(`  Matcher would EXCLUDE ${excluded.length} of ${matched.matched.length} raw candidates:`);
        for (const e of excluded) {
          console.log(
            `    - ${e.url}: ratio=${e.similarityRatio?.toFixed(2) ?? "n/a"} slopeDiv=${e.slopeDivergence?.toFixed(2) ?? "n/a"} overlap=${e.queryOverlap != null ? (e.queryOverlap * 100).toFixed(0) + "%" : "n/a"} -> ${e.reason}`,
          );
        }
      } else {
        console.log("  Every raw candidate passed the matcher's checks.");
      }

      const actualSet = new Set(r.controlPages);
      const wouldSelectSet = new Set(matched.kept);
      const overlapCount = [...actualSet].filter((u) => wouldSelectSet.has(u)).length;
      console.log(`  Agreement: ${overlapCount} of ${r.controlPages.length} actually-recorded comparison pages also pass the matcher today.`);
    } catch (e) {
      console.log(`  (matcher threw: ${e instanceof Error ? e.message : String(e)})`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ground-truth-control-matching failed:", e);
    process.exit(1);
  });
