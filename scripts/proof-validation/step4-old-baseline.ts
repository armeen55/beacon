/**
 * Step 4: baseline the OLD (deployed) classifier on the CALIBRATION set.
 * Faithful deployed rules: measure.ts floors and windows, top-traffic
 * control selection, the post-window control filter, the impressions
 * upgrade path, and the two-chances-per-page flag rule. Labeled OLD; this
 * is required output 1 (the fresh-units reproduction of the 100 percent
 * placebo finding). The evaluation set is NOT touched here.
 */

import { oldClassifierRead, pickTopTrafficControls } from "@/domains/proof-gsc/validation/old-classifier";
import { wilsonInterval } from "@/domains/proof-gsc/validation/stats";
import { RUN_ID, loadManifest, loadSnapshotIndex, loadUnits, stepOutputPath, writeJson } from "./lib";

async function main(): Promise<void> {
  const { index } = loadSnapshotIndex();
  const manifest = loadManifest();
  const step3 = loadUnits();
  const lastFinal = manifest.maxDate;

  // One old-classifier read per calibration (page, date), across both
  // selection lanes. The deployed pipeline had one verdict per page (the
  // window plan is internal), so units are deduped by (path, shipDate).
  const calibUnits = step3.units.filter((u) => u.set === "calibration");
  const seen = new Set<string>();
  const reads: Array<{
    path: string;
    shipDate: string;
    tier: string;
    family: string;
    selection: string;
    clicksVerdict: string;
    ctrVerdict: string;
    flagged: boolean;
    wonOnImpressions: boolean;
  }> = [];
  for (const u of calibUnits) {
    const key = `${u.selection}:${u.path}:${u.shipDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const controls = pickTopTrafficControls({
      index,
      candidates: step3.poolPaths.calibration,
      excludePath: u.path,
      shipDate: u.shipDate,
    });
    const read = oldClassifierRead({ index, path: u.path, shipDate: u.shipDate, controls, lastFinalizedDate: lastFinal });
    reads.push({
      path: u.path,
      shipDate: u.shipDate,
      tier: u.tier,
      family: u.family,
      selection: u.selection,
      ...read,
    });
  }

  const summarize = (rows: typeof reads) => {
    const n = rows.length;
    const flagged = rows.filter((r) => r.flagged).length;
    const decided = (v: string) => v === "won" || v === "lost";
    return {
      n,
      flagged,
      fpr: n > 0 ? flagged / n : null,
      wilson95: wilsonInterval(flagged, n),
      clicksLaneFpr: n > 0 ? rows.filter((r) => decided(r.clicksVerdict)).length / n : null,
      ctrLaneFpr: n > 0 ? rows.filter((r) => decided(r.ctrVerdict)).length / n : null,
      wonOnImpressionsShare: n > 0 ? rows.filter((r) => r.wonOnImpressions).length / n : null,
    };
  };

  const bySelection = {
    random: summarize(reads.filter((r) => r.selection === "random")),
    shadow: summarize(reads.filter((r) => r.selection === "shadow")),
  };
  const byTier: Record<string, unknown> = {};
  for (const tier of ["low", "medium", "high"]) {
    byTier[tier] = summarize(reads.filter((r) => r.selection === "random" && r.tier === tier));
  }

  const out = {
    runId: RUN_ID,
    label:
      "OLD deployed classifier baseline on fresh CALIBRATION units (faithful reimplementation: shipped floors, longest-window basis, top-traffic controls, post-window control filter, impressions upgrade path, either-metric flagging). The deployed permutation percentile only ever gated HIGH confidence, never a verdict, so its CTR-vs-clicks unit bug cannot change these verdicts; noted, not reimplemented.",
    overall: summarize(reads),
    bySelection,
    byTierRandomLane: byTier,
    reads,
  };
  writeJson(stepOutputPath("step4-old-baseline"), out);
  console.log(`[step4] OLD classifier baseline (calibration set)`);
  console.log(`  overall     n=${out.overall.n} FPR=${out.overall.fpr?.toFixed(3)}`);
  console.log(`  random lane n=${bySelection.random.n} FPR=${bySelection.random.fpr?.toFixed(3)}`);
  console.log(`  shadow lane n=${bySelection.shadow.n} FPR=${bySelection.shadow.fpr?.toFixed(3)}`);
}

main().catch((e) => {
  console.error("[step4] FAILED:", e instanceof Error ? e.message : e);
  process.exit(1);
});
