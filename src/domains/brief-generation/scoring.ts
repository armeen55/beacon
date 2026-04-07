import type {
  ProposedBriefPriority,
  ProposedBriefConfidence,
} from "./types";

export type ScoringInput = {
  actionPriority: number;
  patternScore: number | null;
  patternSuccessRate: number | null;
  clusterConfidence: string | null;
  expectedImpact: number;
  caveatCount: number;
  caveatSeverity: number;
  executionClarity: number;
  evidenceSharpness: number;
  dependencyBurden: number;
};

/**
 * Score a proposed brief on 0–100 scale.
 *
 * Factors:
 *   action priority    25%
 *   pattern score      20%
 *   cluster confidence 15%
 *   expected impact    15%
 *   evidence sharpness 10%
 *   execution clarity  10%
 *   caveat penalty     -5%
 *   dependency penalty  -5% (max)
 */
export function scoreBrief(input: ScoringInput): number {
  const actionPart = (input.actionPriority / 100) * 25;
  const patternPart = ((input.patternScore ?? 30) / 100) * 20;
  const clusterPart = clusterConfidenceValue(input.clusterConfidence) * 15;
  const impactPart = (input.expectedImpact / 100) * 15;
  const evidencePart = (input.evidenceSharpness / 100) * 10;
  const clarityPart = (input.executionClarity / 100) * 10;

  const caveatPenalty = Math.min(5, input.caveatSeverity * 0.5);
  const depPenalty = Math.min(5, input.dependencyBurden * 0.5);

  const raw =
    actionPart +
    patternPart +
    clusterPart +
    impactPart +
    evidencePart +
    clarityPart -
    caveatPenalty -
    depPenalty;

  return Math.max(0, Math.min(100, Math.round(raw)));
}

export function derivePriority(
  score: number,
  bucket: string,
  caveatSeverity: number
): ProposedBriefPriority {
  if (bucket === "system_fix" && caveatSeverity <= 2) return "critical";
  if (score >= 65 && caveatSeverity <= 3) return "high";
  if (score >= 40) return "medium";
  return "low";
}

export function deriveConfidence(
  patternConfidence: string | null,
  clusterConfidence: string | null,
  caveatCount: number
): ProposedBriefConfidence {
  if (
    patternConfidence === "high" &&
    clusterConfidence === "high" &&
    caveatCount <= 2
  )
    return "high";

  if (
    (patternConfidence === "high" || patternConfidence === "medium") &&
    caveatCount <= 4
  )
    return "medium";

  return "low";
}

function clusterConfidenceValue(band: string | null): number {
  switch (band) {
    case "high":
      return 1;
    case "medium":
      return 0.65;
    case "low":
      return 0.35;
    default:
      return 0.2;
  }
}

export function computeCaveatSeverity(caveats: string[]): number {
  let severity = 0;
  for (const c of caveats) {
    const lower = c.toLowerCase();
    if (lower.includes("doorway") || lower.includes("penalty"))
      severity += 3;
    else if (
      lower.includes("cannibalization") ||
      lower.includes("thin content")
    )
      severity += 2.5;
    else if (
      lower.includes("diminishing returns") ||
      lower.includes("weak transferability")
    )
      severity += 2;
    else if (
      lower.includes("comparability") ||
      lower.includes("uncertainty")
    )
      severity += 1.5;
    else severity += 1;
  }
  return severity;
}
