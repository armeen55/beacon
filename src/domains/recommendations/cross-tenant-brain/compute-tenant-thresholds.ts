/**
 * 2026-05-14 Phase A.2 Step 2 — per-tenant benchmark computation.
 *
 * Pure function that decides whether a tenant has enough cited
 * shipped-edit data to replace the borrowed Profound 6/18/37
 * starter thresholds with Beacon-owned thresholds observed in the
 * tenant's own data.
 *
 * Inclusion rule (cited-edit subpopulation only):
 *   • INCLUDE records whose `lifecycle_stage` is one of
 *     {cited_fast, cited_typical, cited_late, cited_very_late} AND
 *     whose `days_to_first_citation` is non-null and ≥ 0.
 *   • EXCLUDE `live_not_yet_cited` and `stuck` records — these are
 *     right-censored. The page hasn't been cited yet; we do not
 *     know its final citation timing. Forcing them into the
 *     citation-timing percentile compute would silently truncate
 *     the fast end of the distribution (a stuck row has no day
 *     value to insert) or require choosing an arbitrary upper
 *     bound. Both options bias the thresholds away from the
 *     observed reality of cited edits. They stay in operator
 *     diagnostics (returned as `excluded_count` for honest
 *     reporting); they do NOT count toward `sample_size`.
 *   • EXCLUDE defensive cases: `days_to_first_citation === null`
 *     (should not happen on a cited stage; defensive) and
 *     `days_to_first_citation < 0` (upstream compute-time-to-
 *     citation.ts already clamps these to 0 with
 *     `was_cited_before_live: true`; defensive against a future
 *     caller that bypasses the clamp).
 *
 * IMPORTANT — Step A.2.3 customer copy contract:
 *
 * The thresholds returned here describe ONLY the cited-edit
 * subpopulation. If a tenant has 20 cited + 50 stuck edits, the
 * thresholds will read "Beacon's typical citation window is X
 * days," but the customer should not infer "100% of my pages get
 * cited that fast." The follow-up Step A.2.3 must surface the
 * `excluded_count` (or the cited rate) in customer copy when the
 * tile lights up so the per-tenant claim stays honest. This module
 * intentionally returns both `sample_size` and `excluded_count`
 * so the caller has the data to compose that copy without re-
 * computing.
 *
 * Decision rule (locked):
 *   • `sample_size < BRAIN_SAMPLE_THRESHOLDS.threshold_replacement`
 *     (default 20) → `source: "profound_default"`, thresholds =
 *     injected `profoundDefaults` (default `T2C_THRESHOLDS`).
 *   • `sample_size >= threshold_replacement` → `source:
 *     "per_tenant"`, thresholds computed from the included
 *     records.
 *
 * Threshold math (locked):
 *   • Nearest-rank quantile on sorted ascending
 *     `days_to_first_citation`. Index = `ceil(p * n) - 1`, clamped
 *     to `[0, n - 1]`. Deterministic; no interpolation.
 *   • Percentiles match the Profound paper's reported bands:
 *       fast_days   = ceil(quantile(days, 0.50))
 *       median_days = ceil(quantile(days, 0.75))
 *       late_days   = ceil(quantile(days, 0.90))
 *   • Floor every threshold at 1 day so customer copy never says
 *     "within 0 days."
 *   • Enforce monotonicity:
 *       fast_days ≤ median_days ≤ late_days.
 *     If a tie collapses two or more bands (all cited same day),
 *     bands are equal and lifecycle-stage derivation handles the
 *     `≤` semantics via the existing `lifecycle-stage.ts` code.
 *
 * Hard contracts:
 *   • Pure function. No env reads. No I/O. No Supabase. No paid
 *     APIs. No persistence imports.
 *   • Deterministic given the input array (internally sorted
 *     before percentile compute; input is never mutated).
 *   • Never returns a mixed source — payload is either fully
 *     Profound or fully per-tenant. A.2.3 reads the `source` field
 *     to decide which copy variant to render.
 *   • No hysteresis in v1 (per E8 lock). Output can flip per call
 *     if the underlying records cross the gate; A.2.3 is expected
 *     to surface this state honestly, not smooth it.
 *   • No per-action-type compute in v1. Single tenant-wide
 *     threshold; per-action-type is a future refinement.
 *
 * Pinned by `tests/architecture/brain-compute-tenant-thresholds-provenance.test.ts`.
 */

