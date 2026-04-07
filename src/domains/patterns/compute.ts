import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { CandidateLink } from "@/domains/attribution/types";
import type { ActionCluster } from "@/domains/action-clusters/types";
import type { ResolvedEvent } from "@/domains/attribution/event-resolution";
import { computeActionClusters } from "@/domains/action-clusters/compute";
import { extractPatterns } from "./builders";
import type { Pattern } from "./types";

/**
 * Full pipeline: entities → clusters → resolved events → patterns.
 * Single entry point for all pattern-aware surfaces.
 */
export function computePatterns(
  results: Result[],
  changes: ChangelogEntry[],
  opportunities: Opportunity[],
  candidateLinks: CandidateLink[]
): {
  patterns: Pattern[];
  clusters: ActionCluster[];
  resolvedEvents: ResolvedEvent[];
} {
  const { clusters, resolvedEvents } = computeActionClusters(
    results,
    changes,
    opportunities,
    candidateLinks
  );

  const patterns = extractPatterns(changes, clusters, resolvedEvents, opportunities);

  return { patterns, clusters, resolvedEvents };
}
