import type { Result } from "@/domains/results/types";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { CandidateLink } from "@/domains/attribution/types";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import type { CandidateResult } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { resolveEvents } from "@/domains/attribution/event-resolution";
import { buildActionClusters } from "./builders";
import type { ActionCluster } from "./types";

/**
 * Full pipeline: raw entities → resolved events → action clusters.
 * This is the single entry point for all cluster-aware surfaces.
 */
export function computeActionClusters(
  results: Result[],
  changes: ChangelogEntry[],
  opportunities: Opportunity[],
  candidateLinks: CandidateLink[]
): {
  clusters: ActionCluster[];
  resolvedEvents: ReturnType<typeof resolveEvents>;
  events: ReturnType<typeof detectOutcomeEvents>;
} {
  const { attribution } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attribution);

  const triageMap = new Map<string, ReturnType<typeof triageCandidates>>();
  const candCountMap = new Map<string, number>();
  const candidateMap = new Map<string, CandidateResult[]>();

  for (const event of events) {
    const anchor = results.find((r) => r.id === event.anchor_result_id);
    if (!anchor) continue;
    const cands = discoverCandidates(anchor, changes, opportunities);
    candCountMap.set(event.anchor_result_id, cands.length);
    triageMap.set(event.anchor_result_id, triageCandidates(cands));
    candidateMap.set(event.anchor_result_id, cands);
  }

  const resolvedEvents = resolveEvents(
    events,
    candidateLinks,
    triageMap,
    candCountMap
  );

  const clusters = buildActionClusters(
    resolvedEvents,
    opportunities,
    changes,
    candidateMap
  );

  return { clusters, resolvedEvents, events };
}
