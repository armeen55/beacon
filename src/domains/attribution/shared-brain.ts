/**
 * Phase 2D — Shared-brain aggregator.
 *
 * Reads sanitized `BrainObservation[]` (from `brain-input.ts`) and emits
 * grouped pattern summaries. This file never sees a `StoredChangeOutcome`,
 * a URL, a source_id, or a tenant_id. If you find yourself importing those,
 * stop — you're on the wrong side of the anonymization boundary.
 *
 * DESIGN PRINCIPLES (enforced by tests):
 *   - Minimum-N discipline. Below threshold → `not_enough_evidence`, no claims.
 *   - Computed-first. Pattern claims derive from `computed` outcomes only.
 *     Weak/no_controls/unsupported are counted for prevalence + data-quality
 *     transparency but do not drive pattern language.
 *   - Per-platform thresholds are stricter than aggregate thresholds.
 *   - No causal language without earned N. `describePattern()` uses qualified
 *     associations ("usually associated with", "in this sample") until the
 *     strong_signal tier.
 */

import type {
  BrainObservation,
  WarningCategory,
} from "./brain-input";
import type { ConfidenceTier, ResultStatus } from "./natural-controls";

// ---------------------------------------------------------------------------
// Thresholds — the source of truth for pattern strength tiers
// ---------------------------------------------------------------------------

export type PatternStrength =
  | "not_enough_evidence"
  | "weak_signal"
  | "emerging_signal"
  | "strong_signal";

export type ThresholdSet = {
  weak: number;
  emerging: number;
  strong: number;
};

export const DEFAULT_AGGREGATE_THRESHOLDS: ThresholdSet = { weak: 3, emerging: 10, strong: 30 };
export const DEFAULT_PER_PLATFORM_THRESHOLDS: ThresholdSet = { weak: 5, emerging: 15, strong: 45 };

export type SharedBrainConfig = {
  /** Aggregate-pattern strength tiers (bucket + url_type grouping). */
  aggregateThresholds: ThresholdSet;
  /** Per-platform subpattern strength tiers. Must be ≥ aggregate. */
  perPlatformThresholds: ThresholdSet;
  /**
   * If set, group by `(primary_bucket, url_type, tenant_cohort)`. Otherwise
   * cohort is folded in (ignored for grouping). Start with cohort-less
   * grouping until there are ≥ 3 cohorts represented.
   */
  groupByTenantCohort: boolean;
  /**
   * Minimum cohort count before `groupByTenantCohort` is allowed to take
   * effect. Prevents accidentally surfacing a single-cohort pattern as if it
   * were cross-tenant.
   */
  minCohortsForCohortGrouping: number;
};

export const DEFAULT_CONFIG: SharedBrainConfig = {
  aggregateThresholds: DEFAULT_AGGREGATE_THRESHOLDS,
  perPlatformThresholds: DEFAULT_PER_PLATFORM_THRESHOLDS,
  groupByTenantCohort: false,
  minCohortsForCohortGrouping: 3,
};

// ---------------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------------

export type BrainGroupingKey = {
  primary_bucket: string;
  url_type: string | null;
  tenant_cohort?: string;
};

export type ComputedStats = {
  mean_relative_lift: number | null;
  median_relative_lift: number | null;
  positive_count: number;
  negative_count: number;
  near_zero_count: number;
};

export type PerPlatformPattern = {
  platform: string;
  total_n: number;
  computed_n: number;
  strength: PatternStrength;
  computed_stats: ComputedStats | null;
};

export type BrainPattern = {
  grouping: BrainGroupingKey;
  total_n: number;
  computed_n: number;
  status_mix: Partial<Record<ResultStatus, number>>;
  confidence_mix: Partial<Record<ConfidenceTier, number>>;
  /** Null when no computed outcomes in this group. */
  computed_stats: ComputedStats | null;
  /** Only platforms whose per-platform computed_n clears the weak threshold. */
  per_platform: PerPlatformPattern[];
  /** Count of each warning category across ALL outcomes in the group (not just computed). */
  warning_prevalence: Partial<Record<WarningCategory, number>>;
  strength: PatternStrength;
  /** Safe pattern sentence for UI consumption. Always conservative. */
  description: string;
  /** Number of distinct tenant_cohorts represented in this group. */
  cohort_count: number;
};

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function scorePatternStrength(
  computed_n: number,
  thresholds: ThresholdSet,
): PatternStrength {
  if (computed_n < thresholds.weak) return "not_enough_evidence";
  if (computed_n < thresholds.emerging) return "weak_signal";
  if (computed_n < thresholds.strong) return "emerging_signal";
  return "strong_signal";
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function mean(nums: number[]): number | null {
  if (nums.length === 0) return null;
  let s = 0;
  for (const n of nums) s += n;
  return round(s / nums.length);
}

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return round(sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]);
}

const POS_THRESHOLD = 0.05; // rel lift > 5% counts as positive
const NEG_THRESHOLD = -0.05;

