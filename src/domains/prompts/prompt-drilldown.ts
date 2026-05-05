/**
 * Per-prompt drilldown aggregator for Prompt Decision Surface v1
 * (Phase v5 Commit 3, 2026-04-24).
 *
 * Rolls up all decision-relevant evidence for a single prompt and
 * builds a richer-than-list-view "so what" sentence that combines
 * the classifier's reasoning with a likely-action suffix.
 *
 * Pure. No I/O. Caller fetches observations, prompts, entities, and
 * (optionally) last-3 answer_texts and passes them in.
 */

import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import {
  classifyPromptOpportunity,
  type PromptOpportunity,
  type PromptOpportunityCategory,
  type ClassifyOptions,
} from "./opportunity-classify";
import {
  summarizePromptPrimary,
  type PromptPrimarySummary,
} from "./competitor-primary";
// Task 3 (2026-05-04, post-W4 verification): shared pollution filter
// dropped directories + generic-noun mentions from competitor lists.
import { makeCompetitorRankingFilter } from "@/domains/recommendations/entity-pollution-filter";

/** A competitor appearing on this prompt's observations. */
export type PromptCompetitorRow = {
  name: string;
  /** Count of observations (in lookback) where this competitor was co-mentioned. */
  appearances: number;
  /** Total observations of the prompt (denominator). */
  totalObservations: number;
};

/** One of the last-N raw observations, lightly shaped for the viewer. */
export type PromptRawAnswerSample = {
  observationId: string;
  observedAt: string;
  platform: string;
  ritzState: "primary" | "cited" | "mentioned" | "absent";
  citationRank: number | null;
  answerTextHead: string | null; // truncated preview
  answerTextFull: string | null; // full text (null if not fetched)
};

export type PromptDrilldown = {
  promptId: string;
  /** The prompt's full text. */
  promptText: string;
  /** Topic + geo badges (carry directly from TrackedPrompt). */
  topicId: string | null;
  locationScope: string | null;
  /** Category from the classifier. */
  category: PromptOpportunityCategory;
  /** The rich decision sentence: reasoning + likely action. */
  decisionSentence: string;
  /** The raw PromptOpportunity (evidence + reasoning) from the classifier. */
  classification: PromptOpportunity;
  /** Top competitors on this prompt, sorted by appearance frequency desc. */
  competitors: PromptCompetitorRow[];
  /** Descriptors AI used near the brand (from descriptor_window). */
  descriptorsNearBrand: Array<{ word: string; count: number }>;
  /**
   * Dominant answer-structure finding, or null when no clear dominance
   * (>=60% of one structure required). The renderer shows a one-line
   * callout when this exists.
   */
  dominantAnswerStructure: {
    structure: string;
    share: number;
    topCount: number;
    total: number;
  } | null;
  /**
   * Who occupies the "primary" slot in each answer — the brand, a dominant
   * competitor, or nobody (fragmented). Drives the "who IS the answer on
   * this prompt" subsection. (Phase v6 Commit 3, 2026-04-23.)
   */
  primarySummary: PromptPrimarySummary;
  /** Last 3 observations in time-desc order for the raw-evidence viewer. */
  rawSamples: PromptRawAnswerSample[];
};

export type BuildPromptDrilldownArgs = {
  prompt: TrackedPrompt;
  observations: ReadonlyArray<PromptAnswerObservation>;
  activeEntities: ReadonlyArray<TrackedEntity>;
  /**
   * Optional map of observation_id → answer_text body. When provided, the
   * rawSamples' answerTextFull + answerTextHead are populated. When omitted
   * or a row is missing, answerTextFull/Head are null and the UI shows a
   * placeholder.
   */
  answerTexts?: ReadonlyMap<string, string>;
  /** Classifier options (lookback etc). Defaults to classifier defaults. */
  classifyOptions?: ClassifyOptions;
  /** How many raw samples to return. Defaults to 3. */
  maxRawSamples?: number;
};

const LIKELY_ACTION_BY_CATEGORY: Record<PromptOpportunityCategory, string> = {
  outranked:
    "Likely action: competitive content targeting this prompt's intent and geo cluster — the competitors above are the field you're trying to enter.",
  absent:
    "Likely action: create a page that answers this question directly, or wait for the daily cron to accumulate more evidence that you belong here.",
  close:
    "Likely action: strengthen the target page's lead with descriptors AI isn't yet using near you.",
  winning:
    "Keep monitoring. Rising competitors and descriptor drift would be the early signals to watch.",
  early:
    "Check back once more native observations accumulate (next 10:00 UTC cron adds ~2 observations per prompt).",
};

