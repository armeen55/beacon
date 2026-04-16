/**
 * CX4 Design Lock — pattern key, confidence gates, context bins, move type.
 *
 * These contracts were locked BEFORE CX4 implementation to prevent:
 *
 *   1. Overfitting to founder data — confidence gates use DISTINCT TENANT
 *      COUNT, not raw sample count. A pattern with sample_count=5 but
 *      contributing_tenant_count=1 is still single-source.
 *
 *   2. Attribution inflation — per-change dedup ensures one changelog
 *      entry contributes exactly ONE outcome to a pattern, regardless
 *      of how many prompts observed the same change. High-frequency
 *      prompts cannot inflate pattern strength.
 *
 *   3. Generic patterns — context bins ground patterns in what we
 *      actually have data for (prior FAQ count, site maturity), not
 *      aspirational coverage metrics from a future phase.
 *
 *   4. Disconnected intelligence — the Move type is the single output
 *      abstraction that CX3's UI renders. Patterns, recommendations,
 *      and guided payloads compose into moves. The customer never sees
 *      the underlying domain objects.
 *
 * HARD RULES (enforced at query time, not display time):
 *   - contributing_tenant_count < 3  → DO NOT SURFACE, period
 *   - contributing_tenant_count < 10 → surface with seeded_warning
 *   - contributing_tenant_count ≥ 10 → full confidence
 *   - seeded_from_founder=true AND contributing_tenant_count < 3
 *     → same as above: DO NOT SURFACE
 *
 * These are immutable once CX4 ships. Additive fields only.
 */

// ---------------------------------------------------------------------------
// 1. Context bins — grounded in data we actually have
// ---------------------------------------------------------------------------

/**
 * How many FAQ questions the page had BEFORE the change was made.
 * Derived from the page snapshot closest to the change date.
 * This matters because adding FAQ to a zero-FAQ page is a different
 * signal than adding more FAQ to a page that already has 5.
 */
export type FaqCountBin = "zero" | "low" | "high";
//   zero = 0 FAQs before change
//   low  = 1-3 FAQs before change
//   high = 4+ FAQs before change

/**
 * How long the tenant's site has been tracked by Beacon.
 * New sites have less baseline data, so their deltas are noisier.
 */
export type SiteMaturityBin = "new" | "established";
//   new         = < 14 days of observation data
//   established = ≥ 14 days of observation data

/**
 * Combined context bin for pattern keys. Uses what we actually have
 * data for, not aspirational coverage metrics.
 */
export type ContextBin = {
  faq_count: FaqCountBin;
  site_maturity: SiteMaturityBin;
};

/**
 * Serialize a context bin to a stable string for use in pattern IDs.
 */
export function contextBinKey(bin: ContextBin): string {
  return `${bin.faq_count}::${bin.site_maturity}`;
}

// ---------------------------------------------------------------------------
// 2. Pattern key structure
// ---------------------------------------------------------------------------

/**
 * The composite key for a global pattern. Two events match the same
 * pattern if and only if their keys are identical.
 *
 * Pattern key = segment + change_type + platform + context_bin
 *
 * This is granular enough to distinguish "FAQ on zero-FAQ page for
 * ChatGPT" from "FAQ on high-FAQ page for Google AIO" — which are
 * genuinely different signals.
 */
export type PatternKey = {
  segment: "local_residential_builder";
  change_type: string;          // cluster label from visibility-events
  platform: "chatgpt" | "google_aio" | "perplexity";
  context_bin: string;          // serialized ContextBin (e.g. "zero::established")
};

/**
 * Compute a stable hash key for dedup and lookup.
 */
export function patternKeyHash(key: PatternKey): string {
  return `${key.segment}::${key.change_type}::${key.platform}::${key.context_bin}`;
}

// ---------------------------------------------------------------------------
// 3. Global pattern type
// ---------------------------------------------------------------------------

export type OutcomeClass =
  | "improvement_fast"   // positive delta within 7 days
  | "improvement_slow"   // positive delta within 8-21 days
  | "no_change"          // delta within noise floor after 21 days
  | "regression";        // negative delta sustained ≥7 days

export type GlobalPattern = {
  /** Stable ID = hash of pattern key. */
  id: string;
  /** The key components (for display and re-aggregation). */
  key: PatternKey;
  /** Outcome classification. */
  outcome_class: OutcomeClass;
  /**
   * RAW sample count (number of change→outcome events contributing).
   * One changelog entry = one sample, regardless of prompt count.
   */
  sample_count: number;
  /**
   * DISTINCT tenant count. This is the confidence-gate metric, not
   * sample_count. A pattern seen 10 times from 1 tenant is still
   * single-source.
   */
  contributing_tenant_count: number;
  /** Set of tenant IDs that contributed (for counting, never surfaced). */
  contributing_tenant_ids: string[];
  /** Fraction of samples with positive outcome. 0-1. */
  positive_rate: number;
  /** Median days to signal for positive outcomes. */
  median_days_to_signal: number;
  /** Average normalized impact (observation-count-adjusted delta). */
  avg_normalized_impact: number;
  /** When the first sample was recorded. */
  first_observed: string;
  /** When the most recent sample was recorded. */
  last_observed: string;
  /** True if founder data was used to seed this pattern. */
  seeded_from_founder: boolean;
  /** Cluster taxonomy version at aggregation time. */
  taxonomy_version: number;
};

