/**
 * Visibility Event Engine — decomposed event confidence (E1.9).
 *
 * Replaces the legacy single-value confidence (strong/moderate/weak/
 * insufficient) with three independent dimensions:
 *
 *   detection:     how confident are we that the metric actually moved
 *                  in a meaningful way? Reads off the spike shape itself
 *                  (baseline quality, magnitude, sustained peak, emerging
 *                  signal status).
 *
 *   attribution:   how confident are we that we know WHICH cluster of
 *                  changes was the dominant driver? Reads off the
 *                  impact-weighted cluster attributions — how dominant
 *                  the primary cluster is vs. the runner-up.
 *
 *   pattern_match: how confident are we that this event matches a
 *                  previously-seen successful pattern? Stays "none" until
 *                  pattern memory ships in a future phase.
 *
 * Key rule: downstream consumers MUST read all three values and display
 * them separately. Never collapse into a single scalar. A strong-
 * detection / weak-attribution event is honest about what we know and
 * don't know — collapsing it to "moderate" would hide the gap.
 */

import type {
  AttributionVerdict,
  ConfidenceTier,
  EventConfidence,
  ImpactWeightedClusterAttribution,
  Spike,
} from "./types";

// ---------------------------------------------------------------------------
// Detection tier
// ---------------------------------------------------------------------------
// Strong  = solid baseline (≥4 day window) + large relative jump (≥2.5x)
//           + sustained peak (dayCount ≥ 2). This is the plan's strict bar.
// Moderate = relative ratio ≥ 1.75 and NOT emerging (standard spike).
// Weak    = emerging signal (baseline ≈ 0), or single-day spike.

const STRONG_RATIO = 2.5;
const MODERATE_RATIO = 1.75;

export function detectionConfidence(spike: Spike): ConfidenceTier {
  // Emerging signal (baseline ≈ 0) is always weak — we can't tell whether
  // the trend will hold.
  if (spike.isEmerging) return "weak";
  // Single-day spike is weak even at high ratios — sustain matters.
  if (spike.dayCount < 2) return "weak";

  if (spike.relativeRatio >= STRONG_RATIO) return "strong";
  if (spike.relativeRatio >= MODERATE_RATIO) return "moderate";
  return "weak";
}

// ---------------------------------------------------------------------------
// Attribution tier
// ---------------------------------------------------------------------------
// Strong  = one cluster's impactScore is ≥2x the runner-up AND that
//           cluster has likely_primary_trigger role. This is the plan's
//           strict bar. Coverage_delta (E2) will add a ≥50% cap when
//           annotations land, but for E1 we only check the impact ratio.
// Moderate = one cluster with likely_primary_trigger but impactScore
//           within 1.5x-2x of runner-up.
// Weak    = tied clusters (within 1.5x), no primary, or insufficient
//           data.

const STRONG_IMPACT_GAP = 2.0;
const MODERATE_IMPACT_GAP = 1.5;

export function attributionConfidence(opts: {
  attributions: ImpactWeightedClusterAttribution[];
  verdict: AttributionVerdict;
}): ConfidenceTier {
  const { attributions, verdict } = opts;

  // No data at all → weak.
  if (verdict === "insufficient" || attributions.length === 0) {
    return "weak";
  }

  // Find the primary cluster (highest-role, highest-impact).
  const primary = attributions.find(
    (a) => a.role === "likely_primary_trigger",
  );

  // Multi-trigger verdicts are by definition ambiguous.
  if (verdict === "multi_trigger") {
    return "weak";
  }

  // Snowball with ≥2 clusters spreading responsibility is also ambiguous.
  if (verdict === "snowball") {
    return "weak";
  }

  // Isolated verdict without a primary somehow → weak (shouldn't happen
  // in practice since the deriveVerdict function guards this, but the
  // type system allows it).
  if (!primary) {
    return "weak";
  }

  // Compare primary impactScore to the next-highest non-primary cluster.
  // If the primary utterly dominates, detection is strong.
  const rivals = attributions
    .filter((a) => a.cluster !== primary.cluster)
    .map((a) => a.impactScore)
    .filter((s) => s > 0);

  if (rivals.length === 0) {
    // Nothing else in the window — primary is the only cluster that
    // scored above the noise floor. That's actually the strongest case.
    return "strong";
  }

  const runnerUp = Math.max(...rivals);
  if (runnerUp === 0) return "strong";
  const ratio = primary.impactScore / runnerUp;

  if (ratio >= STRONG_IMPACT_GAP) return "strong";
  if (ratio >= MODERATE_IMPACT_GAP) return "moderate";
  return "weak";
}

// ---------------------------------------------------------------------------
// Composite — build the full EventConfidence record
// ---------------------------------------------------------------------------
// pattern_match defaults to "none" because pattern memory is a future
// phase. This function does not accept a matched-pattern param yet.

export function buildEventConfidence(opts: {
  spike: Spike;
  attributions: ImpactWeightedClusterAttribution[];
  verdict: AttributionVerdict;
}): EventConfidence {
  return {
    detection: detectionConfidence(opts.spike),
    attribution: attributionConfidence({
      attributions: opts.attributions,
      verdict: opts.verdict,
    }),
    pattern_match: "none",
  };
}
