/**
 * Phase 2B (hardened) — Natural-controls attribution engine.
 *
 * Honest lift estimation for URL-level on-site changes. Given a classified
 * change event on a treated URL, find comparable untreated URLs ("natural
 * controls") and report `adjusted_lift = treated_delta - mean(control_deltas)`
 * per platform.
 *
 * v1 hardening (Phase 2B.5) adds:
 *   - type-level split: `overall` exists ONLY when diff-in-diff is real;
 *     `raw_pre_post` carries treated-only numbers when controls are unavailable.
 *     Consumers cannot accidentally read a weak_estimate as adjusted lift.
 *   - platform-aware control filtering: a URL with no Perplexity citations
 *     in the pre window cannot serve as a Perplexity control.
 *   - pre-trend matching: candidates whose pre-window slope diverges from the
 *     treated URL by more than `maxTrendSlopeDivergence` are rejected.
 *   - stricter "computed" threshold: `minControlsForComputed` (default 2).
 *     Below that, status = "weak_estimate" and `overall` stays null.
 *
 * Design contract (unchanged):
 *   - v1 scope: `change` layer, `scope === "single_url"`, parent events only.
 *   - Sitewide / infra / offsite / noise / finding / status are rejected with a
 *     structured reason.
 *   - Citations are the primary metric. Mentions/visibility are not yet wired.
 *   - Pure functions. No I/O. Caller supplies history + classified events.
 *   - Coexists with (does NOT replace) `url-verdict.ts`.
 */

import type { ClassifiedEvent } from "./change-taxonomy";
import {
  denseSeries,
  normalizeUrl,
  type UrlCitationHistory,
  type UrlCitationSeries,
} from "../product/url-citation-history";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export type NaturalControlsConfig = {
  /** Days of history to read BEFORE treatment date (inclusive, excluding treatment day). */
  preWindowDays: number;
  /** Days of history to read AFTER treatment date (inclusive, excluding treatment day). */
  postWindowDays: number;
  /** Minimum total pre-window citations on a candidate URL (for aggregate control pool). */
  minControlPreCitations: number;
  /** Minimum pre-window citations on the target PLATFORM for a platform-specific control pool. */
  minControlPreCitationsPerPlatform: number;
  /**
   * Minimum number of viable controls needed for status = "computed". Below this,
   * result is `weak_estimate` and `overall` stays null.
   */
  minControlsForComputed: number;
  /** Minimum controls for confidence = "high". Must be ≥ minControlsForComputed. */
  minControlsForHighConfidence: number;
  /**
   * Exclusion buffer for control candidates: any URL that had its own treatment
   * within [treatment_date - buffer, treatment_date + postWindowDays] is disqualified.
   */
  overlapBufferDaysBefore: number;
  /** Below this baseline level, relative_lift is suppressed to null. */
  minMuPreForRelative: number;
  /**
   * Max allowed ratio between candidate and treated baseline means (level similarity).
   * Controls outside this range are excluded as mismatched baselines.
   */
  baselineSimilarityRatio: { min: number; max: number };
  /**
   * Max allowed absolute difference of pre-window linear regression slopes between
   * treated and candidate (cit/day per day). Controls outside this range are
   * excluded as mismatched trends. Default tolerates moderate divergence.
   */
  maxTrendSlopeDivergence: number;
  /** Today's date (ISO YYYY-MM-DD). If omitted, uses the history `date_range.last`. */
  today?: string;
};

export const DEFAULT_CONFIG: NaturalControlsConfig = {
  preWindowDays: 14,
  postWindowDays: 14,
  minControlPreCitations: 3,
  minControlPreCitationsPerPlatform: 1,
  minControlsForComputed: 2,
  minControlsForHighConfidence: 3,
  overlapBufferDaysBefore: 7,
  minMuPreForRelative: 0.5,
  baselineSimilarityRatio: { min: 0.25, max: 4.0 },
  maxTrendSlopeDivergence: 0.6,
};

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type ResultStatus =
  | "computed" //                full diff-in-diff with ≥ minControlsForComputed controls
  | "weak_estimate" //           treated pre/post numbers available but no real diff-in-diff
  | "insufficient_baseline" //    not enough pre-period data on the treated URL
  | "insufficient_post_data" //   not enough post-period data
  | "no_controls" //              zero viable controls even at the minimum bar
  | "unsupported_scope" //        sitewide / infra / offsite / tenant-global
  | "ineligible_layer" //         non-change layer
  | "ineligible_event" //         low confidence / vague / bundle-child / no URL
  | "zero_signal"; //             treated URL has ~zero pre AND ~zero post

