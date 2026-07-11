/**
 * proof-gsc/validation - shared types for the C4 candidate classifier and its
 * frozen-artifact validation harness (proof-validation-protocol.md, Lane P3).
 *
 * PURE type definitions only. No I/O, no server-only, no imports from stores.
 * Every module in this directory is importable from plain node scripts
 * (scripts/proof-validation/*) and from vitest.
 */

import type { TrafficTier } from "../measure";

/** One finalized daily row from the immutable validation snapshot. */
export type SnapshotDailyRow = {
  /** Normalized path ("/persian-male-names"). */
  path: string;
  /** YYYY-MM-DD. */
  date: string;
  clicks: number;
  impressions: number;
  /** Impressions-weighted position (0 when no impressions). */
  position: number;
};

/** Window aggregate over [start, end) for one page. */
export type WindowAgg = {
  clicks: number;
  impressions: number;
  /** clicks / impressions, 0 when impressions is 0. */
  ctr: number;
  /** Impressions-weighted position, 0 when impressions is 0. */
  position: number;
  /** How many calendar days of the window the snapshot covers. */
  daysCovered: number;
  /** Window length in days. */
  windowDays: number;
};

/** Pre-treatment page stats used by control matching. All computed from the
 *  28 day pre window ONLY (protocol L4: no post-treatment matching inputs). */
export type PreStats = {
  path: string;
  /** Mean daily clicks over the pre window. */
  clicksPerDay: number;
  /** OLS slope of daily clicks over the pre window (clicks/day per day). */
  slope: number;
  /** Sample standard deviation of daily clicks over the pre window. */
  stdDaily: number;
  /** Total impressions over the pre window. */
  impressions: number;
  /** Days of the pre window covered by the snapshot. */
  daysCovered: number;
};

/** The two releasable verdict lanes. Position and impressions are context
 *  only under C4 (protocol C5, C8) and have no lane here by design. */
export type C4Lane = "clicks" | "ctr";
export const C4_LANES: readonly C4Lane[] = ["clicks", "ctr"];

/** C4 verdict enum. "no_clear_effect" replaces the old "inconclusive" for a
 *  judged read inside noise; abstentions carry an explicit reason. */
export type C4Verdict = "won" | "lost" | "no_clear_effect" | "insufficient_data";

export type C4Abstention =
  | "insufficient_history"
  | "insufficient_baseline"
  | "no_clean_controls"
  | "missing_rate_data"
  | "thin_null";

export type C4Read = {
  verdict: C4Verdict;
  /** The judged diff-in-diff statistic (log lift for clicks, absolute CTR
   *  delta for ctr). Null when abstained before computing it. */
  stat: number | null;
  /** Two-sided permutation p against the matched null. Null when abstained. */
  permutationP: number | null;
  /** Size of the null the p was computed against (0 when abstained). */
  nullSize: number;
  /** The floor the statistic was judged against. Null when abstained. */
  floor: number | null;
  /** Why the read abstained (verdict insufficient_data), else null. */
  abstention: C4Abstention | null;
};

/** Matched control selection result. Strict pass only: the fallback path is
 *  banned from the verdict lane (protocol C10). */
export type MatchedControls = {
  /** Up to maxControls best strict survivors, distance ranked. */
  controls: string[];
  /** Predeclared replacement controls (next best strict survivors). */
  alternates: string[];
  /** True when fewer than minControls candidates passed the strict bands.
   *  The unit must abstain (no fallback admission). */
  insufficient: boolean;
};

/** One placebo unit: (page, pseudo ship date, window). */
export type PlaceboUnit = {
  /** Deterministic id: `${set}:${lane}:${window}:${path}:${date}`. */
  id: string;
  set: "calibration" | "evaluation";
  /** Placebo sampling lane (protocol C9): random stratified pages vs pages
   *  the engine's decliner selection would have picked. */
  selection: "random" | "shadow";
  windowDays: number;
  path: string;
  /** Pseudo ship date, YYYY-MM-DD. Also the calendar block id for the
   *  date-block bootstrap (units sharing a ship date share a block). */
  shipDate: string;
  /** Traffic tier at the unit's own pre window. */
  tier: TrafficTier;
  /** Page family stratum (first path segment based, "top-level" for single
   *  segment paths, rare families bucketed to "other"). */
  family: string;
  /** Matched controls chosen at build time from pre-date data only. */
  controls: string[];
  alternates: string[];
  /** True when strict matching found fewer than minControls survivors. */
  controlsInsufficient: boolean;
  /** True when the pre or post window overlaps a shock window. */
  shockOverlap: boolean;
};

/** One calibrated floor with its provenance. A tier with too few calibration
 *  units is NOT calibrated: its verdicts render no_clear_effect only
 *  (protocol C3 "not yet calibrated" rule). */
export type FloorEntry = {
  /** Floor on |stat| (log-lift units for clicks, absolute CTR for ctr). */
  floor: number;
  /** False when the tier lacked enough calibration units for a floor. */
  calibrated: boolean;
  /** Calibration units behind this floor. */
  n: number;
  /** True when LOO stability widening raised the floor (protocol step 5). */
  widened: boolean;
};

/** Per tier floors for one (lane, window). */
export type FloorsByTier = Record<TrafficTier, FloorEntry>;

/** floors[lane][windowDays][tier] = floor entry. */
export type C4Floors = Record<C4Lane, Record<string, FloorsByTier>>;

/** The frozen candidate artifact (c4-frozen.json). Every rule the classifier
 *  uses lives here so the SHA-256 of this file IS the classifier version. */
export type C4FrozenConfig = {
  version: string;
  runId: string;
  /** Windows the harness validates. Primary verdict window per C7. */
  windows: number[];
  primaryWindowDays: number;
  preWindowDays: number;
  lanes: C4Lane[];
  /** Action types judged on CTR; position actions remap to clicks (C5);
   *  everything else is clicks. */
  ctrActions: string[];
  positionActionsRemapToClicks: boolean;
  minBaselineImpressions: number;
  minControls: number;
  maxControls: number;
  alternateCount: number;
  matching: {
    scaleBand: { min: number; max: number };
    minBaselineForRatio: number;
    maxSlopeDivergence: number;
    varianceBand: { min: number; max: number };
    varianceRegularizer: number;
    minCandidateImpressions: number;
  };
  controlReuseCap: number;
  permutation: {
    alpha: number;
    minNullStats: number;
    maxNullPages: number;
    /** Week-aligned placement offsets (days, multiples of 7) for the block
     *  permutation over calendar (protocol L2). */
    placementOffsetsDays: number[];
    nullControlReuseCap: number;
  };
  /** Hard minimums the calibrated floors can only raise (stricter-only). */
  minFloors: Record<C4Lane, number>;
  /** Calibrated floors. Placeholder (minFloors everywhere) at step 2 freeze;
   *  final after step 5 + LOO widening; hash locked at step 7. */
  floors: C4Floors;
  floorRule: string;
  shadowSelection: {
    minPriorWindowClicks: number;
    minDropFraction: number;
    topKPerDate: number;
  };
  statistics: {
    clicks: string;
    ctr: string;
  };
  missingDataRule: string;
  notes: string[];
};

/** Old-classifier (deployed rules) placebo read, for the step 4 baseline. */
export type OldClassifierRead = {
  clicksVerdict: string;
  ctrVerdict: string;
  /** aa-calibration.ts rule: flagged when EITHER metric read won or lost. */
  flagged: boolean;
  /** True when the clicks or ctr won came from the impressions upgrade. */
  wonOnImpressions: boolean;
};

export type { TrafficTier };
