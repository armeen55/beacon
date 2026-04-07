import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { CandidateLink } from "@/domains/attribution/types";
import { computeActionClusters } from "@/domains/action-clusters/compute";
import { extractPatterns } from "@/domains/patterns/builders";
import { buildActionQueue } from "./builders";
import { actionStates } from "./store";
import type { ActionItem } from "./types";
import type { ActionCluster } from "@/domains/action-clusters/types";
import type { ResolvedEvent } from "@/domains/attribution/event-resolution";
import type { OutcomeEvent } from "@/domains/attribution/events";
import type { Pattern } from "@/domains/patterns/types";

/**
 * Full pipeline: raw entities → clusters → patterns → action queue.
 * Single entry point for all action-aware surfaces.
 */
export function computeFullActionQueue(
  results: Result[],
  changes: ChangelogEntry[],
  opportunities: Opportunity[],
  candidateLinks: CandidateLink[]
): {
  actions: ActionItem[];
  clusters: ActionCluster[];
  resolvedEvents: ResolvedEvent[];
  events: OutcomeEvent[];
  patterns: Pattern[];
} {
  const { clusters, resolvedEvents, events } = computeActionClusters(
    results,
    changes,
    opportunities,
    candidateLinks
  );

  const patterns = extractPatterns(
    changes,
    clusters,
    resolvedEvents,
    opportunities
  );

  const actions = buildActionQueue(clusters, actionStates, patterns);

  return { actions, clusters, resolvedEvents, events, patterns };
}
