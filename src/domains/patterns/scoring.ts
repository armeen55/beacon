import type { Pattern } from "./types";

/**
 * Rank patterns for replicate-action targeting.
 * Returns the pattern score adjusted for context similarity.
 */
export function patternReplicateScore(
  pattern: Pattern,
  targetGeo: string | null,
  targetPlatform: string | null
): number {
  let base = pattern.score;

  if (targetGeo && pattern.dominantGeo.includes(targetGeo)) {
    base += 5;
  }
  if (targetPlatform && pattern.dominantPlatforms.includes(targetPlatform)) {
    base += 5;
  }

  if (pattern.confidenceBand === "high") base += 10;
  if (pattern.trend === "improving") base += 5;
  if (pattern.trend === "declining") base -= 10;

  return Math.min(100, Math.max(0, base));
}

/**
 * Find untapped contexts where a proven pattern hasn't been applied.
 */
export function findUntappedTargets(
  pattern: Pattern,
  allGeos: string[],
  allPlatforms: string[]
): { geos: string[]; platforms: string[] } {
  const geos = allGeos.filter(
    (g) => g && !pattern.dominantGeo.includes(g)
  );
  const platforms = allPlatforms.filter(
    (p) => !pattern.dominantPlatforms.includes(p)
  );
  return { geos, platforms };
}
