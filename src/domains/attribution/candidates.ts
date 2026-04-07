import type { ChangelogEntry } from "@/domains/changelog/types";
import type { Result } from "@/domains/results/types";
import type { Opportunity } from "@/domains/opportunities/types";
import type { Attribution } from "./types";
import { computeAttribution, computeConfidenceScore } from "./compute";
import { candidateLinks } from "./store";

export type CandidateResult = {
  change: ChangelogEntry;
  attribution: Attribution;
  score: number;
};

const DEFAULT_MAX_DAYS = 28;
const DEFAULT_MIN_SCORE = 35;
const DEFAULT_TOP_K = 10;

export function discoverCandidates(
  result: Result,
  allChanges: ChangelogEntry[],
  allOpportunities: Opportunity[],
  options?: { maxDays?: number; minScore?: number; topK?: number }
): CandidateResult[] {
  const maxDays = options?.maxDays ?? DEFAULT_MAX_DAYS;
  const minScore = options?.minScore ?? DEFAULT_MIN_SCORE;
  const topK = options?.topK ?? DEFAULT_TOP_K;

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
      return diffDays >= 0 && diffDays <= maxDays;
    })
    .map((change) => {
      const attribution = computeAttribution(change, result, allOpportunities);
      const score = computeConfidenceScore(attribution.matches);
      return { change, attribution, score };
    })
    .filter(({ score }) => score >= minScore)
    .sort((a, b) => b.score - a.score || a.attribution.temporal_distance_days - b.attribution.temporal_distance_days)
    .slice(0, topK);
}