// ---------------------------------------------------------------------------
// 4. Confidence gates — HARD, not soft
// ---------------------------------------------------------------------------

export type PatternConfidenceGate =
  | "suppressed"         // contributing_tenant_count < 3 — DO NOT SURFACE
  | "seeded_warning"     // contributing_tenant_count < 10 — show with warning
  | "confirmed";         // contributing_tenant_count ≥ 10 — full confidence

/**
 * Evaluate the hard confidence gate for a pattern.
 * This is called at QUERY TIME — suppressed patterns are never returned
 * to any consumer, even internal ones.
 */
export function evaluateConfidenceGate(
  pattern: GlobalPattern,
): PatternConfidenceGate {
  if (pattern.contributing_tenant_count < 3) return "suppressed";
  if (pattern.contributing_tenant_count < 10) return "seeded_warning";
  return "confirmed";
}

// ---------------------------------------------------------------------------
// 5. Attribution inflation normalization
// ---------------------------------------------------------------------------

/**
 * Normalize a change outcome's impact to prevent inflation from
 * observation count differences.
 *
 * The problem: if observation_after is 3× observation_before, the raw
 * delta percentage is inflated by coverage expansion, not real signal
 * movement.
 *
 * The fix: scale the delta by sqrt(before/after) when after > before * 1.5.
 * This dampens the inflation while preserving real directional signal.
 * Cap at [-95%, +500%] to prevent extreme outliers.
 */
export function normalizeImpact(opts: {
  raw_delta_pct: number;
  observations_before: number;
  observations_after: number;
}): number {
  const { raw_delta_pct, observations_before, observations_after } = opts;

  if (observations_before <= 0 || observations_after <= 0) {
    return 0; // Can't normalize without both windows
  }

  let normalized = raw_delta_pct;

  if (observations_after > observations_before * 1.5) {
    const factor = Math.sqrt(observations_before / observations_after);
    normalized = raw_delta_pct * factor;
  }

  // Cap to prevent outliers from dominating pattern aggregation
  return Math.max(-95, Math.min(500, normalized));
}

// ---------------------------------------------------------------------------
// 6. Per-change dedup rule
// ---------------------------------------------------------------------------

/**
 * Dedup key for aggregation. One changelog entry contributes exactly
 * ONE sample to a pattern, regardless of how many prompts observed the
 * change's effect.
 *
 * key = tenant_id + change_id + pattern_key_hash
 *
 * If this key already exists in the pattern's sample set, the new
 * observation is SKIPPED (not counted as an additional sample).
 */
export function aggregationDedupKey(
  tenantId: string,
  changeId: string,
  patternId: string,
): string {
  return `${tenantId}::${changeId}::${patternId}`;
}

// ---------------------------------------------------------------------------
// 7. Move type — the single output abstraction for CX3
// ---------------------------------------------------------------------------

/**
 * A Move is what the customer sees. It composes:
 *   - Pattern evidence ("47 builders who did this saw improvement")
 *   - Guided payload (paste-ready FAQ, JSON-LD, comparison table)
 *   - Recommendation metadata (target page, action class, priority)
 *
 * The customer never sees GlobalPattern, BeaconRecommendation, or
 * GuidedPayload directly. They see Moves.
 *
 * CX3 renders a list of 3 Moves on the /audit screen and a detail
 * view of one Move on /moves/[id]. CX5 generates the guided payload.
 *
 * This type is a view-model, not a persistence entity. It's computed
 * fresh on each page load from the underlying domain objects.
 */
export type PopulationEvidence = {
  /** How many distinct builders contributed to this pattern. */
  builder_count: number;
  /** Fraction with positive outcome. 0-1. */
  positive_rate: number;
  /** Median days to see signal. */
  median_days: number;
  /** Human-readable narrative. Directional, never causal. */
  narrative: string;
  /** Whether this is primarily seeded from founder data. */
  seeded_warning: boolean;
  /** The confidence gate classification. */
  gate: PatternConfidenceGate;
};

export type Move = {
  /** Unique ID (derived from the recommendation it wraps). */
  id: string;
  /** Big headline: "Add FAQ schema to 12 pages" */
  headline: string;
  /** One-sentence why: "This is the #1 pattern for ChatGPT visibility" */
  why: string;
  /** Target page URL or "sitewide". */
  target: string;
  /** Action class from the recommendation engine. */
  action_class: string;
  /** Platform this move primarily targets. */
  platform: "chatgpt" | "google_aio" | "perplexity";
  /** Priority (0-1000, higher = more urgent). */
  priority: number;
  /** Population evidence from global patterns. Null when no pattern matches. */
  population_evidence: PopulationEvidence | null;
  /**
   * Guided payload (paste-ready content). Null until CX5 generates it.
   * CX4 defines the slot; CX5 fills it.
   */
  guided_payload: unknown | null;
  /** Owning tenant. */
  tenant_id: string;
};

// ---------------------------------------------------------------------------
// 8. Taxonomy version
// ---------------------------------------------------------------------------

/**
 * Current cluster taxonomy version. Bump this when the cluster
 * classifier changes (e.g., new cluster added, existing cluster
 * renamed). All patterns with a different version are excluded
 * from queries until re-aggregated.
 */
export const CURRENT_TAXONOMY_VERSION = 1;
