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
  candidateLinks: CandidateLink[],
  /** Tenant geo-expansion vocabulary (display case). 2026-06-11: the
   *  2026-06-10 work made generateCandidates injectable but this wrapper
   *  never threaded it — /expansion suggested founder cities to every
   *  tenant. Absent → founder default (Ritz parity); an injected EMPTY
   *  list means "no geo expansion" (content tenants). */
  cities?: ReadonlyArray<string>,
): OpportunityCandidate[] {
  const { patterns, clusters } = computePatterns(
    results,
    changes,
    opportunities,
    candidateLinks
  );

  return generateCandidates(patterns, clusters, changes, opportunities, cities);
}
