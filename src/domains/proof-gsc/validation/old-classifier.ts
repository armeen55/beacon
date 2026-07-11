/**
 * Faithful reimplementation of the DEPLOYED verdict pipeline for the step 4
 * baseline ("old classifier FPR"). Runs the real pure math from measure.ts
 * (computeWindowLift + summarizeVerdict with the shipped default floors,
 * including the impressions upgrade path) against snapshot windows, with the
 * deployed A/A harness conventions reproduced deliberately, defects and all:
 *
 *   - Controls are the next-highest-traffic untreated pages (aa-calibration
 *     .ts pickPlaceboControls), NOT matched controls.
 *   - The deployed post-window control filter (a control with zero post
 *     impressions is dropped) is reproduced, post-treatment selection bias
 *     included (protocol L4a).
 *   - A placebo page is FLAGGED when EITHER the clicks or the CTR verdict
 *     reads won or lost (two chances per page, protocol L7).
 *   - The deployed permutation read is irrelevant here because it never
 *     gated a verdict, only HIGH confidence (the unit bug in
 *     run-measurement.ts lines 445 to 457 therefore cannot change a verdict;
 *     it is reported as context in the harness output, not reimplemented).
 *
 * Labeled OLD everywhere. Never used for anything except the baseline.
 */

import {
  addDays,
  computeWindowLift,
  proofCheckDates,
  summarizeVerdict,
  PROOF_WINDOW_DAYS,
  PROOF_BASELINE_WINDOW_DAYS,
  type GscWindowMetrics,
  type ProofWindowDay,
  type ProofWindowResult,
} from "../measure";
import type { OldClassifierRead } from "./types";
import { windowAgg, type SeriesIndex } from "./series";

function toMetrics(agg: { clicks: number; impressions: number; ctr: number; position: number }): GscWindowMetrics {
  return { clicks: agg.clicks, impressions: agg.impressions, ctr: agg.ctr, position: agg.position };
}

/** Deployed control pick: next-highest-traffic pages by trailing 90 day
 *  impressions before the pseudo ship date (aa-calibration.ts ordering). */
export function pickTopTrafficControls(args: {
  index: SeriesIndex;
  candidates: ReadonlyArray<string>;
  excludePath: string;
  shipDate: string;
  count?: number;
}): string[] {
  const count = args.count ?? 3;
  const scored = args.candidates
    .filter((p) => p !== args.excludePath)
    .map((p) => ({
      path: p,
      impressions90d: windowAgg(args.index, p, addDays(args.shipDate, -90), args.shipDate).impressions,
    }));
  scored.sort((a, b) => b.impressions90d - a.impressions90d || a.path.localeCompare(b.path));
  return scored.slice(0, count).map((s) => s.path);
}

/** One OLD-classifier placebo read at (path, pseudo ship date). */
export function oldClassifierRead(args: {
  index: SeriesIndex;
  path: string;
  shipDate: string;
  controls: ReadonlyArray<string>;
  lastFinalizedDate: string;
}): OldClassifierRead {
  const { index, path, shipDate } = args;
  const preStart = addDays(shipDate, -PROOF_BASELINE_WINDOW_DAYS);
  const treatedPre = windowAgg(index, path, preStart, shipDate);
  const checks = proofCheckDates(shipDate);
  const windows: ProofWindowResult[] = [];
  for (const day of PROOF_WINDOW_DAYS) {
    const checkOn = checks[day as ProofWindowDay];
    const ran = args.lastFinalizedDate >= addDays(checkOn, -1);
    const postEnd = addDays(shipDate, day);
    const controls = args.controls
      .map((cp) => ({
        pre: windowAgg(index, cp, preStart, shipDate),
        post: windowAgg(index, cp, shipDate, postEnd),
      }))
      // Deployed filter reproduced: pre presence required AND, once the
      // window ran, post presence required (post-treatment selection, L4a).
      .filter((c) => c.pre.impressions > 0 && (!ran || c.post.impressions > 0))
      .map((c) => ({ pre: toMetrics(c.pre), post: toMetrics(c.post) }));
    windows.push(
      computeWindowLift({
        day: day as ProofWindowDay,
        checkOn,
        ran,
        treatedPre: toMetrics(treatedPre),
        treatedPost: toMetrics(windowAgg(index, path, shipDate, postEnd)),
        controls,
        preWindowDays: PROOF_BASELINE_WINDOW_DAYS,
      }),
    );
  }
  const clicksRead = summarizeVerdict({
    windows,
    baselineImpressions: treatedPre.impressions,
    baselineClicks: treatedPre.clicks,
    metric: "clicks",
  });
  const ctrRead = summarizeVerdict({
    windows,
    baselineImpressions: treatedPre.impressions,
    baselineClicks: treatedPre.clicks,
    metric: "ctr",
  });
  const decided = (v: string) => v === "won" || v === "lost";
  return {
    clicksVerdict: clicksRead.verdict,
    ctrVerdict: ctrRead.verdict,
    flagged: decided(clicksRead.verdict) || decided(ctrRead.verdict),
    wonOnImpressions: clicksRead.wonOnImpressions || ctrRead.wonOnImpressions,
  };
}
