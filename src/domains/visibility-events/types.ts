/**
 * Visibility Event Engine — types.
 *
 * This module consolidates spike-forensics types and adds the new shapes
 * that E1.6 (impact-weighted attribution), E1.7 (crawl lag), and E1.9
 * (confidence decomposition) require.
 *
 * Types that already live in `../forensics/types` are re-exported here so
 * the new engine code can import everything from a single place. During
 * E1.8 the forensics types file will be reduced to a compatibility
 * re-export of this file.
 *
 * Design invariants:
 *   - Directional language only. No causal claims.
 *   - Confidence is decomposed. Detection, attribution, and pattern_match
 *     are tracked separately so downstream consumers never conflate them.
 */

import type {
  Spike,
  WindowedChange,
  ClusterBurst,
  ChangeClusterLabel,
  AttributionRole,
  AttributionVerdict,
  PlatformInterpretation,
} from "../forensics/types";

// ---------------------------------------------------------------------------
// Re-exports from legacy forensics (stable types — reused in place)
// ---------------------------------------------------------------------------

export type {
  Spike,
  SpikeMetric,
  SpikePlatform,
  WindowedChange,
  ChangeClusterLabel,
  ChangeClusterLabelDisplay,
  ClusterBurst,
  ClusterAttribution,
  AttributionVerdict,
  AttributionRole,
  PlatformInterpretation,
  SpikeForensics,
} from "../forensics/types";

export { CLUSTER_LABELS } from "../forensics/types";

// ---------------------------------------------------------------------------
// E1.9 — decomposed event confidence
// ---------------------------------------------------------------------------
// Every detected event carries three separate confidence values so downstream
// consumers never conflate detection quality with attribution quality with
// pattern-match quality. A single `confidence` scalar was the old shape —
// this replaces it.
//
// Rules (set in E1.9 once primitives are in place):
//   - detection:    quality of spike detection (baseline stability,
//                   magnitude, sustained). Strong requires ≥4 days of
//                   baseline data + relative ratio ≥2.5x + sustained.
//                   Weak = emerging signal OR sparse baseline.
//   - attribution:  quality of cluster-role assignment (impact-weighted
//                   triage). Strong = one cluster dominates with
//                   impact-score ≥2x the runner-up. Weak = multiple
//                   clusters tied within 1.5x.
//   - pattern_match: quality of match against remembered sequences.
//                   Stays "none" until E4 ships pattern memory.

export type ConfidenceTier = "strong" | "moderate" | "weak";

export type EventConfidence = {
  /** Quality of the spike detection itself. */
  detection: ConfidenceTier;
  /** Quality of the cluster role assignment. */
  attribution: ConfidenceTier;
  /** Quality of pattern memory match. `"none"` until E4. */
  pattern_match: ConfidenceTier | "none";
};

// ---------------------------------------------------------------------------
// E1.6 — impact-weighted cluster attribution
// ---------------------------------------------------------------------------
// Replaces count-based cluster scoring from legacy attributeSpike().
// The impact score composes four factors:
//
//   impactScore = changeCount * clusterWeight * proximityWeight * coverageWeight
//
// Count-based scoring incorrectly treats 10 metadata fixes as more
// impactful than 1 sitewide FAQ schema deploy. Impact weighting fixes
// this by letting cluster importance, temporal proximity, and coverage
// override raw counts.
//
// Factor sources (final wiring lands in E1.6):
//   - clusterWeight:   seeded from change-patterns.ts success rates per
//                      sub-cluster when available; default table
//                      otherwise.
//   - proximityWeight: linear decay from 1.0 at day 0 down to 0.2 at
//                      day 14. Most recent changes dominate.
//   - coverageWeight:  1.0 for E1 (no annotations yet). E2 replaces
//                      this with coverage_delta_pct from the annotation
//                      overlay.

export type ImpactBreakdown = {
  changeCount: number;
  clusterWeight: number;
  proximityWeight: number;
  coverageWeight: number;
};

export type ImpactWeightedClusterAttribution = {
  cluster: ChangeClusterLabel;
  role: AttributionRole;
  changeCount: number;
  /** Primary window this cluster concentrated in (1, 3, 7, or 14 days). */
  primaryWindowDays: number;
  /** Composite impact score: changeCount × clusterWeight × proximityWeight × coverageWeight. */
  impactScore: number;
  /** Per-factor breakdown so operators can see why a cluster outranked another. */
  impactBreakdown: ImpactBreakdown;
  /** Directional rationale — never causal. */
  rationale: string;
};

// ---------------------------------------------------------------------------
// E1.3 / E1.4 — change quality evidence
// ---------------------------------------------------------------------------
// Unified record describing whether a given change has passed the data-
// quality gate upstream. Two sources feed this:
//
//   "outcome"  — pre-materialized ChangeOutcome row from change-outcomes.json.
//                Preferred when available (E1.4) — no recomputation cost.
//   "insight"  — freshly computed MemoryInsight from memory.ts
//                `computeAllChangeInsights` (E1.3 fallback).
//
// Downstream consumers use this as a directional hint only — presence =
// "we have enough metric data around this change to say something about
// its outcome." The direction / delta fields are surfaced for future
// phases (e.g. impact weighting) but never treated as causal proof.

export type ChangeQualityEvidence = {
  changeId: string;
  source: "outcome" | "insight";
  direction: "improving" | "declining" | "stable";
  citationDeltaPct: number;
  mentionDeltaPct: number;
};

// ---------------------------------------------------------------------------
// E1.7 — crawl alignment
// ---------------------------------------------------------------------------
// Beacon cannot see when ChatGPT/Google/Perplexity fetched a page. The
// only crawl timestamps it has are its own observation runs. We surface
// them as contextual metadata — NOT as attribution input — so operators
// understand whether a change *could* have been re-observed by the
// platform between deploy and event.

export type CrawlAlignment = {
  /** ID of the website crawl run closest to (but before) event start. */
  runId: string | null;
  /** Date of that crawl run, or null if none within the window. */
  crawlCompletedAt: string | null;
  /** Days between crawl completion and event start. Null when unknown. */
  daysBeforeEvent: number | null;
};

// ---------------------------------------------------------------------------
// Composite visibility event — engine output shape
// ---------------------------------------------------------------------------
// The output of the new engine. During E1 this is a superset of the
// legacy SpikeForensics shape. E3 will fold in event type (spike /
// unlock / ramp) + mechanism. E4 will add matchedSequences.

export type VisibilityEvent = {
  spike: Spike;
  /**
   * Windowed changes per 1/3/7/14 day horizons. The widest window is the
   * 14-day cap unless E1.5 replaces it with a learned platform window.
   */
  windows: {
    oneDay: WindowedChange[];
    threeDays: WindowedChange[];
    sevenDays: WindowedChange[];
    fourteenDays: WindowedChange[];
  };
  /** Cluster bursts per window — count, first/last change, sample descriptions. */
  clusterBursts: {
    windowDays: number;
    clusters: ClusterBurst[];
  }[];
  /** Impact-weighted cluster attributions. Replaces legacy count-based output. */
  attributions: ImpactWeightedClusterAttribution[];
  /** Overall verdict (isolated / multi_trigger / snowball / insufficient). */
  verdict: AttributionVerdict;
  /** Platform-specific interpretation style. */
  interpretation: PlatformInterpretation;
  /** Decomposed confidence — never collapse into a single value. */
  confidence: EventConfidence;
  /** Crawl alignment context. Null when no crawl runs available. */
  crawlAlignment: CrawlAlignment;
  /** Directional human-readable explanation. */
  explanation: string;
};