function computedStatsFromLifts(lifts: number[]): ComputedStats | null {
  if (lifts.length === 0) return null;
  const positive_count = lifts.filter((l) => l > POS_THRESHOLD).length;
  const negative_count = lifts.filter((l) => l < NEG_THRESHOLD).length;
  const near_zero_count = lifts.length - positive_count - negative_count;
  return {
    mean_relative_lift: mean(lifts),
    median_relative_lift: median(lifts),
    positive_count,
    negative_count,
    near_zero_count,
  };
}

// ---------------------------------------------------------------------------
// describePattern — conservative by design
// ---------------------------------------------------------------------------

function bucketHuman(bucket: string): string {
  // Keep the taxonomy id readable in a sentence without decoration.
  // Returns the bucket id itself — callers who need prose can build it.
  return bucket;
}

/**
 * Build a safe, qualified sentence from a pattern. Never uses causal verbs.
 * Language scales with strength.
 */
export function describePattern(pattern: BrainPattern): string {
  const { strength, computed_n, total_n, computed_stats, grouping } = pattern;
  const scope = grouping.url_type ? `${grouping.url_type}-type pages` : "pages";
  const b = bucketHuman(grouping.primary_bucket);

  if (strength === "not_enough_evidence") {
    if (computed_n === 0 && total_n > 0) {
      return `Too few computed outcomes for ${b} on ${scope} to draw a reliable conclusion (${total_n} total observations, 0 with a diff-in-diff estimate).`;
    }
    return `Too few computed outcomes for ${b} on ${scope} to draw a reliable conclusion (N=${computed_n}).`;
  }

  if (!computed_stats) {
    return `No computed evidence available for ${b} on ${scope}.`;
  }

  const { positive_count, negative_count, near_zero_count, median_relative_lift } = computed_stats;
  const directionCall =
    positive_count > negative_count && positive_count >= Math.ceil(computed_n * 0.5)
      ? "positive"
      : negative_count > positive_count && negative_count >= Math.ceil(computed_n * 0.5)
        ? "negative"
        : "mixed";

  if (strength === "weak_signal") {
    if (directionCall === "mixed") {
      return `In this small sample (N=${computed_n}), ${b} on ${scope} shows mixed results (${positive_count} positive, ${negative_count} negative, ${near_zero_count} near zero). Confidence remains limited.`;
    }
    const word = directionCall === "positive" ? "positive" : "negative";
    return `In this small sample (N=${computed_n}), ${b} on ${scope} is usually associated with ${word} citation lift (${positive_count}/${computed_n} ${word}). Confidence remains limited.`;
  }

  if (strength === "emerging_signal") {
    const medPct = median_relative_lift === null ? "—" : `${Math.round(median_relative_lift * 100)}%`;
    if (directionCall === "mixed") {
      return `Across ${computed_n} computed outcomes, ${b} on ${scope} shows mixed results (median relative lift ${medPct}). Treat as emerging signal.`;
    }
    const word = directionCall === "positive" ? "positive" : "negative";
    return `Across ${computed_n} computed outcomes, ${b} on ${scope} is most often associated with ${word} citation lift (${positive_count}/${computed_n} ${word}, median ${medPct}). Emerging signal; not conclusive.`;
  }

  // strong_signal
  const medPct = median_relative_lift === null ? "—" : `${Math.round(median_relative_lift * 100)}%`;
  if (directionCall === "mixed") {
    return `${computed_n} computed outcomes of ${b} on ${scope} show mixed results (median relative lift ${medPct}). No consistent directional pattern.`;
  }
  const word = directionCall === "positive" ? "positive" : "negative";
  return `${computed_n} computed outcomes: ${b} on ${scope} associates consistently with ${word} citation lift (${positive_count}/${computed_n} ${word}, median ${medPct}). High-N pattern.`;
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

function keyFor(obs: BrainObservation, useCohort: boolean): string {
  const parts = [obs.primary_bucket, obs.url_type ?? "null"];
  if (useCohort) parts.push(obs.tenant_cohort ?? "null");
  return parts.join("||");
}

function parseKey(key: string, useCohort: boolean): BrainGroupingKey {
  const [primary_bucket, url_type_str, tenant_cohort_str] = key.split("||");
  const url_type = url_type_str === "null" ? null : url_type_str;
  const base: BrainGroupingKey = { primary_bucket, url_type };
  if (useCohort) {
    const tc = tenant_cohort_str === "null" || tenant_cohort_str === undefined ? undefined : tenant_cohort_str;
    if (tc !== undefined) base.tenant_cohort = tc;
  }
  return base;
}

/**
 * Main entry point. Takes sanitized observations and produces grouped
 * patterns. Always defensive — will not emit any claim below its strength
 * threshold, and per-platform patterns below `perPlatformThresholds.weak`
 * are suppressed entirely (not returned at all).
 */
export function aggregateBrainPatterns(
  observations: BrainObservation[],
  config: SharedBrainConfig = DEFAULT_CONFIG,
): BrainPattern[] {
  // Decide whether cohort grouping is actually viable on this dataset.
  const cohorts = new Set<string>();
  for (const o of observations) if (o.tenant_cohort) cohorts.add(o.tenant_cohort);
  const useCohort = config.groupByTenantCohort && cohorts.size >= config.minCohortsForCohortGrouping;

  // Bucket observations by key
  const groups = new Map<string, BrainObservation[]>();
  for (const o of observations) {
    const k = keyFor(o, useCohort);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(o);
  }

  const out: BrainPattern[] = [];
  for (const [key, obs] of groups) {
    out.push(buildPattern(parseKey(key, useCohort), obs, config));
  }

  out.sort((a, b) => b.computed_n - a.computed_n);
  return out;
}

function buildPattern(
  grouping: BrainGroupingKey,
  obs: BrainObservation[],
  config: SharedBrainConfig,
): BrainPattern {
  const total_n = obs.length;
  const computed = obs.filter((o) => o.status === "computed");
  const computed_n = computed.length;

  // Status + confidence mixes
  const status_mix: Partial<Record<ResultStatus, number>> = {};
  const confidence_mix: Partial<Record<ConfidenceTier, number>> = {};
  for (const o of obs) {
    status_mix[o.status] = (status_mix[o.status] ?? 0) + 1;
    confidence_mix[o.confidence] = (confidence_mix[o.confidence] ?? 0) + 1;
  }

  // Computed stats (relative lift only, computed outcomes only)
  const lifts = computed
    .map((o) => o.adjusted_lift_relative)
    .filter((l): l is number => l !== null);
  const computed_stats = computedStatsFromLifts(lifts);

  // Warning prevalence across all outcomes in group
  const warning_prevalence: Partial<Record<WarningCategory, number>> = {};
  for (const o of obs) {
    for (const cat of o.warning_categories) {
      warning_prevalence[cat] = (warning_prevalence[cat] ?? 0) + 1;
    }
  }

  // Per-platform rollups — require the stricter per-platform threshold
  const per_platform = buildPerPlatformRollups(computed, config);

  // Distinct cohorts represented
  const cohortSet = new Set<string>();
  for (const o of obs) if (o.tenant_cohort) cohortSet.add(o.tenant_cohort);

  const strength = scorePatternStrength(computed_n, config.aggregateThresholds);
  const pattern: BrainPattern = {
    grouping,
    total_n,
    computed_n,
    status_mix,
    confidence_mix,
    computed_stats,
    per_platform,
    warning_prevalence,
    strength,
    description: "", // filled below
    cohort_count: cohortSet.size,
  };
  pattern.description = describePattern(pattern);
  return pattern;
}

function buildPerPlatformRollups(
  computed: BrainObservation[],
  config: SharedBrainConfig,
): PerPlatformPattern[] {
  // Flatten (platform -> relative-lifts + counts)
  type Accum = { lifts: number[]; total_n: number; computed_n: number };
  const byPlatform = new Map<string, Accum>();

  for (const o of computed) {
    for (const p of o.per_platform) {
      let acc = byPlatform.get(p.platform);
      if (!acc) {
        acc = { lifts: [], total_n: 0, computed_n: 0 };
        byPlatform.set(p.platform, acc);
      }
      acc.total_n += 1;
      if (p.controls_used >= 1 && p.adjusted_lift_relative !== null) {
        acc.computed_n += 1;
        acc.lifts.push(p.adjusted_lift_relative);
      }
    }
  }

  const out: PerPlatformPattern[] = [];
  for (const [platform, acc] of byPlatform) {
    const strength = scorePatternStrength(acc.computed_n, config.perPlatformThresholds);
    // Suppress below-weak platforms entirely — they are not emitted.
    if (strength === "not_enough_evidence") continue;
    out.push({
      platform,
      total_n: acc.total_n,
      computed_n: acc.computed_n,
      strength,
      computed_stats: computedStatsFromLifts(acc.lifts),
    });
  }
  out.sort((a, b) => b.computed_n - a.computed_n);
  return out;
}

// ---------------------------------------------------------------------------
// Summary helper
// ---------------------------------------------------------------------------

export type BrainSummary = {
  generated_at: string;
  total_observations: number;
  total_patterns: number;
  patterns_by_strength: Record<PatternStrength, number>;
  distinct_buckets: number;
  distinct_url_types: number;
  distinct_cohorts: number;
};

export function summarizeBrain(
  observations: BrainObservation[],
  patterns: BrainPattern[],
): BrainSummary {
  const patternsByStrength: Record<PatternStrength, number> = {
    not_enough_evidence: 0,
    weak_signal: 0,
    emerging_signal: 0,
    strong_signal: 0,
  };
  for (const p of patterns) patternsByStrength[p.strength] += 1;

  const buckets = new Set<string>();
  const urlTypes = new Set<string>();
  const cohorts = new Set<string>();
  for (const o of observations) {
    buckets.add(o.primary_bucket);
    if (o.url_type) urlTypes.add(o.url_type);
    if (o.tenant_cohort) cohorts.add(o.tenant_cohort);
  }

  return {
    generated_at: new Date().toISOString(),
    total_observations: observations.length,
    total_patterns: patterns.length,
    patterns_by_strength: patternsByStrength,
    distinct_buckets: buckets.size,
    distinct_url_types: urlTypes.size,
    distinct_cohorts: cohorts.size,
  };
}
