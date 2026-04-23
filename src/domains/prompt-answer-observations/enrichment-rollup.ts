/**
 * Pure aggregator that rolls up per-observation schema v2 + v2.1 extraction
 * signal into a single Today-surface summary. Consumed by
 * src/components/today/enrichment-badges.tsx (Commit 7C, 2026-04-24).
 *
 * Input: today's UTC-date observations + the brand name.
 * Output: per-platform primary-recommendation rate, average citation rank,
 *         top descriptors, answer-structure breakdown.
 *
 * Pure: no I/O, no side effects. Testable without a DB.
 */

import type { PromptAnswerObservation } from "./types";

export type PlatformEnrichmentRollup = {
  platform: string;
  observations: number;
  /** # of observations where primary_recommendation=true. */
  primaryCount: number;
  /** primaryCount / observations, rounded to 2 decimals. Null when no obs. */
  primaryRate: number | null;
  /** # of observations where brand was cited (citation_rank non-null). */
  citedCount: number;
  /** Mean citation_rank across cited observations, rounded to 1 decimal.
   *  Null when no cited observations (rank is the position-in-list, so
   *  lower is better — "average rank 2.3" means the brand's citation is
   *  usually the 2nd or 3rd source). */
  avgCitationRank: number | null;
};

export type AnswerStructureRollup = {
  structure: string;
  count: number;
};

export type EnrichmentRollup = {
  /** ISO date (YYYY-MM-DD) the rollup represents. */
  date: string;
  /** Total brand-relevant observations on `date`. */
  totalObservations: number;
  /** Per-platform rollup (order = alphabetical, lowest-first for stable render). */
  byPlatform: PlatformEnrichmentRollup[];
  /**
   * Top `descriptor_window` tokens across all observations on `date`,
   * ordered by frequency (descending) and truncated to `maxDescriptors`.
   * Each token is lowercased; the same token across different observations
   * is summed. Primarily useful for a tag cloud.
   */
  topDescriptors: Array<{ word: string; count: number }>;
  /** Answer-structure breakdown — counts of each enum value seen. */
  answerStructures: AnswerStructureRollup[];
  /** Number of observations whose descriptor_window carried at least 1 token. */
  observationsWithDescriptors: number;
};

export type BuildEnrichmentRollupInput = {
  observations: ReadonlyArray<PromptAnswerObservation>;
  /** ISO date (YYYY-MM-DD). Only obs whose observed_at starts with this are used. */
  date: string;
  /** Max entries in `topDescriptors`. Defaults to 12. */
  maxDescriptors?: number;
};

export function buildEnrichmentRollup(
  input: BuildEnrichmentRollupInput,
): EnrichmentRollup {
  const maxDescriptors = input.maxDescriptors ?? 12;

  // Filter to the target date.
  const relevant = input.observations.filter((o) =>
    typeof o.observed_at === "string" && o.observed_at.startsWith(input.date),
  );

  // Aggregate per platform.
  const byPlatformMap = new Map<
    string,
    {
      observations: number;
      primaryCount: number;
      citedCount: number;
      citationRankSum: number;
    }
  >();
  for (const o of relevant) {
    const key = o.platform ?? "unknown";
    let entry = byPlatformMap.get(key);
    if (!entry) {
      entry = {
        observations: 0,
        primaryCount: 0,
        citedCount: 0,
        citationRankSum: 0,
      };
      byPlatformMap.set(key, entry);
    }
    entry.observations += 1;
    if (o.primary_recommendation === true) entry.primaryCount += 1;
    if (typeof o.citation_rank === "number") {
      entry.citedCount += 1;
      entry.citationRankSum += o.citation_rank;
    }
  }

  const byPlatform: PlatformEnrichmentRollup[] = [...byPlatformMap.entries()]
    .map(([platform, e]) => ({
      platform,
      observations: e.observations,
      primaryCount: e.primaryCount,
      primaryRate:
        e.observations > 0
          ? Math.round((e.primaryCount / e.observations) * 100) / 100
          : null,
      citedCount: e.citedCount,
      avgCitationRank:
        e.citedCount > 0
          ? Math.round((e.citationRankSum / e.citedCount) * 10) / 10
          : null,
    }))
    .sort((a, b) => a.platform.localeCompare(b.platform));

  // Aggregate descriptors across all observations.
  const descriptorCounts = new Map<string, number>();
  let obsWithDescriptors = 0;
  for (const o of relevant) {
    const tokens = o.descriptor_window ?? [];
    if (tokens.length > 0) obsWithDescriptors += 1;
    // Dedup within one observation (so a single answer that repeats a
    // descriptor doesn't get it counted twice in the cloud).
    const seen = new Set<string>();
    for (const token of tokens) {
      if (!token || seen.has(token)) continue;
      seen.add(token);
      descriptorCounts.set(token, (descriptorCounts.get(token) ?? 0) + 1);
    }
  }
  const topDescriptors = [...descriptorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, maxDescriptors)
    .map(([word, count]) => ({ word, count }));

  // Aggregate answer structures.
  const structureCounts = new Map<string, number>();
  for (const o of relevant) {
    const s = o.answer_structure;
    if (!s) continue;
    structureCounts.set(s, (structureCounts.get(s) ?? 0) + 1);
  }
  const answerStructures: AnswerStructureRollup[] = [
    ...structureCounts.entries(),
  ]
    .map(([structure, count]) => ({ structure, count }))
    .sort((a, b) => b.count - a.count);

  return {
    date: input.date,
    totalObservations: relevant.length,
    byPlatform,
    topDescriptors,
    answerStructures,
    observationsWithDescriptors: obsWithDescriptors,
  };
}
