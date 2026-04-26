import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { CandidateLink } from "@/domains/attribution/types";
import type { OpportunityCandidate } from "@/domains/opportunity-candidates/types";
import type { ProposedBrief, PersistedBriefState } from "./types";
import type { PersistedActionState } from "@/domains/actions/types";
import { computeFullActionQueue } from "@/domains/actions/compute";
import { computeOpportunityCandidates } from "@/domains/opportunity-candidates/compute";
import { buildProposedBriefs } from "./builders";

export function computeProposedBriefs(
  results: Result[],
  changes: ChangelogEntry[],
  opportunities: Opportunity[],
  candidateLinks: CandidateLink[],
  persistedStates: PersistedBriefState[],
  actionStates: PersistedActionState[]
): {
  briefs: ProposedBrief[];
  candidates: OpportunityCandidate[];
} {
  const { actions, clusters, patterns } = computeFullActionQueue(
    results,
    changes,
    opportunities,
    candidateLinks,
    actionStates
  );

  const candidates = computeOpportunityCandidates(
    results,
    changes,
    opportunities,
    candidateLinks
  );

  const briefs = buildProposedBriefs(
    actions,
    clusters,
    patterns,
    opportunities,
    persistedStates
  );

  return { briefs, candidates };
}
