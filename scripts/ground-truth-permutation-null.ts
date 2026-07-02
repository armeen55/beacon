/**
 * Ground-truth permutation-null read (master plan item 37) against REAL
 * Iranopedia data. Read-only report: does NOT write anything - it loads the
 * real proof ledger, finds the /famous-iranian-singers record's 7-day window,
 * builds the real permutation null over every untreated page with adequate
 * traffic (sharing the treated window's exact dates), and reports where the
 * treated lift landed plus the plain-English sentence a real operator would
 * see. No paid calls.
 *
 * Run:
 *   set -a; . ./.env.local; set +a
 *   npx tsx --require ./scripts/mock-server-only.cjs scripts/ground-truth-permutation-null.ts
 */

import { loadShippedChanges } from "@/domains/proof-gsc/shipped-change-store";
import { pickProofMetric } from "@/domains/proof-gsc/measure";
import { buildPermutationNull, percentileOf, hasEnoughNullPages, permutationSentenceFromCounts } from "@/domains/proof-gsc/permutation-null";

const TENANT = process.env.BEACON_GROUND_TRUTH_TENANT ?? "tenant-iranopedia";
process.env.BEACON_TENANT_ID = TENANT;

function dateOnly(iso: string): string {
  return iso.length > 10 ? iso.slice(0, 10) : iso;
}

async function main() {
  console.log(`\n=== permutation-null ground-truth - tenant=${TENANT} ===\n`);

  const records = await loadShippedChanges();
  console.log(`Ledger rows loaded: ${records.length}`);

  const target = records.find((r) => r.path === "/famous-iranian-singers" || r.path.includes("famous-iranian-singers"));
  if (!target) {
    console.log("No shipped-change record found for /famous-iranian-singers in this tenant's ledger.");
    console.log("Paths present:", records.map((r) => r.path).slice(0, 30));
    return;
  }

  console.log(`Found record: ${target.id} (${target.actionType}) shipped ${target.shippedAt}`);
  const win7 = (target.windows ?? []).find((w) => w.day === 7);
  if (!win7 || !win7.ran) {
    console.log("The 7-day window has not run yet for this record - nothing to report.");
    console.log("Windows:", target.windows);
    return;
  }

  const metric = pickProofMetric(target.actionType);
  const liftOf = (w: typeof win7): number =>
    metric === "ctr" ? w.adjustedCtrLift : metric === "position" ? w.adjustedPosLift : w.adjustedLift;
  const treatedLift = liftOf(win7);
  console.log(`Metric judged: ${metric}, 7-day adjusted lift: ${treatedLift}`);

  const shipDate = dateOnly(target.shippedAt);
  const excludePaths = new Set([target.path, ...target.controlPages]);

  const nullDist = await buildPermutationNull({
    tenantId: TENANT,
    shipDate,
    windowDays: 7,
    preWindowDays: 28,
    excludePaths,
  });

  console.log(`\nUntreated candidate pages in the null distribution: ${nullDist.pages.length}`);
  console.log(`Enough pages for an honest read (>= 20)? ${hasEnoughNullPages(nullDist)}`);

  if (!hasEnoughNullPages(nullDist)) {
    console.log("Honest skip: too few untreated pages to report a percentile.");
    return;
  }

  const { percentile, nGreater, nTotal } = percentileOf(treatedLift, nullDist);
  console.log(`\nPercentile: ${percentile} (nGreater=${nGreater}, nTotal=${nTotal})`);
  const sentence = permutationSentenceFromCounts(nGreater, nTotal);
  console.log(`\nPlain-English sentence:\n  "${sentence}"`);

  console.log("\nTop 10 untreated pages by |pseudoLift| (for sanity):");
  const top = [...nullDist.pages].sort((a, b) => Math.abs(b.pseudoLift) - Math.abs(a.pseudoLift)).slice(0, 10);
  for (const p of top) {
    console.log(`  ${p.page}  delta=${p.delta.toFixed(2)}  pseudoLift=${p.pseudoLift.toFixed(2)}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ground-truth-permutation-null failed:", e);
    process.exit(1);
  });