import { T2C_THRESHOLDS } from "@/domains/citation-lifecycle/thresholds";
import { BRAIN_SAMPLE_THRESHOLDS } from "./thresholds";

/**
 * Structural alias used by this module. The canonical `T2cThresholds`
 * type in `citation-lifecycle/thresholds.ts` is `typeof T2C_THRESHOLDS`
 * — i.e., the literal `{ fast_days: 6; median_days: 18; late_days: 37 }`.
 * That literal type is the right shape for Phase A.1's borrowed
 * defaults but cannot hold computed per-tenant values. The widened
 * structural shape below is the parameter / return type for this
 * module.
 *
 * Stays local to this file (no citation-lifecycle edit). When Phase
 * A.2 Step 3 wires this into citation-lifecycle/thresholds, either
 * (a) the canonical type widens at the source, or (b) the consumer
 * continues to thread `ThresholdValues` end-to-end. The decision is
 * for Step 3; this step keeps the change contained.
 */
type ThresholdValues = {
  fast_days: number;
  median_days: number;
  late_days: number;
};

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

export type TenantLifecycleRecord = {
  edit_id: string;
  action_type: string | null;
  /** ISO timestamp the edit went live. Must be set per the
   *  upstream eligibility predicate. */
  live_at: string;
  /** Days from `live_at` to first citation. Null when uncited. */
  days_to_first_citation: number | null;
  /** ISO date the first citation was observed. Null when uncited. */
  first_citation_date_iso: string | null;
  /** Derived stage from the Phase A.1 lifecycle-stage module. */
  lifecycle_stage:
    | "live_not_yet_cited"
    | "cited_fast"
    | "cited_typical"
    | "cited_late"
    | "cited_very_late"
    | "stuck";
  /** True for `partially_implemented` rows; locked Phase A.1 D1. */
  is_partial_live: boolean;
};

/** Locked percentile mapping per Section 2.8. */
export type PercentilesUsed = {
  fast: 0.5;
  median: 0.75;
  late: 0.9;
};

const PERCENTILES_USED: PercentilesUsed = {
  fast: 0.5,
  median: 0.75,
  late: 0.9,
};

export type ThresholdDecision = {
  /** Which path produced the thresholds. A.2.3 branches on this. */
  source: "profound_default" | "per_tenant";
  /** Final thresholds, normalized + monotonic. */
  thresholds: ThresholdValues;
  /** Count of records that contributed to the percentile compute
   *  (cited subpopulation only). The decision rule compares THIS
   *  against `BRAIN_SAMPLE_THRESHOLDS.threshold_replacement`. */
  sample_size: number;
  /** Count of records dropped by the inclusion rule (uncited,
   *  stuck, null/negative days). Returned for honest operator
   *  diagnostics; NOT counted toward sample_size. */
  excluded_count: number;
  /** Explainability — the percentile values used for the three
   *  bands. Always the locked {0.5, 0.75, 0.9}. */
  percentile_used: PercentilesUsed;
};

export type ComputeTenantThresholdsDeps = {
  /** Injected fallback thresholds for sub-gate cases. Defaults to
   *  `T2C_THRESHOLDS` (Profound 6/18/37). Tests use this to feed
   *  synthetic defaults without re-importing. */
  profoundDefaults?: ThresholdValues;
  /** Override the locked v1 sample-size gate
   *  (`BRAIN_SAMPLE_THRESHOLDS.threshold_replacement`). Test-only
   *  hook; production callers omit. */
  sampleSizeFloor?: number;
};

