import type { Pattern } from "@/domains/patterns/types";
import type { ActionCluster } from "@/domains/action-clusters/types";
import type {
  OpportunityCandidateType,
  CandidateConfidence,
} from "./types";

/**
 * Score a candidate opportunity.
 * pattern score (40%) + context similarity (20%) + cluster strength (20%) +
 * coverage gap (10%) + recency (10%)
 */
export function scoreCandidate(
  pattern: Pattern,
  type: OpportunityCandidateType,
  hasExistingContext: boolean,
  relatedClusters: ActionCluster[]
): { score: number; confidence: CandidateConfidence } {
  const patternScore = pattern.score * 0.4;

  let contextSimilarity = 50;
  if (type === "adjacent") contextSimilarity = 70;
  if (type === "gap") contextSimilarity = 80;
  if (type === "expansion") contextSimilarity = 45;
  if (type === "missing") contextSimilarity = 60;
  const contextScore = contextSimilarity * 0.2;

  const clusterStrength =
    relatedClusters.length > 0
      ? Math.min(
          100,
          relatedClusters.reduce((sum, c) => sum + c.score, 0) /
            relatedClusters.length
        )
      : 20;
  const clusterScore = clusterStrength * 0.2;

  const gapBonus = hasExistingContext ? 0 : 10;

  const recencyDays = Math.max(
    0,
    (Date.now() - new Date(pattern.lastSeenAt).getTime()) / 86_400_000
  );
  const recency = Math.max(0, 100 - recencyDays * 2) * 0.1;

  const total = Math.round(
    patternScore + contextScore + clusterScore + gapBonus + recency
  );
  const score = Math.min(100, Math.max(0, total));

  let confidence: CandidateConfidence;
  if (
    pattern.confidenceBand === "high" &&
    pattern.successRate >= 50 &&
    score >= 50
  ) {
    confidence = "high";
  } else if (pattern.attributedEventCount >= 1 && score >= 30) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  if (pattern.trend === "declining") {
    confidence = confidence === "high" ? "medium" : "low";
  }

  return { score, confidence };
}