export function buildPromptDrilldown(
  args: BuildPromptDrilldownArgs,
): PromptDrilldown {
  const classification = classifyPromptOpportunity({
    prompt: args.prompt,
    observations: args.observations,
    activeEntities: args.activeEntities,
    options: args.classifyOptions,
  });

  const decisionSentence = `${classification.reasoning} ${LIKELY_ACTION_BY_CATEGORY[classification.category]}`;

  // Top competitors on this prompt by co-mention appearance frequency.
  //
  // Task 3 (2026-05-04, post-W4 verification): apply the shared
  // `entity-pollution-filter` so directories (Houzz/Yelp/Angi) and
  // generic-noun mentions ("General Contractors", "Local Contractors")
  // do NOT surface as "competitors" on the prompts page. Same
  // contract used by the recommendation engine + visibility leaderboard.
  // Real builders (De Mattei, Kasten, CRC, Greenberg, Bay Builders)
  // are unaffected.
  const relevant = args.observations.filter(
    (o) => o.prompt_id === args.prompt.id,
  );
  const ownedNames = new Set(
    args.activeEntities
      .filter((e) => e.is_owned)
      .map((e) => e.name)
      .filter((n): n is string => Boolean(n)),
  );
  const competitorRankingFilter = makeCompetitorRankingFilter(
    args.activeEntities,
  );
  const competitorFreq = new Map<string, number>();
  for (const o of relevant) {
    const seenInObs = new Set<string>();
    for (const name of o.competitor_co_mentions ?? []) {
      if (!name || ownedNames.has(name) || seenInObs.has(name)) continue;
      // Pollution filter: directories + generic-noun entities are
      // dropped so "General Contractors" never appears as a competitor.
      if (!competitorRankingFilter(name)) continue;
      seenInObs.add(name);
      competitorFreq.set(name, (competitorFreq.get(name) ?? 0) + 1);
    }
  }
  const competitors: PromptCompetitorRow[] = [...competitorFreq.entries()]
    .sort(([, a], [, b]) => b - a || 0)
    .slice(0, 8)
    .map(([name, appearances]) => ({
      name,
      appearances,
      totalObservations: relevant.length,
    }));

  // Descriptors near the brand (aggregate from descriptor_window, dedup per-obs).
  const descriptorCounts = new Map<string, number>();
  for (const o of relevant) {
    const seen = new Set<string>();
    for (const d of o.descriptor_window ?? []) {
      if (!d || seen.has(d)) continue;
      seen.add(d);
      descriptorCounts.set(d, (descriptorCounts.get(d) ?? 0) + 1);
    }
  }
  const descriptorsNearBrand = [...descriptorCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([word, count]) => ({ word, count }));

  // Dominant answer structure — >=60% of observations share a single structure.
  const structureDist = classification.evidence.answerStructureDistribution;
  const totalStructureObs = Object.values(structureDist).reduce(
    (a, b) => a + b,
    0,
  );
  let dominantAnswerStructure: PromptDrilldown["dominantAnswerStructure"] = null;
  if (totalStructureObs > 0) {
    const sorted = [...Object.entries(structureDist)].sort(
      ([, a], [, b]) => b - a,
    );
    const [topStructure, topCount] = sorted[0];
    const share = topCount / totalStructureObs;
    if (share >= 0.6) {
      dominantAnswerStructure = {
        structure: topStructure,
        share: Math.round(share * 100) / 100,
        topCount,
        total: totalStructureObs,
      };
    }
  }

  // Last N raw samples (newest first).
  const maxRawSamples = args.maxRawSamples ?? 3;
  const sortedByTime = [...relevant].sort(
    (a, b) =>
      new Date(b.observed_at).getTime() - new Date(a.observed_at).getTime(),
  );
  const rawSamples: PromptRawAnswerSample[] = sortedByTime
    .slice(0, maxRawSamples)
    .map((o) => {
      const state: PromptRawAnswerSample["ritzState"] =
        o.primary_recommendation === true
          ? "primary"
          : typeof o.citation_rank === "number"
            ? "cited"
            : o.tracked_brand_mentioned === true
              ? "mentioned"
              : "absent";
      const full = args.answerTexts?.get(o.id) ?? null;
      const head =
        full && full.length > 200 ? `${full.slice(0, 200).trim()}…` : full;
      return {
        observationId: o.id,
        observedAt: o.observed_at,
        platform: (o.platform ?? "unknown").toLowerCase(),
        ritzState: state,
        citationRank: typeof o.citation_rank === "number" ? o.citation_rank : null,
        answerTextHead: head,
        answerTextFull: full,
      };
    });

  const primarySummary = summarizePromptPrimary({
    prompt_id: args.prompt.id,
    observations: args.observations,
    ownedEntityNames: ownedNames,
  });

  return {
    promptId: args.prompt.id,
    promptText: args.prompt.text,
    topicId: args.prompt.topic_id,
    locationScope: args.prompt.location_scope,
    category: classification.category,
    decisionSentence,
    classification,
    competitors,
    descriptorsNearBrand,
    dominantAnswerStructure,
    primarySummary,
    rawSamples,
  };
}
