/**
 * Derivable sample-quality tier for citation / observation counts (Tier 1.1f).
 * Thresholds match `docs/TIER_1_1D_PROVENANCE_METADATA_SPEC.md` / 1.1c §6.
 */

export const SAMPLE_QUALITY_LIMITED_BELOW = 200;
export const SAMPLE_QUALITY_MODERATE_AT_OR_BELOW = 1000;

export type SampleQualityTier = "limited" | "moderate" | "strong";

export function sampleQualityTierFromObservationCount(
  count: number,
): SampleQualityTier {
  if (count < SAMPLE_QUALITY_LIMITED_BELOW) return "limited";
  if (count <= SAMPLE_QUALITY_MODERATE_AT_OR_BELOW) return "moderate";
  return "strong";
}

/** Calm, proof-aligned label for Market KPI area */
export function sampleQualityTierLabel(tier: SampleQualityTier): string {
  switch (tier) {
    case "limited":
      return "Sample quality: limited";
    case "moderate":
      return "Sample quality: moderate";
    case "strong":
      return "Sample quality: strong";
    default: {
      const _exhaustive: never = tier;
      return _exhaustive;
    }
  }
}
