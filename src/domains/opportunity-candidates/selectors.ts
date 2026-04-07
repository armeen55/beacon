import type { OpportunityCandidate, CandidateConfidence } from "./types";

export function newCandidates(
  candidates: OpportunityCandidate[]
): OpportunityCandidate[] {
  return candidates.filter((c) => !c.alreadyExists);
}

export function candidatesByConfidence(
  candidates: OpportunityCandidate[],
  confidence: CandidateConfidence
): OpportunityCandidate[] {
  return candidates.filter((c) => c.confidence === confidence);
}

export function topCandidates(
  candidates: OpportunityCandidate[],
  n: number
): OpportunityCandidate[] {
  return newCandidates(candidates)
    .sort((a, b) => b.expectedImpact - a.expectedImpact)
    .slice(0, n);
}

export type CandidateSummary = {
  total: number;
  new: number;
  existing: number;
  high: number;
  medium: number;
  low: number;
  adjacent: number;
  expansion: number;
  gap: number;
  missing: number;
};

export function summarizeCandidates(
  candidates: OpportunityCandidate[]
): CandidateSummary {
  let newCount = 0;
  let existing = 0;
  let high = 0;
  let medium = 0;
  let low = 0;
  let adjacent = 0;
  let expansion = 0;
  let gap = 0;
  let missing = 0;

  for (const c of candidates) {
    if (c.alreadyExists) existing++;
    else newCount++;
    if (c.confidence === "high") high++;
    else if (c.confidence === "medium") medium++;
    else low++;
    switch (c.opportunityType) {
      case "adjacent": adjacent++; break;
      case "expansion": expansion++; break;
      case "gap": gap++; break;
      case "missing": missing++; break;
    }
  }

  return {
    total: candidates.length,
    new: newCount,
    existing,
    high,
    medium,
    low,
    adjacent,
    expansion,
    gap,
    missing,
  };
}