export type ConfidenceTier = "high" | "medium" | "low";

/**
 * A diff-in-diff estimate. Exists only when ≥ minControlsForComputed controls
 * passed similarity + trend + overlap filters. No `adjusted_lift` field is
 * ever populated for weak/no-control cases — they use `RawPrePost` instead.
 */
export type PlatformLift = {
  platform: string;
  treated_pre_avg: number;
  treated_post_avg: number;
  control_pre_avg: number;
  control_post_avg: number;
  treated_delta: number; // informational: treated_post - treated_pre
  control_delta: number; // informational: mean(control_post - control_pre)
  adjusted_lift: number; // the only causal-flavored number in this type
  relative_lift: number | null;
  controls_used: number;
  pre_days_observed: number;
  post_days_observed: number;
};

/**
 * Reference numbers for weak / no-control / insufficient-data cases.
 * Structurally separate from PlatformLift — NO adjusted_lift field, NO control
 * averages. Consumers must acknowledge these are treated-only descriptives.
 */
export type RawPrePost = {
  platform: string;
  treated_pre_avg: number;
  treated_post_avg: number;
  treated_delta: number; // raw pre vs post only — NOT a causal estimate
  pre_days_observed: number;
  post_days_observed: number;
  /** Required disclaimer string for any UI that renders this block. */
  caveat: string;
};

export type NaturalControlResult = {
  event_id: string;
  primary_bucket: string;
  child_tags: string[];
  paired_with: string[];
  url: string | null;
  url_type: string | null;
  treatment_date: string;

  pre_window: { start: string; end: string } | null;
  post_window: { start: string; end: string } | null;

  /** Populated ONLY when status === "computed". Causal (diff-in-diff) estimate. */
  overall: PlatformLift | null;
  per_platform: PlatformLift[]; // same "computed" discipline: empty unless overall is populated

  /** Populated for weak_estimate / insufficient_post_data. Treated-only descriptives. */
  raw_overall: RawPrePost | null;
  raw_per_platform: RawPrePost[];

  matched_control_count: number;
  matched_control_urls: string[];
  excluded_control_count: number;
  /** Aggregate-pool exclusion histogram (used for status decision). */
  excluded_reasons: Record<string, number>;
  /**
   * Per-platform-pool exclusion histograms. Populated only when status==="computed"
   * (per-platform passes ran). Fills the gap where below_platform_floor and other
   * platform-specific exclusions used to disappear from the aggregate rollup.
   */
  excluded_reasons_by_platform: Record<string, Record<string, number>>;

  confidence: ConfidenceTier;
  status: ResultStatus;
  warnings: string[];
  rationale: string;

  bundle_parent_id: string | null;
  bundle_size: number;

  computed_at: string;
  classifier_version: string;
};

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export type EligibilityDecision =
  | { eligible: true }
  | { eligible: false; status: ResultStatus; reason: string };

