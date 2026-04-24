/**
 * Competitor-primary aggregation per prompt (Phase v6 Commit 3, 2026-04-23).
 *
 * Pure function. Given a prompt's observations + owned-entity names, produces
 * a per-prompt rollup of who occupies the "primary" slot in each answer:
 *
 *   - The tracked brand wins the slot whenever `primary_recommendation === true`.
 *   - Otherwise the first non-owned entity in `competitor_co_mentions` wins.
 *     The extractor already stores that list in first-appearance order, so
 *     `competitor_co_mentions[0]` is a reasonable proxy for "the entity AI
 *     led with when the tracked brand wasn't primary".
 *
 * The output lets recommendation candidates carry real "who is actually
 * winning this prompt" evidence, and lets `/prompts/[id]` differentiate
 * "cited" from "IS the answer".
 *
 * Design constraints:
 *   - Pure, no I/O. All inputs explicit.
 *   - Deterministic. Same inputs → same outputs.
 *   - Applies the `NATIVE_REGIME_START` filter internally (mirrors the
 *     opportunity classifier) so mixed-source callers don't need to think
 *     about it — pre-pivot Profound rows have null extraction fields and
 *     would silently dilute the signal.
 *   - Every prompt resolves to primary / cited / absent. No "unknown" state.
 */

import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { NATIVE_REGIME_START } from "@/domains/product/url-citation-history";

export type PromptPrimaryCompetitor = {
  name: string;
  primaryCount: number;
  totalAnswers: number;
};

export type PromptPrimaryBrandState = "primary" | "cited" | "absent";

export type PromptPrimarySummary = {
  prompt_id: string;
  totalAnswers: number;
  /** Observations where `primary_recommendation === true`. */
  ritzPrimaryCount: number;
  /** ritzPrimaryCount / totalAnswers, rounded to 2 decimals. 0 when no obs. */
  ritzPrimaryShare: number;
  ritzState: PromptPrimaryBrandState;
  /** Competitors sorted by primaryCount desc. */
  primaryCompetitors: PromptPrimaryCompetitor[];
  /**
   * True when no single entity (tracked brand or any competitor) holds
   * `majorityThreshold` of the primary slot AND ≥2 distinct primary
   * entities were observed. A prompt where Ritz gets 2/5 and one
   * competitor gets 3/5 is NOT fragmented — the competitor is dominating.
   */
  fragmented: boolean;
};

export type SummarizePromptPrimaryArgs = {
  prompt_id: string;
  observations: ReadonlyArray<PromptAnswerObservation>;
  ownedEntityNames: ReadonlySet<string>;
  /** Majority threshold for ritzState="primary" and fragmented=false. Defaults to 0.5. */
  majorityThreshold?: number;
};

export function summarizePromptPrimary(
  args: SummarizePromptPrimaryArgs,
): PromptPrimarySummary {
  const threshold = args.majorityThreshold ?? 0.5;

  const relevant = args.observations.filter(
    (o) =>
      o.prompt_id === args.prompt_id &&
      o.observed_at.slice(0, 10) >= NATIVE_REGIME_START,
  );

  const totalAnswers = relevant.length;
  let ritzPrimaryCount = 0;
  let ritzMentionedCount = 0;
  const competitorPrimaryCounts = new Map<string, number>();

  for (const o of relevant) {
    if (o.tracked_brand_mentioned === true) ritzMentionedCount += 1;
    if (o.primary_recommendation === true) {
      ritzPrimaryCount += 1;
      continue;
    }
    const firstCompetitor = (o.competitor_co_mentions ?? []).find(
      (n) => n && !args.ownedEntityNames.has(n),
    );
    if (firstCompetitor) {
      competitorPrimaryCounts.set(
        firstCompetitor,
        (competitorPrimaryCounts.get(firstCompetitor) ?? 0) + 1,
      );
    }
  }

  const ritzPrimaryShare =
    totalAnswers > 0 ? ritzPrimaryCount / totalAnswers : 0;

  const primaryCompetitors: PromptPrimaryCompetitor[] = [
    ...competitorPrimaryCounts.entries(),
  ]
    .sort(([aName, aN], [bName, bN]) => bN - aN || aName.localeCompare(bName))
    .map(([name, primaryCount]) => ({ name, primaryCount, totalAnswers }));

  let ritzState: PromptPrimaryBrandState;
  if (ritzPrimaryShare >= threshold) {
    ritzState = "primary";
  } else if (ritzMentionedCount > 0) {
    ritzState = "cited";
  } else {
    ritzState = "absent";
  }

  const topCompetitorShare =
    primaryCompetitors[0] && totalAnswers > 0
      ? primaryCompetitors[0].primaryCount / totalAnswers
      : 0;
  const someoneDominates =
    ritzPrimaryShare >= threshold || topCompetitorShare >= threshold;
  const distinctPrimaryEntities =
    (ritzPrimaryCount > 0 ? 1 : 0) + primaryCompetitors.length;
  const fragmented =
    totalAnswers > 0 && !someoneDominates && distinctPrimaryEntities >= 2;

  return {
    prompt_id: args.prompt_id,
    totalAnswers,
    ritzPrimaryCount,
    ritzPrimaryShare: Math.round(ritzPrimaryShare * 100) / 100,
    ritzState,
    primaryCompetitors,
    fragmented,
  };
}

/**
 * Convenience: summarize every prompt in a single pass. Returns a Map keyed
 * by prompt_id so callers (e.g. decision-matrix builder) can look up a
 * prompt's primary rollup without re-scanning observations.
 */
export function summarizeAllPromptsPrimary(args: {
  promptIds: ReadonlyArray<string>;
  observations: ReadonlyArray<PromptAnswerObservation>;
  ownedEntityNames: ReadonlySet<string>;
  majorityThreshold?: number;
}): Map<string, PromptPrimarySummary> {
  const out = new Map<string, PromptPrimarySummary>();
  for (const prompt_id of args.promptIds) {
    out.set(
      prompt_id,
      summarizePromptPrimary({
        prompt_id,
        observations: args.observations,
        ownedEntityNames: args.ownedEntityNames,
        majorityThreshold: args.majorityThreshold,
      }),
    );
  }
  return out;
}
