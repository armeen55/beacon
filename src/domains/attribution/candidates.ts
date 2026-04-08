import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Attribution, MatchStrength } from "./types";
import { computeAttribution, computeConfidenceScore } from "./compute";
import { candidateLinks } from "./store";
import { ATTRIBUTION_CONFIG } from "./config";

export type CandidateResult = {
  change: ChangelogEntry;
  attribution: Attribution;
  score: number;
};

/** True when at least one content-relevant factor is strong or partial. */
function hasMeaningfulSignal(matches: Attribution["matches"]): boolean {
  const meaningful = (m: MatchStrength) => m === "strong" || m === "partial";
  return (
    meaningful(matches.topic) ||
    meaningful(matches.url) ||
    meaningful(matches.geo) ||
    meaningful(matches.sourceCategory)
  );
}

export function discoverCandidates(
  result: Result,
  allChanges: ChangelogEntry[],
  allOpportunities: Opportunity[],
  options?: { maxDays?: number; minScore?: number; topK?: number }
): CandidateResult[] {
  const { maxDays, minScore, topK } = ATTRIBUTION_CONFIG.discovery;
  const maxDaysResolved = options?.maxDays ?? maxDays;
  const minScoreResolved = options?.minScore ?? minScore;
  const topKResolved = options?.topK ?? topK;

  const resultDate = new Date(result.snapshot_date).getTime();

  const excludeIds = new Set([
    ...result.attributed_changelog_ids,
    ...candidateLinks
      .filter(
        (cl) => cl.result_id === result.id && cl.status === "rejected"
      )
      .map((cl) => cl.change_id),
  ]);

  return allChanges
    .filter((change) => {
      if (excludeIds.has(change.id)) return false;
      const changeDate = new Date(change.timestamp).getTime();
      const diffDays = (resultDate - changeDate) / (1000 * 60 * 60 * 24);
      return diffDays >= 0 && diffDays <= maxDaysResolved;
    })
    .map((change) => {
      const attribution = computeAttribution(change, result, allOpportunities);
      const score = computeConfidenceScore(attribution.matches);
      return { change, attribution, score };
    })
    .filter(
      ({ score, attribution }) =>
        score >= minScoreResolved && hasMeaningfulSignal(attribution.matches)
    )
    .sort((a, b) => b.score - a.score || a.attribution.temporal_distance_days - b.attribution.temporal_distance_days)
    .slice(0, topKResolved);
}
