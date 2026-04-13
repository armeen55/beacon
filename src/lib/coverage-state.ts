/**
 * Coverage-state system (Tier 1.1i).
 *
 * Discrete states — fresh / aging / stale / critical / partial — derived from
 * existing signals only. No persistence, no schema changes, no cross-signal blending.
 *
 * Stale day threshold `T` (default 3): crawl age **>** T days ⇒ stale (same as historical Beacon rule).
 * Aging window: age ∈ (0.7×T, T] — approaching that threshold (exclusive lower bound).
 * Critical: age **>** 2×T, or missing crawl when `treatMissingPrimaryCrawlAsNoData` is set.
 *
 * Precedence: partial > critical > stale > aging > fresh
 */

export type CoverageState = "fresh" | "aging" | "stale" | "critical" | "partial";

/** Days after last crawl after which coverage is "stale" (strictly greater than this value). */
export const COVERAGE_STALE_DAY_THRESHOLD = 3;

const AGING_LOWER_EXCLUSIVE = 0.7 * COVERAGE_STALE_DAY_THRESHOLD;
const CRITICAL_MULTIPLIER = 2;

export function deriveCoverageState(input: {
  crawlAgeDays?: number | null;
  visibilityStaleVsCrawl?: boolean;
  sampleQualityTier?: "limited" | "moderate" | "strong";
  isDemoMode?: boolean;
  /**
   * When true and `crawlAgeDays` is null/undefined, return `critical` (no crawl timestamp).
   * Callers (e.g. Today) set this only for real workspaces where a crawl is expected.
   */
  treatMissingPrimaryCrawlAsNoData?: boolean;
}): CoverageState {
  if (input.sampleQualityTier === "limited") return "partial";

  const age = input.crawlAgeDays;

  if (
    input.treatMissingPrimaryCrawlAsNoData === true &&
    (age === undefined || age === null)
  ) {
    return "critical";
  }

  if (
    age !== null &&
    age !== undefined &&
    age > COVERAGE_STALE_DAY_THRESHOLD * CRITICAL_MULTIPLIER
  ) {
    return "critical";
  }

  if (input.visibilityStaleVsCrawl === true) return "stale";

  if (age !== null && age !== undefined && age > COVERAGE_STALE_DAY_THRESHOLD) {
    return "stale";
  }

  if (
    age !== null &&
    age !== undefined &&
    age > AGING_LOWER_EXCLUSIVE &&
    age <= COVERAGE_STALE_DAY_THRESHOLD
  ) {
    return "aging";
  }

  return "fresh";
}

/** Human-readable label for UI (Today, Market, etc.). */
export function coverageStateDisplayLabel(state: CoverageState): string {
  switch (state) {
    case "fresh":
      return "Fresh";
    case "aging":
      return "Aging";
    case "stale":
      return "Stale";
    case "critical":
      return "Critical";
    case "partial":
      return "Partial";
  }
}

/** Short inline warning copy for each state. Returns null when no warning needed. */
export function coverageWarningLine(state: CoverageState): string | null {
  switch (state) {
    case "fresh":
      return null;
    case "aging":
      return "Data may be outdated — crawl is approaching the freshness threshold";
    case "stale":
      return "Data has not been updated recently";
    case "critical":
      return "No recent data available — run a crawl or refresh imports as needed";
    case "partial":
      return "Limited coverage — based on a small sample";
  }
}

/**
 * Today findings strip: when to surface coverage as "attention" (critical/stale always; aging only if nothing more urgent).
 */
export function coverageAttentionForFindings(
  state: CoverageState,
  hasCriticalFinding: boolean,
  actionableFindingsCount: number,
): CoverageState | null {
  if (state === "fresh" || state === "partial") return null;
  if (state === "critical" || state === "stale") return state;
  if (state === "aging") {
    if (hasCriticalFinding || actionableFindingsCount > 0) return null;
    return "aging";
  }
  return null;
}
