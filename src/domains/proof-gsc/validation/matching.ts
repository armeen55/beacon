/**
 * C4 matched-control selection. PRE-TREATMENT INPUTS ONLY (protocol L4):
 * scale (baseline clicks per day), variance (daily clicks std), trend (OLS
 * slope), all over the 28 day pre window before the (pseudo) ship date.
 *
 * Differences from the deployed control-matching.ts, per protocol C10:
 *   - NO fallback admission. Fewer than minControls strict survivors means
 *     the unit ABSTAINS (insufficient), never a weakly controlled verdict.
 *   - Predeclared alternates: the next best strict survivors are stamped at
 *     selection time so contamination is handled by replacement from a
 *     frozen list, never a post-hoc re-selection.
 *   - A variance band joins the scale and trend bands (Lane P3 packet).
 *
 * Query overlap (SUTVA) is not computable from the page-grain snapshot; the
 * harness matches on scale, variance, trend only and the report says so.
 */

import type { C4FrozenConfig, MatchedControls, PreStats } from "./types";
import { hashKey } from "./rng";

export type MatchBands = C4FrozenConfig["matching"];

/** One candidate's strict-band evaluation. Exposed for tests and receipts. */
export type CandidateMatch = {
  path: string;
  pass: boolean;
  reason: string;
  distance: number;
};

export function evaluateCandidate(treated: PreStats, cand: PreStats, bands: MatchBands): CandidateMatch {
  if (cand.impressions < bands.minCandidateImpressions) {
    return { path: cand.path, pass: false, reason: "below_baseline_impressions", distance: Number.POSITIVE_INFINITY };
  }
  // Scale band, with the deployed near-zero rule: a near-zero treated
  // baseline requires a near-zero candidate baseline.
  let scaleOk: boolean;
  let scaleRatio: number | null = null;
  if (treated.clicksPerDay < bands.minBaselineForRatio) {
    scaleOk = cand.clicksPerDay < bands.minBaselineForRatio;
  } else {
    scaleRatio = cand.clicksPerDay / treated.clicksPerDay;
    scaleOk = scaleRatio >= bands.scaleBand.min && scaleRatio <= bands.scaleBand.max;
  }
  if (!scaleOk) {
    return { path: cand.path, pass: false, reason: "scale_mismatch", distance: Number.POSITIVE_INFINITY };
  }
  const slopeDiff = Math.abs(cand.slope - treated.slope);
  if (slopeDiff > bands.maxSlopeDivergence) {
    return { path: cand.path, pass: false, reason: "trend_mismatch", distance: Number.POSITIVE_INFINITY };
  }
  // Variance band on a regularized std ratio (the regularizer keeps the
  // ratio defined for quiet pages without a special near-zero branch).
  const r = bands.varianceRegularizer;
  const varRatio = (cand.stdDaily + r) / (treated.stdDaily + r);
  if (varRatio < bands.varianceBand.min || varRatio > bands.varianceBand.max) {
    return { path: cand.path, pass: false, reason: "variance_mismatch", distance: Number.POSITIVE_INFINITY };
  }
  const scaleDist = Math.abs(Math.log((cand.clicksPerDay + r) / (treated.clicksPerDay + r)));
  const trendDist = bands.maxSlopeDivergence > 0 ? slopeDiff / bands.maxSlopeDivergence : slopeDiff;
  const varDist = Math.abs(Math.log(varRatio));
  return { path: cand.path, pass: true, reason: "matched", distance: scaleDist + trendDist + varDist };
}

/**
 * Select matched controls plus predeclared alternates for one treated unit.
 * Deterministic: survivors are ranked by distance, ties broken by a salted
 * hash of the path (never traffic order). `usage` carries the control-reuse
 * counter for the placebo set being built (protocol L2b); pass an empty map
 * for single reads. Candidates at or over the reuse cap are skipped BEFORE
 * band evaluation so bookkeeping is order-independent given a fixed unit
 * processing order.
 */
export function selectMatchedControls(args: {
  treated: PreStats;
  candidates: ReadonlyArray<PreStats>;
  bands: MatchBands;
  minControls: number;
  maxControls: number;
  alternateCount: number;
  usage?: Map<string, number>;
  reuseCap?: number;
  /** Salt for deterministic tie breaks (unit id). */
  salt: string;
}): MatchedControls {
  const usage = args.usage ?? new Map<string, number>();
  const cap = args.reuseCap ?? Number.POSITIVE_INFINITY;
  const evaluated: CandidateMatch[] = [];
  for (const cand of args.candidates) {
    if (cand.path === args.treated.path) continue;
    if ((usage.get(cand.path) ?? 0) >= cap) continue;
    const m = evaluateCandidate(args.treated, cand, args.bands);
    if (m.pass) evaluated.push(m);
  }
  evaluated.sort((a, b) => a.distance - b.distance || hashKey(a.path, args.salt) - hashKey(b.path, args.salt));
  const controls = evaluated.slice(0, args.maxControls).map((m) => m.path);
  const alternates = evaluated.slice(args.maxControls, args.maxControls + args.alternateCount).map((m) => m.path);
  const insufficient = controls.length < args.minControls;
  if (!insufficient) {
    for (const c of controls) usage.set(c, (usage.get(c) ?? 0) + 1);
  }
  return { controls, alternates, insufficient };
}
