/**
 * The C4 frozen candidate config factory (runbook step 2). Every rule,
 * band, transform, gate order, and window plan the classifier uses lives in
 * the object this returns; scripts serialize it to c4-frozen.json and its
 * SHA-256 is the classifier version (protocol L1 mitigation).
 *
 * Floors ship as UNCALIBRATED placeholders at freeze time (step 2); step 5
 * calibrates them on the CALIBRATION set only; step 7 locks the final file.
 */

import { DEFAULT_MIN_LIFT_CTR, TRAFFIC_TIERS } from "../measure";
import type { C4FrozenConfig, C4Lane, C4Floors, FloorsByTier } from "./types";

/** Action types the deployed pickProofMetric routes to CTR (documentary
 *  copy; the code path derives from pickProofMetric via judgedLaneOf). */
const CTR_ACTIONS_DOCUMENTARY = [
  "title", "edit_title", "meta", "edit_meta", "h1", "change_h1",
  "intro_answer_block", "answer_block", "faq", "schema", "add_schema", "fix_schema",
];

/** Hard minimums the calibration can only raise. Clicks lane floor is in
 *  log-lift units: log(1.1) is a 10 percent relative lift, mirroring the
 *  deployed MIN_LIFT_FRACTION; CTR keeps the deployed 0.3pp absolute floor. */
export const MIN_FLOORS: Record<C4Lane, number> = {
  clicks: Math.log(1.1),
  ctr: DEFAULT_MIN_LIFT_CTR,
};

function placeholderFloors(windows: number[]): C4Floors {
  const perTier = (minFloor: number): FloorsByTier => {
    const out = {} as FloorsByTier;
    for (const tier of TRAFFIC_TIERS) {
      out[tier] = { floor: minFloor, calibrated: false, n: 0, widened: false };
    }
    return out;
  };
  const floors = {} as C4Floors;
  for (const lane of ["clicks", "ctr"] as const) {
    floors[lane] = {};
    for (const w of windows) floors[lane][String(w)] = perTier(MIN_FLOORS[lane]);
  }
  return floors;
}

export function buildFrozenConfig(args: { runId: string; version: string }): C4FrozenConfig {
  const windows = [7, 28];
  return {
    version: args.version,
    runId: args.runId,
    windows,
    primaryWindowDays: 28,
    preWindowDays: 28,
    lanes: ["clicks", "ctr"],
    ctrActions: CTR_ACTIONS_DOCUMENTARY,
    positionActionsRemapToClicks: true,
    minBaselineImpressions: 200,
    minControls: 2,
    maxControls: 3,
    alternateCount: 2,
    matching: {
      scaleBand: { min: 0.25, max: 4.0 },
      minBaselineForRatio: 0.5,
      maxSlopeDivergence: 0.6,
      varianceBand: { min: 0.25, max: 4.0 },
      varianceRegularizer: 0.5,
      minCandidateImpressions: 200,
    },
    controlReuseCap: 5,
    permutation: {
      alpha: 0.05,
      minNullStats: 40,
      maxNullPages: 60,
      placementOffsetsDays: [0, -28, 28, -56, 56],
      nullControlReuseCap: 5,
    },
    minFloors: MIN_FLOORS,
    floors: placeholderFloors(windows),
    floorRule:
      "floor(lane, window, tier) = max(minFloor, p95 |calibration placebo stat|), LOO widened to the LOO max when any single-unit drop moves it more than 20 percent; a tier with fewer than 20 calibration units is not calibrated and renders no_clear_effect only",
    shadowSelection: {
      // 5 clicks per prior 28d window: low, deliberately. The engine's
      // revival lane targets small declining pages on this tenant, and the
      // census (P = 74) showed a 10 click floor starves the shadow lane
      // below certifiable counts. Set BEFORE any placebo verdict was read
      // (freeze log records the iteration).
      minPriorWindowClicks: 5,
      minDropFraction: 0.25,
      topKPerDate: 12,
    },
    statistics: {
      clicks:
        "diff in diff of log(clicks + 1) with the pre window scaled to the post window length: [log(post+1) - log(pre*scale+1)] treated minus the mean of the same quantity over matched controls (variance stabilized relative lift, protocol L8)",
      ctr: "diff in diff of absolute CTR: (postCtr - preCtr) treated minus mean over matched controls with valid rates; a window with zero impressions is missing data, never a zero rate",
    },
    missingDataRule:
      "a control with no post window rate data makes the record insufficient_data when valid survivors fall below minControls; missing controls are never replaced at read time (L4); contamination replacements come only from predeclared alternates",
    notes: [
      "impressions are context only; the summarizeVerdict upgrade path does not exist in C4 (C8)",
      "position is context only; position lever action types remap to the clicks lane (C5)",
      "the permutation gate gates the VERDICT at alpha, not confidence (C6); the null is the same statistic with matched controls per null page, block placed at whole week offsets (L2, L10)",
      "no fallback admitted controls in the verdict lane; strict matching or abstention (C10)",
      "query overlap matching is not computable from the page grain snapshot; matching is scale, variance, trend only",
    ],
  };
}
