/**
 * D4/N1 ground-truth probe (2026-07-02, DREAM SITE V1) - prints the REAL top 15 of the unified
 * allocator list for tenant-iranopedia with all fields, so the operator (and this script's
 * author) can sanity-check whether the fused ranking actually agrees with what a smart operator
 * would do first. Not a product surface - a one-off verification script. Run:
 *   set -a; . ./.env.local; set +a
 *   BEACON_TENANT_ID=tenant-iranopedia npx tsx --require ./scripts/mock-server-only.cjs scripts/_d4-unified-list-ground-truth.ts
 */
process.env.BEACON_TENANT_ID = process.env.BEACON_TENANT_ID || "tenant-iranopedia";

import { loadMovesWorklist } from "@/app/(shell)/moves/moves-data";
import { getLatestPreviewPlan, getAcceptedPlan, listActiveReservations } from "@/domains/experiments/daily-experiment-plan-store";
import { buildCanonicalChanges, type CanonicalMoveInput } from "@/domains/changes/build-canonical-changes";
import { loadCalibrationRecords } from "@/domains/experiments/forecast-calibration-store";
import { summarizeForecastCalibration, captureDistributionFromCalibrationRecords } from "@/domains/experiments/forecast-calibration";
import { canonicalMoveType } from "@/domains/learning/experiment-prior";
import { blendCaptureBand } from "@/domains/experiments/empirical-capture";
import { fuseUnifiedList } from "@/domains/allocator/load-unified-list";

async function main() {
  const tenantId = "tenant-iranopedia";

  const [wl, accepted, preview, reservations, calibrationRecords] = await Promise.all([
    loadMovesWorklist().catch((e) => {
      console.log("worklist load failed:", String(e).slice(0, 200));
      return { moves: [] as any[] };
    }),
    getAcceptedPlan(tenantId).catch(() => null),
    getLatestPreviewPlan(tenantId).catch(() => null),
    listActiveReservations(tenantId).catch(() => []),
    loadCalibrationRecords(tenantId).catch(() => []),
  ]);
  const plan = accepted ?? preview;
  const moves = wl.moves ?? [];
  const calibrationSummary = summarizeForecastCalibration(calibrationRecords);
  const captureDistribution = captureDistributionFromCalibrationRecords(calibrationRecords);

  const moveInputs: CanonicalMoveInput[] = moves.map((m: any) => {
    const tq = [...(m.topQueries ?? [])].sort((a: any, b: any) => b.impressions - a.impressions)[0];
    const band = blendCaptureBand(captureDistribution.get(canonicalMoveType(m.action)));
    return {
      id: m.id,
      actionType: m.action,
      actionTone: m.actionTone,
      query: m.query,
      targetUrl: m.targetUrl,
      pageLabel: m.pageLabel,
      why: m.why,
      rankWhy: m.rankWhy,
      score: m.score,
      demand: m.demand,
      topQueryPosition: tq && tq.impressions > 0 ? tq.position : null,
      topQueryImpressions90d: tq?.impressions ?? null,
      topQueryClicks90d: tq?.clicks ?? null,
      correctionFactor: calibrationSummary.correctionFactor,
      captureBand: { low: band.low, high: band.high, n: band.n, isEmpirical: band.isEmpirical },
      settledResultsCount: calibrationSummary.settledCount,
      proofStatus: m.proofStatus ?? null,
      alreadyMeasuring: m.alreadyMeasuring,
      pageMeasuring: m.pageMeasuring,
      preparedReady: m.preparedChecklist?.readyToReview,
      preparedDraftText: m.preparedDraftText ?? null,
      alternateOpportunities: (m.also ?? []).slice(0, 4),
      proofMaturity: m.proofMaturity ?? null,
      proofDirection: m.proofDirection ?? null,
      proofLabel: m.proofLabel ?? null,
      proofNextCheckpoint: m.proofNextCheckpoint ?? null,
    };
  });

  const worklistChanges = buildCanonicalChanges({ tenantId, moves: moveInputs, plan: plan ?? null, reservations });
  console.log(`\n=== D4 ground truth: ${worklistChanges.length} worklist changes loaded (lane a) ===\n`);

  const { changes, laneCounts } = await fuseUnifiedList(tenantId, worklistChanges);

  console.log("Lane counts (how many rows each source contributed BEFORE fusion):");
  console.log(JSON.stringify(laneCounts, null, 2));
  console.log(`\nFused + ranked total: ${changes.length} rows\n`);

  console.log("=== TOP 15 (unified allocator ranking) ===\n");
  changes.slice(0, 15).forEach((c, i) => {
    console.log(`#${i + 1} [${c.status}] ${c.pageLabel} (${c.pagePath || "no page yet"})`);
    console.log(`    kind: ${c.changeFamily}  |  opportunityType: ${c.opportunityType}`);
    console.log(`    exactWhat: ${c.recommendation}`);
    console.log(`    expectedValue: low=${c.expectedOutcomeLow ?? "null"} high=${c.expectedOutcomeHigh ?? "null"} (${c.expectedOutcomeDays ?? "?"}d)  basis: "${c.expectedOutcome}"`);
    console.log(`    evidenceStrength: ${c.evidenceStrength}  |  risk: ${c.riskLevel}  |  effort: ~${c.estimatedEffortMinutes}min`);
    console.log(`    sources: ${(c.sources ?? ["your worklist"]).join(" + ")}`);
    console.log(`    impactScore(rank key): ${c.impactScore}`);
    if (c.blockedReason) console.log(`    HOLD: ${c.blockedReason}`);
    if (c.qualityNote) console.log(`    quality note: ${c.qualityNote}`);
    console.log("");
  });

  const multiLane = changes.filter((c) => (c.sources?.length ?? 1) > 1);
  console.log(`\nRows confirmed by 2+ lanes: ${multiLane.length}`);
  multiLane.slice(0, 5).forEach((c) => console.log(`  - ${c.pagePath}: ${(c.sources ?? []).join(" + ")}`));

  const byKindCount: Record<string, number> = {};
  for (const c of changes) byKindCount[c.changeFamily] = (byKindCount[c.changeFamily] ?? 0) + 1;
  console.log("\nBy family:", JSON.stringify(byKindCount, null, 2));

  const kwOnly = changes.filter((c) => (c.sources ?? []).length === 1 && c.sources![0] === "keyword research");
  console.log(`\nkeyword_library-only rows: ${kwOnly.length}, best rank among them:`);
  const bestKwIdx = changes.findIndex((c) => kwOnly[0] && c.id === kwOnly[0].id);
  if (kwOnly[0]) {
    console.log(`  rank #${bestKwIdx + 1}: ${kwOnly[0].pageLabel} - "${kwOnly[0].recommendation}" (impactScore ${kwOnly[0].impactScore})`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
