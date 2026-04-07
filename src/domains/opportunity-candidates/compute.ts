import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { CandidateLink } from "@/domains/attribution/types";
import type { OpportunityCandidate } from "./types";
import { generateCandidates } from "./builders";
import { computePatterns } from "@/domains/patterns/compute";

export function computeOpportunityCandidates(
  results: Result[],
  changes: ChangelogEntry[],
  opportunities: Opportunity[],
  candidateLinks: CandidateLink[]
): OpportunityCandidate[] {
  const { patterns, clusters } = computePatterns(
    results,
    changes,
    opportunities,
    candidateLinks
  );

  return generateCandidates(patterns, clusters, changes, opportunities);
}
