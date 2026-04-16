/**
 * Visibility Event Engine — impact-weighted cluster scoring (E1.6).
 *
 * Replaces the count-based cluster scoring from legacy attributeSpike()
 * with a composite score that captures the intuition that not all
 * changes contribute equally to a visibility event:
 *
 *   impactScore(cluster) = Σ over changes in cluster:
 *                          clusterWeight(change) × proximityWeight(days)
 *                          × coverageWeight
 *
 * Factor sources:
 *   - clusterWeight: seeded from learned change-patterns.ts success_rate
 *     when a pattern exists for the change's signal_type × asset_type.
 *     Falls back to a cluster-based default table when no pattern match.
 *   - proximityWeight: piecewise linear decay from 1.0 at day 0 to 0.4 at
 *     day 7 to 0.2 at day 14. Matches the plan's `day 0 = 1.0, day 7 = 0.4,
 *     day 14 = 0.2` spec.
 *   - coverageWeight: defaults to 1.0 in E1. The coverage overlay store
 *     from E2 will replace the default with a real coverage_delta_pct.
 *
 * This module is pure — no side effects, no file IO, no persistence.
 */

import type { ChangePattern } from "@/domains/learning/change-patterns";
import type {
  ChangeClusterLabel,
  ImpactBreakdown,
  WindowedChange,
} from "./types";

// ---------------------------------------------------------------------------
// Default cluster weight table
// ---------------------------------------------------------------------------
// Used when no learned pattern applies to a change. Calibrated from
// operator intuition documented in the plan: FAQ schema + technical
// rendering + page launches drive most platform movement; metadata and
// reviews are secondary; "other" is a catch-all with low default weight.
//
// Keep these ≤ 1.2. Higher values would let a single change outrank
// learned patterns that have documented success rates of ≤ 0.9.

export const DEFAULT_CLUSTER_WEIGHTS: Record<ChangeClusterLabel, number> = {
  faq_schema: 1.1,
  content_structure: 1.0,
  technical_rendering: 1.2,
  internal_links: 0.7,
  page_launch: 1.1,
  metadata: 0.6,
  citations_listings: 0.7,
  reviews: 0.6,
  other: 0.5,
};

// ---------------------------------------------------------------------------
// Proximity weight — linear decay
// ---------------------------------------------------------------------------
// Piecewise linear interpolation:
//   day 0  → 1.00
//   day 7  → 0.40
//   day 14 → 0.20
//
// This enforces the operator-intuition rule "recent changes matter most,
// but 14-day-old changes are not zero — they still contribute 20% of a
// same-day change's weight."

export function proximityWeight(daysBeforeSpike: number): number {
  if (daysBeforeSpike <= 0) return 1.0;
  if (daysBeforeSpike <= 7) {
    return 1.0 - (daysBeforeSpike / 7) * 0.6;
  }
  if (daysBeforeSpike <= 14) {
    return 0.4 - ((daysBeforeSpike - 7) / 7) * 0.2;
  }
  return 0.2;
}

// ---------------------------------------------------------------------------
// Cluster weight — learned or default
// ---------------------------------------------------------------------------

/**
 * Cluster weight for a single change.
 *
 * Lookup order:
 *   1. Learned pattern success_rate (when pattern confidence ≥ medium and
 *      sample_count ≥ 3). Clamped to [0.3, 1.3] so a 100% historical
 *      success rate doesn't completely dominate a single sample's cluster
 *      default weight.
 *   2. Default cluster weight from DEFAULT_CLUSTER_WEIGHTS table.
 */
export function clusterWeightForChange(opts: {
  cluster: ChangeClusterLabel;
  signalType: string;
  assetType: string;
  patternsById: Map<string, ChangePattern> | null;
}): number {
  const { cluster, signalType, assetType, patternsById } = opts;

  if (patternsById) {
    const pattern = patternsById.get(`${signalType}::${assetType}`);
    if (
      pattern &&
      pattern.confidence !== "low" &&
      pattern.sample_count >= 3
    ) {
      // Map success_rate (0-1) into the weight space [0.3, 1.3].
      const learned = 0.3 + pattern.success_rate * 1.0;
      return Math.max(0.3, Math.min(1.3, learned));
    }
  }

  return DEFAULT_CLUSTER_WEIGHTS[cluster];
}

// ---------------------------------------------------------------------------
// Cluster impact score
// ---------------------------------------------------------------------------

export type ClusterImpact = {
  score: number;
  breakdown: ImpactBreakdown;
};

/**
 * Compute the impact score for a single cluster across its windowed changes.
 *
 * Returns both the aggregate score and a breakdown showing how each factor
 * contributed (using averages where per-change values vary). The breakdown
 * is surfaced in the operator UI so anyone can audit why one cluster
 * outranked another.
 */
export function computeClusterImpact(opts: {
  cluster: ChangeClusterLabel;
  changes: WindowedChange[];
  patternsById?: Map<string, ChangePattern> | null;
  coverageWeight?: number;
}): ClusterImpact {
  const { cluster, changes, patternsById, coverageWeight = 1.0 } = opts;

  if (changes.length === 0) {
    return {
      score: 0,
      breakdown: {
        changeCount: 0,
        clusterWeight: 0,
        proximityWeight: 0,
        coverageWeight,
      },
    };
  }

  let totalScore = 0;
  let totalClusterWeight = 0;
  let totalProximity = 0;

  for (const c of changes) {
    const cw = clusterWeightForChange({
      cluster,
      signalType: c.signalType,
      assetType: c.assetType,
      patternsById: patternsById ?? null,
    });
    const pw = proximityWeight(c.daysBeforeSpike);
    totalScore += cw * pw * coverageWeight;
    totalClusterWeight += cw;
    totalProximity += pw;
  }

  return {
    score: Math.round(totalScore * 100) / 100,
    breakdown: {
      changeCount: changes.length,
      // Averages for display — per-change values roll up here.
      clusterWeight:
        Math.round((totalClusterWeight / changes.length) * 100) / 100,
      proximityWeight:
        Math.round((totalProximity / changes.length) * 100) / 100,
      coverageWeight,
    },
  };
}

/**
 * Helper: build a Map<id, ChangePattern> for O(1) per-change lookups.
 */
export function buildPatternsById(
  patterns: ChangePattern[] | undefined,
): Map<string, ChangePattern> | null {
  if (!patterns || patterns.length === 0) return null;
  const m = new Map<string, ChangePattern>();
  for (const p of patterns) m.set(p.id, p);
  return m;
}