export function eligibilityCheck(e: ClassifiedEvent): EligibilityDecision {
  if (e.taxonomy_layer !== "change") {
    return { eligible: false, status: "ineligible_layer", reason: `layer=${e.taxonomy_layer} — URL-level lift math applies only to 'change' layer events` };
  }
  if (e.scope !== "single_url") {
    return { eligible: false, status: "unsupported_scope", reason: `scope=${e.scope} — sitewide / infra-global / tenant-global changes need a separate model (v2)` };
  }
  if (!e.url) {
    return { eligible: false, status: "ineligible_event", reason: "no url on event" };
  }
  if (e.confidence === "low") {
    return { eligible: false, status: "ineligible_event", reason: "classifier confidence=low — event description too vague to attribute reliably" };
  }
  if (e.bundle_parent_id !== null) {
    return { eligible: false, status: "ineligible_event", reason: `bundle child (parent=${e.bundle_parent_id}) — attribute the parent instead` };
  }
  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Date / window helpers
// ---------------------------------------------------------------------------

export function dateKey(iso: string): string {
  return iso.length >= 10 ? iso.slice(0, 10) : iso;
}

export function shiftDate(iso: string, days: number): string {
  const t = new Date(iso + "T00:00:00Z").getTime() + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export type WindowPair = {
  pre: { start: string; end: string };
  post: { start: string; end: string };
  treatment: string;
};

export function buildWindows(treatmentDate: string, config: NaturalControlsConfig, clampToToday?: string): WindowPair {
  const t = dateKey(treatmentDate);
  const preEnd = shiftDate(t, -1);
  const preStart = shiftDate(preEnd, -(config.preWindowDays - 1));
  const postStart = shiftDate(t, 1);
  let postEnd = shiftDate(postStart, config.postWindowDays - 1);
  if (clampToToday && postEnd > clampToToday) postEnd = clampToToday;
  return { pre: { start: preStart, end: preEnd }, post: { start: postStart, end: postEnd }, treatment: t };
}

// ---------------------------------------------------------------------------
// Series extraction (dense, per-platform)
// ---------------------------------------------------------------------------

export function extractWindowSeries(
  series: UrlCitationSeries,
  range: { start: string; end: string },
  platform: string | null,
): Array<{ date: string; count: number }> {
  const dense = denseSeries(series, { first: range.start, last: range.end });
  if (platform === null) return dense;
  const byDate = new Map<string, number>();
  for (const d of series.daily) {
    if (d.date < range.start || d.date > range.end) continue;
    byDate.set(d.date, d.by_platform[platform] ?? 0);
  }
  return dense.map((d) => ({ date: d.date, count: byDate.get(d.date) ?? 0 }));
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  let s = 0;
  for (const n of nums) s += n;
  return s / nums.length;
}

function nonZeroCount(nums: number[]): number {
  let c = 0;
  for (const n of nums) if (n > 0) c += 1;
  return c;
}

/**
 * Ordinary-least-squares slope for a sequence indexed by position 0..N-1.
 * Returns 0 for empty or single-point inputs.
 */
export function linearSlope(nums: number[]): number {
  const n = nums.length;
  if (n < 2) return 0;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += nums[i];
    sumXY += i * nums[i];
    sumXX += i * i;
  }
  const denom = n * sumXX - sumX * sumX;
  if (denom === 0) return 0;
  return (n * sumXY - sumX * sumY) / denom;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Treatment index + control selection
// ---------------------------------------------------------------------------

export type TreatmentIndex = Map<string, string[]>;

export function buildTreatmentIndex(events: ClassifiedEvent[]): TreatmentIndex {
  const map: TreatmentIndex = new Map();
  for (const e of events) {
    if (e.taxonomy_layer !== "change") continue;
    if (!e.url) continue;
    const key = e.url;
    const d = dateKey(e.observed_at);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(d);
  }
  for (const [, list] of map) list.sort();
  return map;
}

export function hasTreatmentInRange(
  treatmentIndex: TreatmentIndex,
  url: string,
  startInclusive: string,
  endInclusive: string,
): boolean {
  const list = treatmentIndex.get(url);
  if (!list) return false;
  for (const d of list) if (d >= startInclusive && d <= endInclusive) return true;
  return false;
}

export type ControlCandidate = {
  url: string;
  series: UrlCitationSeries;
  url_type: string | null;
  pre_avg: number;
  post_avg: number;
  delta: number;
  pre_slope: number;
};

export type ControlExclusion =
  | "is_treated_url"
  | "treatment_overlap"
  | "not_owned"
  | "url_type_mismatch"
  | "below_baseline_floor"
  | "below_platform_floor"
  | "baseline_similarity_fail"
  | "trend_slope_fail"
  | "no_series";

export type FindControlsResult = {
  controls: ControlCandidate[];
  excluded: Record<ControlExclusion, number>;
};

/**
 * Returns controls appropriate for the given platform (null = aggregate).
 *
 * When `platform` is non-null, additional filter: candidate must have
 * ≥ config.minControlPreCitationsPerPlatform in its pre-window on that
 * platform. A URL with no Perplexity activity is not a Perplexity control.
 */
export function findControls(opts: {
  treatedUrl: string;
  treatedUrlType: string | null;
  treatedPreAvg: number;
  treatedPreSlope: number;
  window: WindowPair;
  history: UrlCitationHistory;
  treatmentIndex: TreatmentIndex;
  config: NaturalControlsConfig;
  platform: string | null;
  inferUrlType: (url: string) => string | null;
}): FindControlsResult {
  const excluded: Record<ControlExclusion, number> = {
    is_treated_url: 0,
    treatment_overlap: 0,
    not_owned: 0,
    url_type_mismatch: 0,
    below_baseline_floor: 0,
    below_platform_floor: 0,
    baseline_similarity_fail: 0,
    trend_slope_fail: 0,
    no_series: 0,
  };
  const controls: ControlCandidate[] = [];

  const overlapStart = shiftDate(opts.window.treatment, -opts.config.overlapBufferDaysBefore);
  const overlapEnd = opts.window.post.end;

  for (const candidate of opts.history.series) {
    if (!candidate.is_owned) { excluded.not_owned += 1; continue; }
    if (candidate.url === opts.treatedUrl) { excluded.is_treated_url += 1; continue; }
    if (hasTreatmentInRange(opts.treatmentIndex, candidate.url, overlapStart, overlapEnd)) {
      excluded.treatment_overlap += 1;
      continue;
    }

    const candidateType = opts.inferUrlType(candidate.url);
    if (opts.treatedUrlType && candidateType !== opts.treatedUrlType) {
      excluded.url_type_mismatch += 1;
      continue;
    }

    // Aggregate floor: total citations pre-window on this candidate
    const aggregatePre = extractWindowSeries(candidate, opts.window.pre, null).map((d) => d.count);
    const aggregateTotal = aggregatePre.reduce((a, b) => a + b, 0);
    if (aggregateTotal < opts.config.minControlPreCitations) {
      excluded.below_baseline_floor += 1;
      continue;
    }

    // Platform-aware floor
    const preCounts = extractWindowSeries(candidate, opts.window.pre, opts.platform).map((d) => d.count);
    if (opts.platform !== null) {
      const platformTotal = preCounts.reduce((a, b) => a + b, 0);
      if (platformTotal < opts.config.minControlPreCitationsPerPlatform) {
        excluded.below_platform_floor += 1;
        continue;
      }
    }

    const postCounts = extractWindowSeries(candidate, opts.window.post, opts.platform).map((d) => d.count);
    if (preCounts.length === 0) {
      excluded.no_series += 1;
      continue;
    }

    const pre = mean(preCounts);
    const post = mean(postCounts);

    // Level similarity
    if (opts.treatedPreAvg > 0) {
      const ratio = pre / opts.treatedPreAvg;
      if (ratio < opts.config.baselineSimilarityRatio.min || ratio > opts.config.baselineSimilarityRatio.max) {
        excluded.baseline_similarity_fail += 1;
        continue;
      }
    }

    // Trend similarity
    const candidateSlope = linearSlope(preCounts);
    if (Math.abs(candidateSlope - opts.treatedPreSlope) > opts.config.maxTrendSlopeDivergence) {
      excluded.trend_slope_fail += 1;
      continue;
    }

    controls.push({
      url: candidate.url,
      series: candidate,
      url_type: candidateType,
      pre_avg: pre,
      post_avg: post,
      delta: post - pre,
      pre_slope: candidateSlope,
    });
  }

  return { controls, excluded };
}

// ---------------------------------------------------------------------------
// Diff-in-differences calculator
// ---------------------------------------------------------------------------

/** Compute a PlatformLift. Caller must guarantee controls.length >= minControlsForComputed. */
export function computeDiffInDiff(
  treated: { pre_avg: number; post_avg: number; pre_days_observed: number; post_days_observed: number },
  controls: ControlCandidate[],
  config: NaturalControlsConfig,
  platform: string,
): PlatformLift {
  const treatedDelta = treated.post_avg - treated.pre_avg;
  const controlPreAvg = mean(controls.map((c) => c.pre_avg));
  const controlPostAvg = mean(controls.map((c) => c.post_avg));
  const controlDelta = mean(controls.map((c) => c.delta));
  const adjustedLift = treatedDelta - controlDelta;
  const denom = Math.max(treated.pre_avg, config.minMuPreForRelative);
  const relativeLift = treated.pre_avg >= config.minMuPreForRelative ? adjustedLift / denom : null;
  return {
    platform,
    treated_pre_avg: round(treated.pre_avg),
    treated_post_avg: round(treated.post_avg),
    control_pre_avg: round(controlPreAvg),
    control_post_avg: round(controlPostAvg),
    treated_delta: round(treatedDelta),
    control_delta: round(controlDelta),
    adjusted_lift: round(adjustedLift),
    relative_lift: relativeLift === null ? null : round(relativeLift),
    controls_used: controls.length,
    pre_days_observed: treated.pre_days_observed,
    post_days_observed: treated.post_days_observed,
  };
}

function buildRawPrePost(
  treated: { pre_avg: number; post_avg: number; pre_days_observed: number; post_days_observed: number },
  platform: string,
  caveat: string,
): RawPrePost {
  return {
    platform,
    treated_pre_avg: round(treated.pre_avg),
    treated_post_avg: round(treated.post_avg),
    treated_delta: round(treated.post_avg - treated.pre_avg),
    pre_days_observed: treated.pre_days_observed,
    post_days_observed: treated.post_days_observed,
    caveat,
  };
}

// ---------------------------------------------------------------------------
// Confidence grading
// ---------------------------------------------------------------------------

export function gradeConfidence(opts: {
  controls_used: number;
  treated_pre_avg: number;
  post_days_observed: number;
  full_post_window_days: number;
  config: NaturalControlsConfig;
}): { tier: ConfidenceTier; warnings: string[] } {
  const warnings: string[] = [];
  let tier: ConfidenceTier = "high";

  if (opts.controls_used < opts.config.minControlsForComputed) {
    tier = "low";
    warnings.push(
      `no_diff_in_diff: only ${opts.controls_used} viable control(s), need ≥${opts.config.minControlsForComputed} for computed status`,
    );
    return { tier, warnings };
  }
  if (opts.controls_used < opts.config.minControlsForHighConfidence) {
    tier = "medium";
    warnings.push(
      `thin_control_set: ${opts.controls_used} viable control(s), target ≥${opts.config.minControlsForHighConfidence} for HIGH`,
    );
  }
  if (opts.treated_pre_avg < opts.config.minMuPreForRelative) {
    if (tier === "high") tier = "medium";
    warnings.push(
      `low_baseline: treated URL baseline=${round(opts.treated_pre_avg)} cit/day is near zero — relative lift suppressed`,
    );
  }
  if (opts.post_days_observed === 0 && opts.full_post_window_days > 0) {
    tier = "low";
    warnings.push(`no_post_data: treated URL had zero citations on any post-window day`);
  }
  return { tier, warnings };
}

// ---------------------------------------------------------------------------
// Per-event orchestrator
// ---------------------------------------------------------------------------

export type AttributeInputs = {
  event: ClassifiedEvent;
  history: UrlCitationHistory;
  treatmentIndex: TreatmentIndex;
  config: NaturalControlsConfig;
  inferUrlType: (url: string) => string | null;
  classifierVersion: string;
};

export function attributeEvent(inputs: AttributeInputs): NaturalControlResult {
  const { event, history, treatmentIndex, config, inferUrlType, classifierVersion } = inputs;
  const elig = eligibilityCheck(event);
  if (!elig.eligible) return emptyResult(event, classifierVersion, elig.status, elig.reason, "low");

  const treatedUrl = normalizeUrl(event.url);
  if (!treatedUrl) return emptyResult(event, classifierVersion, "ineligible_event", "url failed to normalize", "low");

  const series = history.series.find((s) => s.url === treatedUrl);
  if (!series) {
    return emptyResult(event, classifierVersion, "insufficient_baseline", `no citation history for URL ${treatedUrl}`, "low");
  }

  const today = config.today ?? history.date_range.last ?? dateKey(event.observed_at);
  const windows = buildWindows(event.observed_at, config, today);

  // Truncate / reject if pre-window falls outside data range
  if (history.date_range.first && windows.pre.start < history.date_range.first) {
    if (history.date_range.first > windows.pre.end) {
      return emptyResult(event, classifierVersion, "insufficient_baseline",
        `treatment date ${windows.treatment} predates citation history (first=${history.date_range.first})`, "low", windows);
    }
    windows.pre.start = history.date_range.first;
  }
  if (history.date_range.last && windows.post.start > history.date_range.last) {
    return emptyResult(event, classifierVersion, "insufficient_post_data",
      `post window starts ${windows.post.start} but history ends ${history.date_range.last}`, "low", windows);
  }
  if (windows.post.end > today) windows.post.end = today;

  const treatedPreAll = extractWindowSeries(series, windows.pre, null).map((d) => d.count);
  const treatedPostAll = extractWindowSeries(series, windows.post, null).map((d) => d.count);
  const treatedPreAvgAll = mean(treatedPreAll);
  const treatedPostAvgAll = mean(treatedPostAll);
  const treatedPreSlopeAll = linearSlope(treatedPreAll);

  if (treatedPreAvgAll === 0 && treatedPostAvgAll === 0) {
    return emptyResult(event, classifierVersion, "zero_signal",
      `treated URL has no citations in either pre [${windows.pre.start}..${windows.pre.end}] or post [${windows.post.start}..${windows.post.end}]`,
      "low", windows);
  }

  const treatedUrlType = event.url_type ?? inferUrlType(treatedUrl);

  // Aggregate (platform=null) control pool
  const { controls: aggControls, excluded } = findControls({
    treatedUrl,
    treatedUrlType,
    treatedPreAvg: treatedPreAvgAll,
    treatedPreSlope: treatedPreSlopeAll,
    window: windows,
    history,
    treatmentIndex,
    config,
    platform: null,
    inferUrlType,
  });

  const treatedAggAgg = {
    pre_avg: treatedPreAvgAll,
    post_avg: treatedPostAvgAll,
    pre_days_observed: nonZeroCount(treatedPreAll),
    post_days_observed: nonZeroCount(treatedPostAll),
  };

  const aggWarnings: string[] = [];

  // Self-overlap detection
  if (hasTreatmentInRange(treatmentIndex, treatedUrl, shiftDate(windows.treatment, -config.overlapBufferDaysBefore), shiftDate(windows.treatment, -1))) {
    aggWarnings.push(`treated_url_self_overlap: another change on the same URL within the pre-buffer — treated baseline may reflect both edits`);
  }
  if (hasTreatmentInRange(treatmentIndex, treatedUrl, shiftDate(windows.treatment, 1), windows.post.end)) {
    aggWarnings.push(`treated_url_post_overlap: another change on the same URL landed during the post window — lift cannot be isolated to this event`);
  }

  const graded = gradeConfidence({
    controls_used: aggControls.length,
    treated_pre_avg: treatedPreAvgAll,
    post_days_observed: treatedAggAgg.post_days_observed,
    full_post_window_days: config.postWindowDays,
    config,
  });
  const warnings = [...aggWarnings, ...graded.warnings];

  // Decide status
  let status: ResultStatus;
  let overall: PlatformLift | null = null;
  let rawOverall: RawPrePost | null = null;
  const perPlatform: PlatformLift[] = [];
  const rawPerPlatform: RawPrePost[] = [];
  const excludedReasonsByPlatform: Record<string, Record<string, number>> = {};

  const platforms = new Set<string>();
  for (const d of series.daily) {
    if (d.date >= windows.pre.start && d.date <= windows.post.end) {
      for (const p of Object.keys(d.by_platform)) platforms.add(p);
    }
  }

  if (treatedAggAgg.post_days_observed === 0 && treatedPostAvgAll === 0) {
    status = "insufficient_post_data";
    rawOverall = buildRawPrePost(treatedAggAgg, "overall",
      "no post-window citations observed on treated URL; treated_delta reflects pre-window only");
  } else if (aggControls.length >= config.minControlsForComputed) {
    status = "computed";
    overall = computeDiffInDiff(treatedAggAgg, aggControls, config, "overall");

    // Per-platform: rebuild the control pool FOR EACH PLATFORM (platform-aware filtering)
    for (const p of platforms) {
      const tPre = extractWindowSeries(series, windows.pre, p).map((d) => d.count);
      const tPost = extractWindowSeries(series, windows.post, p).map((d) => d.count);
      const tPreAvg = mean(tPre);
      const tPostAvg = mean(tPost);
      const tPreSlope = linearSlope(tPre);

      const platformPool = findControls({
        treatedUrl,
        treatedUrlType,
        treatedPreAvg: tPreAvg,
        treatedPreSlope: tPreSlope,
        window: windows,
        history,
        treatmentIndex,
        config,
        platform: p,
        inferUrlType,
      });
      // Preserve per-platform-pool exclusions so the store can show operators
      // why e.g. ChatGPT had no controls even though aggregate controls existed.
      const platformExclHist: Record<string, number> = {};
      for (const [k, v] of Object.entries(platformPool.excluded)) if (v > 0) platformExclHist[k] = v;
      excludedReasonsByPlatform[p] = platformExclHist;

      const treatedPlatform = {
        pre_avg: tPreAvg,
        post_avg: tPostAvg,
        pre_days_observed: nonZeroCount(tPre),
        post_days_observed: nonZeroCount(tPost),
      };

      if (platformPool.controls.length >= config.minControlsForComputed) {
        perPlatform.push(computeDiffInDiff(treatedPlatform, platformPool.controls, config, p));
      } else {
        rawPerPlatform.push(
          buildRawPrePost(
            treatedPlatform,
            p,
            `insufficient platform controls (${platformPool.controls.length} viable, need ≥${config.minControlsForComputed}); raw treated pre/post only`,
          ),
        );
      }
    }
  } else if (aggControls.length >= 1) {
    status = "weak_estimate";
    warnings.push(
      `weak_estimate: only ${aggControls.length} viable control(s), need ≥${config.minControlsForComputed} for diff-in-diff — emitting raw treated pre/post only`,
    );
    rawOverall = buildRawPrePost(treatedAggAgg, "overall",
      `${aggControls.length} control(s) found but below computed threshold — raw treated numbers only, not a causal estimate`);
    for (const p of platforms) {
      const tPre = extractWindowSeries(series, windows.pre, p).map((d) => d.count);
      const tPost = extractWindowSeries(series, windows.post, p).map((d) => d.count);
      rawPerPlatform.push(
        buildRawPrePost(
          {
            pre_avg: mean(tPre),
            post_avg: mean(tPost),
            pre_days_observed: nonZeroCount(tPre),
            post_days_observed: nonZeroCount(tPost),
          },
          p,
          `raw treated pre/post for ${p} — below computed threshold at aggregate level`,
        ),
      );
    }
  } else {
    status = "no_controls";
    warnings.push(`no_viable_controls: zero candidates passed similarity/trend/overlap filters`);
    rawOverall = buildRawPrePost(treatedAggAgg, "overall", "no viable controls — raw treated pre/post only, not a causal estimate");
    for (const p of platforms) {
      const tPre = extractWindowSeries(series, windows.pre, p).map((d) => d.count);
      const tPost = extractWindowSeries(series, windows.post, p).map((d) => d.count);
      rawPerPlatform.push(
        buildRawPrePost(
          {
            pre_avg: mean(tPre),
            post_avg: mean(tPost),
            pre_days_observed: nonZeroCount(tPre),
            post_days_observed: nonZeroCount(tPost),
          },
          p,
          `no viable controls — ${p} raw treated pre/post only`,
        ),
      );
    }
  }

  const excludedReasonsHist: Record<string, number> = {};
  for (const [k, v] of Object.entries(excluded)) if (v > 0) excludedReasonsHist[k] = v;

  const rationale = buildRationale(event, status, graded.tier, aggControls.length, overall, rawOverall, warnings);

  return {
    event_id: event.source_id,
    primary_bucket: event.primary_bucket,
    child_tags: event.child_tags,
    paired_with: event.paired_with,
    url: treatedUrl,
    url_type: treatedUrlType,
    treatment_date: windows.treatment,
    pre_window: windows.pre,
    post_window: windows.post,
    overall,
    per_platform: perPlatform,
    raw_overall: rawOverall,
    raw_per_platform: rawPerPlatform,
    matched_control_count: aggControls.length,
    matched_control_urls: aggControls.map((c) => c.url),
    excluded_control_count: Object.values(excluded).reduce((a, b) => a + b, 0),
    excluded_reasons: excludedReasonsHist,
    excluded_reasons_by_platform: excludedReasonsByPlatform,
    confidence: graded.tier,
    status,
    warnings,
    rationale,
    bundle_parent_id: event.bundle_parent_id,
    bundle_size: event.bundle_size,
    computed_at: new Date().toISOString(),
    classifier_version: classifierVersion,
  };
}

function buildRationale(
  event: ClassifiedEvent,
  status: ResultStatus,
  tier: ConfidenceTier,
  controlCount: number,
  overall: PlatformLift | null,
  rawOverall: RawPrePost | null,
  warnings: string[],
): string {
  if (status === "computed" && overall) {
    const dir = overall.adjusted_lift > 0.05 ? "rose" : overall.adjusted_lift < -0.05 ? "fell" : "did not move";
    const relPart = overall.relative_lift !== null ? ` (${(overall.relative_lift * 100).toFixed(0)}% vs baseline)` : "";
    return `${event.primary_bucket} on ${event.url ?? "(no url)"}: adjusted_lift ${dir} by ${overall.adjusted_lift} cit/day${relPart}. N_controls=${controlCount}, confidence=${tier}.`;
  }
  if (status === "weak_estimate" && rawOverall) {
    return `${event.primary_bucket} on ${event.url ?? "(no url)"}: WEAK_ESTIMATE — raw treated_delta=${rawOverall.treated_delta} cit/day. No causal estimate available (${controlCount} control(s), need ≥${2}).`;
  }
  if (status === "no_controls" && rawOverall) {
    return `${event.primary_bucket} on ${event.url ?? "(no url)"}: NO_CONTROLS — raw treated_delta=${rawOverall.treated_delta} cit/day, not a causal estimate.`;
  }
  return `Not computed: status=${status}. ${warnings.join("; ")}`;
}

function emptyResult(
  event: ClassifiedEvent,
  classifierVersion: string,
  status: ResultStatus,
  reason: string,
  confidence: ConfidenceTier,
  windows?: WindowPair,
): NaturalControlResult {
  return {
    event_id: event.source_id,
    primary_bucket: event.primary_bucket,
    child_tags: event.child_tags,
    paired_with: event.paired_with,
    url: event.url,
    url_type: event.url_type,
    treatment_date: dateKey(event.observed_at),
    pre_window: windows ? windows.pre : null,
    post_window: windows ? windows.post : null,
    overall: null,
    per_platform: [],
    raw_overall: null,
    raw_per_platform: [],
    matched_control_count: 0,
    matched_control_urls: [],
    excluded_control_count: 0,
    excluded_reasons: {},
    excluded_reasons_by_platform: {},
    confidence,
    status,
    warnings: [reason],
    rationale: `Not computed: ${reason}`,
    bundle_parent_id: event.bundle_parent_id,
    bundle_size: event.bundle_size,
    computed_at: new Date().toISOString(),
    classifier_version: classifierVersion,
  };
}

// ---------------------------------------------------------------------------
// Batch runner + summary
// ---------------------------------------------------------------------------

export function attributeAll(
  events: ClassifiedEvent[],
  history: UrlCitationHistory,
  inferUrlType: (url: string) => string | null,
  classifierVersion: string,
  config: NaturalControlsConfig = DEFAULT_CONFIG,
): NaturalControlResult[] {
  const treatmentIndex = buildTreatmentIndex(events);
  const results: NaturalControlResult[] = [];
  for (const e of events) {
    results.push(attributeEvent({ event: e, history, treatmentIndex, config, inferUrlType, classifierVersion }));
  }
  return results;
}

export type AttributionSummary = {
  total_events: number;
  by_status: Record<string, number>;
  by_confidence: Record<string, number>;
  computed_lift_distribution: {
    positive_events: number;
    negative_events: number;
    near_zero_events: number;
    mean_adjusted_lift: number;
    median_adjusted_lift: number;
  };
  by_primary_bucket: Array<{
    bucket: string;
    n: number;
    computed: number;
    mean_adjusted_lift: number | null;
    mean_relative_lift: number | null;
  }>;
  excluded_reasons_aggregate: Record<string, number>;
};

export function summarize(results: NaturalControlResult[]): AttributionSummary {
  const byStatus: Record<string, number> = {};
  const byConf: Record<string, number> = {};
  const computed: NaturalControlResult[] = [];
  const exclHist: Record<string, number> = {};
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
    byConf[r.confidence] = (byConf[r.confidence] ?? 0) + 1;
    if (r.status === "computed" && r.overall !== null) computed.push(r);
    for (const [k, v] of Object.entries(r.excluded_reasons)) exclHist[k] = (exclHist[k] ?? 0) + v;
  }

  const lifts = computed.map((r) => r.overall!.adjusted_lift);
  const positive = lifts.filter((l) => l > 0.05).length;
  const negative = lifts.filter((l) => l < -0.05).length;
  const near_zero = lifts.length - positive - negative;
  const meanLift = lifts.length > 0 ? mean(lifts) : 0;
  const sortedLifts = [...lifts].sort((a, b) => a - b);
  const medianLift = sortedLifts.length === 0 ? 0 : sortedLifts[Math.floor(sortedLifts.length / 2)];

  const byBucket = new Map<string, { lifts: number[]; rels: number[]; n: number; computed: number }>();
  for (const r of results) {
    const agg = byBucket.get(r.primary_bucket) ?? { lifts: [], rels: [], n: 0, computed: 0 };
    agg.n += 1;
    if (r.status === "computed" && r.overall) {
      agg.computed += 1;
      agg.lifts.push(r.overall.adjusted_lift);
      if (r.overall.relative_lift !== null) agg.rels.push(r.overall.relative_lift);
    }
    byBucket.set(r.primary_bucket, agg);
  }

  const bucketRows = [...byBucket.entries()]
    .map(([bucket, v]) => ({
      bucket,
      n: v.n,
      computed: v.computed,
      mean_adjusted_lift: v.lifts.length > 0 ? round(mean(v.lifts)) : null,
      mean_relative_lift: v.rels.length > 0 ? round(mean(v.rels)) : null,
    }))
    .sort((a, b) => b.n - a.n);

  return {
    total_events: results.length,
    by_status: byStatus,
    by_confidence: byConf,
    computed_lift_distribution: {
      positive_events: positive,
      negative_events: negative,
      near_zero_events: near_zero,
      mean_adjusted_lift: round(meanLift),
      median_adjusted_lift: round(medianLift),
    },
    by_primary_bucket: bucketRows,
    excluded_reasons_aggregate: exclHist,
  };
}