// ─────────────────────────────────────────────────────────────────────
// Inclusion rule
// ─────────────────────────────────────────────────────────────────────

const CITED_STAGES: ReadonlySet<TenantLifecycleRecord["lifecycle_stage"]> =
  new Set(["cited_fast", "cited_typical", "cited_late", "cited_very_late"]);

function isCitedAndUsable(record: TenantLifecycleRecord): boolean {
  // EXCLUDE live_not_yet_cited / stuck — see header rationale on
  // right-censoring.
  if (!CITED_STAGES.has(record.lifecycle_stage)) return false;
  const d = record.days_to_first_citation;
  if (d === null) return false;
  if (d < 0) return false;
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Threshold math
// ─────────────────────────────────────────────────────────────────────

/**
 * Nearest-rank quantile. `sortedAsc` MUST be ascending and
 * non-empty (caller guarantees). Returns the actual observed
 * value at the computed index — no interpolation.
 */
function nearestRankQuantile(sortedAsc: number[], p: number): number {
  const n = sortedAsc.length;
  // ceil(p * n) - 1, clamped to [0, n-1].
  const raw = Math.ceil(p * n) - 1;
  const idx = Math.max(0, Math.min(raw, n - 1));
  return sortedAsc[idx]!;
}

function normalizeThresholds(input: ThresholdValues): ThresholdValues {
  // Floor at 1, then enforce monotonicity. Order matters: enforce
  // monotonicity AFTER flooring so the floor cannot break the
  // ordering established by the percentile compute.
  let fast = Math.max(1, Math.ceil(input.fast_days));
  let median = Math.max(1, Math.ceil(input.median_days));
  let late = Math.max(1, Math.ceil(input.late_days));
  if (median < fast) median = fast;
  if (late < median) late = median;
  return { fast_days: fast, median_days: median, late_days: late };
}

// ─────────────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────────────

/**
 * Pure per-tenant threshold computation. See header for inclusion
 * rule, decision rule, and threshold math.
 *
 * `records` is not mutated. The function internally copies the
 * filtered day values before sorting, so caller order is
 * irrelevant to the output.
 */
export function computeTenantThresholds(
  records: ReadonlyArray<TenantLifecycleRecord>,
  deps: ComputeTenantThresholdsDeps = {},
): ThresholdDecision {
  const profoundDefaults = deps.profoundDefaults ?? T2C_THRESHOLDS;
  const sampleSizeFloor =
    deps.sampleSizeFloor ??
    BRAIN_SAMPLE_THRESHOLDS.threshold_replacement;

  // Partition records into included + excluded. We do NOT mutate
  // the input array.
  const includedDays: number[] = [];
  let excludedCount = 0;
  for (const r of records) {
    if (isCitedAndUsable(r)) {
      // Defensive cast — isCitedAndUsable() already proved non-null.
      includedDays.push(r.days_to_first_citation as number);
    } else {
      excludedCount++;
    }
  }
  const sampleSize = includedDays.length;

  // Sub-gate → fall back to injected Profound defaults verbatim.
  if (sampleSize < sampleSizeFloor) {
    return {
      source: "profound_default",
      thresholds: profoundDefaults,
      sample_size: sampleSize,
      excluded_count: excludedCount,
      percentile_used: PERCENTILES_USED,
    };
  }

  // Above gate → compute per-tenant thresholds.
  const sorted = includedDays.slice().sort((a, b) => a - b);
  const raw: ThresholdValues = {
    fast_days: nearestRankQuantile(sorted, PERCENTILES_USED.fast),
    median_days: nearestRankQuantile(sorted, PERCENTILES_USED.median),
    late_days: nearestRankQuantile(sorted, PERCENTILES_USED.late),
  };

  return {
    source: "per_tenant",
    thresholds: normalizeThresholds(raw),
    sample_size: sampleSize,
    excluded_count: excludedCount,
    percentile_used: PERCENTILES_USED,
  };
}
