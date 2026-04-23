/**
 * Pure opportunity classifier for Prompt Decision Surface v1 (Phase v5, 2026-04-24).
 *
 * One function classifies ONE prompt into a decision-shaped category
 * based on the last N days of native observations of that prompt. A
 * second exported function does the cross-prompt cluster pass.
 *
 * Constraint: deterministic. No LLM. No scoring function with hidden
 * math. Every classification carries a `reasoning` string that tells
 * the operator exactly why this category fired.
 *
 * See `docs/OBSERVATION_SCHEMA_V2.md` + the Phase v5 proposal for the
 * 5-category taxonomy and precedence rules.
 */

import type { TrackedPrompt } from "@/domains/tracked-prompts/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type { PromptAnswerObservation } from "@/domains/prompt-answer-observations/types";
import { NATIVE_REGIME_START } from "@/domains/product/url-citation-history";

/** State-shaped labels — pressure-tested for 8 AM legibility. */
export type PromptOpportunityCategory =
  | "absent"
  | "outranked"
  | "close"
  | "winning"
  | "early";

export type PromptOpportunityTag =
  | "ranked_list_miss"
  | `geo_cluster:${string}`
  | `topic_cluster:${string}`;

export type PromptPlatformStats = {
  platform: string;
  observations: number;
  primary: number;
  cited: number;
  mentioned: number;
  absent: number;
  avgCitationRank: number | null;
};

export type PromptOpportunityEvidence = {
  observationCount: number;
  primaryCount: number;
  citedCount: number;
  mentionedCount: number;
  absentCount: number;
  avgCitationRank: number | null;
  /**
   * Canonical names of tracked competitors that appear in ≥2 of this
   * prompt's observations, ordered by co-mention frequency descending.
   */
  dominantCompetitors: string[];
  /** answer_structure value → count of observations with that structure. */
  answerStructureDistribution: Record<string, number>;
  /** Top descriptors aggregated across this prompt's observations. */
  topDescriptors: string[];
  byPlatform: PromptPlatformStats[];
  lookbackDays: number;
};

export type PromptOpportunity = {
  prompt_id: string;
  category: PromptOpportunityCategory;
  tags: PromptOpportunityTag[];
  /**
   * 0–100 signal strength used for sorting within the category group.
   * Honest derived value — NOT an opportunity score. It's "how strong
   * is the evidence that this category applies," not "how valuable is
   * this opportunity."
   */
  signalStrength: number;
  /** Single-sentence operator-facing reasoning. Rendered as the row's
   *  "decision one-liner" on /prompts and as the first sentence of the
   *  /prompts/[id] drilldown "so what" block. */
  reasoning: string;
  evidence: PromptOpportunityEvidence;
};

export type ClassifyOptions = {
  /** How many days of native observations to include. Defaults to 7. */
  lookbackDays?: number;
  /** "Now" (UTC ISO) for lookback calculation. Defaults to new Date(). */
  now?: Date;
  /** Min observations before leaving the "early" state. Defaults to 3. */
  minObservationsForCategory?: number;
  /** Fraction-of-obs threshold for Winning category. Defaults to 0.5. */
  winningPrimaryRate?: number;
  /** Min distinct dominant competitors to trip "Outranked". Defaults to 2. */
  outrankedMinCompetitors?: number;
};

const DEFAULT_OPTS: Required<ClassifyOptions> = {
  lookbackDays: 7,
  now: new Date(0), // replaced at call time
  minObservationsForCategory: 3,
  winningPrimaryRate: 0.5,
  outrankedMinCompetitors: 2,
};

/**
 * Classify a single prompt into one of the 5 state-shaped categories.
 * Pure. Takes all inputs explicitly.
 *
 * Precedence:
 *   1. Early    — <min observations → "too early to judge"
 *   2. Winning  — primary-rate ≥ threshold on any platform
 *   3. Outranked — brand absent + ≥2 dominant competitors
 *   4. Close    — brand cited but never primary
 *   5. Absent   — brand truly absent everywhere (fallback)
 */
export function classifyPromptOpportunity(args: {
  prompt: TrackedPrompt;
  observations: ReadonlyArray<PromptAnswerObservation>;
  activeEntities: ReadonlyArray<TrackedEntity>;
  options?: ClassifyOptions;
}): PromptOpportunity {
  const opts = { ...DEFAULT_OPTS, ...(args.options ?? {}) };
  const now = args.options?.now ?? new Date();
  const lookbackStartMs = now.getTime() - opts.lookbackDays * 86_400_000;

  const ownedEntities = args.activeEntities.filter((e) => e.is_owned);
  const ownedEntityNames = new Set(
    ownedEntities.map((e) => e.name).filter((n): n is string => Boolean(n)),
  );

  // Filter observations to this prompt + lookback window + native regime.
  //
  // Native-regime filter (observed_at >= NATIVE_REGIME_START) is critical:
  // pre-Apr-22 Profound-import rows lack populated schema-v2 extraction
  // fields (primary_recommendation, citation_rank, competitor_co_mentions,
  // etc.) and their platform labels are mixed-case ("Perplexity" vs
  // "perplexity"). Including them here dilutes the native signal and
  // makes classifications wrong — e.g., a prompt that's primary in 3 of
  // 3 native observations but has 20 pre-Apr-22 Profound rows with
  // null primary_recommendation drops below the 50% Winning threshold.
  const lookbackStartDate = new Date(lookbackStartMs)
    .toISOString()
    .slice(0, 10);
  const effectiveStart =
    lookbackStartDate < NATIVE_REGIME_START
      ? NATIVE_REGIME_START
      : lookbackStartDate;
  const relevant = args.observations.filter(
    (o) =>
      o.prompt_id === args.prompt.id &&
      o.observed_at.slice(0, 10) >= effectiveStart,
  );

  // Build per-platform + aggregate stats.
  const byPlatformMap = new Map<string, PromptPlatformStats>();
  let primaryCount = 0;
  let citedCount = 0;
  let mentionedCount = 0;
  let absentCount = 0;
  let citationRankSum = 0;
  let citationRankN = 0;
  const competitorMentionFreq = new Map<string, number>();
  const structureDist: Record<string, number> = {};
  const descriptorFreq = new Map<string, number>();

  for (const o of relevant) {
    // Case-normalize the platform key. Native polls write lowercase
    // ("perplexity" / "chatgpt"); legacy Profound benchmark rows use
    // mixed case ("Perplexity" / "ChatGPT" / "Google AI Overviews").
    // Without this, a prompt with observations in both regimes splits
    // into two buckets and the reasoning string contradicts itself.
    const key = (o.platform ?? "unknown").toLowerCase();
    let stats = byPlatformMap.get(key);
    if (!stats) {
      stats = {
        platform: key,
        observations: 0,
        primary: 0,
        cited: 0,
        mentioned: 0,
        absent: 0,
        avgCitationRank: null,
      };
      byPlatformMap.set(key, stats);
    }
    stats.observations += 1;

    // Bucket this observation.
    const isPrimary = o.primary_recommendation === true;
    const isCited = typeof o.citation_rank === "number";
    const isMentioned = o.tracked_brand_mentioned === true;

    if (isPrimary) {
      stats.primary += 1;
      primaryCount += 1;
    } else if (isCited) {
      stats.cited += 1;
      citedCount += 1;
    } else if (isMentioned) {
      stats.mentioned += 1;
      mentionedCount += 1;
    } else {
      stats.absent += 1;
      absentCount += 1;
    }

    if (typeof o.citation_rank === "number") {
      citationRankSum += o.citation_rank;
      citationRankN += 1;
    }

    // Competitor mentions — canonical names; only entities present in
    // activeEntities + not owned.
    for (const name of o.competitor_co_mentions ?? []) {
      if (!name || ownedEntityNames.has(name)) continue;
      competitorMentionFreq.set(
        name,
        (competitorMentionFreq.get(name) ?? 0) + 1,
      );
    }

    // Answer structure distribution.
    if (o.answer_structure) {
      structureDist[o.answer_structure] =
        (structureDist[o.answer_structure] ?? 0) + 1;
    }

    // Descriptor frequency (dedup within obs first).
    const seenInObs = new Set<string>();
    for (const d of o.descriptor_window ?? []) {
      if (!d || seenInObs.has(d)) continue;
      seenInObs.add(d);
      descriptorFreq.set(d, (descriptorFreq.get(d) ?? 0) + 1);
    }
  }

  // Finalize per-platform avg citation rank.
  for (const stats of byPlatformMap.values()) {
    // Recompute citation-rank average per platform from raw rows (using
    // the same case-normalized key).
    const platObs = relevant.filter(
      (o) => (o.platform ?? "unknown").toLowerCase() === stats.platform,
    );
    const ranks = platObs
      .map((o) => o.citation_rank)
      .filter((r): r is number => typeof r === "number");
    stats.avgCitationRank =
      ranks.length > 0
        ? Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10
        : null;
  }

  const byPlatform = [...byPlatformMap.values()].sort((a, b) =>
    a.platform.localeCompare(b.platform),
  );

  // Dominant competitors — mentioned in ≥2 observations of this prompt.
  const dominantCompetitors = [...competitorMentionFreq.entries()]
    .filter(([, n]) => n >= 2)
    .sort(([, a], [, b]) => b - a)
    .map(([name]) => name);

  const topDescriptors = [...descriptorFreq.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(([word]) => word);

  const avgCitationRank =
    citationRankN > 0
      ? Math.round((citationRankSum / citationRankN) * 10) / 10
      : null;

  const totalStructureObs = Object.values(structureDist).reduce((a, b) => a + b, 0);
  const rankedListObs = structureDist["ranked_list"] ?? 0;
  const isRankedListPrompt =
    totalStructureObs > 0 && rankedListObs / totalStructureObs >= 0.6;
  const brandMentionedAny = primaryCount + citedCount + mentionedCount > 0;

  const evidence: PromptOpportunityEvidence = {
    observationCount: relevant.length,
    primaryCount,
    citedCount,
    mentionedCount,
    absentCount,
    avgCitationRank,
    dominantCompetitors,
    answerStructureDistribution: structureDist,
    topDescriptors,
    byPlatform,
    lookbackDays: opts.lookbackDays,
  };

  const tags: PromptOpportunityTag[] = [];
  if (isRankedListPrompt && !brandMentionedAny) {
    tags.push("ranked_list_miss");
  }

  // --- Precedence 1: Early (not enough data) ---
  if (relevant.length < opts.minObservationsForCategory) {
    return {
      prompt_id: args.prompt.id,
      category: "early",
      tags,
      signalStrength: Math.round((relevant.length / opts.minObservationsForCategory) * 100),
      reasoning:
        relevant.length === 0
          ? `No native observations in the last ${opts.lookbackDays} days.`
          : `Only ${relevant.length} observation${relevant.length === 1 ? "" : "s"} in the last ${opts.lookbackDays} days (need ${opts.minObservationsForCategory}+ to judge).`,
      evidence,
    };
  }

  // --- Precedence 2: Winning ---
  // If any platform has primary_rate ≥ threshold AND has ≥ min observations,
  // call it Winning regardless of other platforms' states. The drilldown
  // surfaces per-platform splits for nuance.
  const winningPlatforms = byPlatform.filter(
    (p) =>
      p.observations >= opts.minObservationsForCategory &&
      p.primary / p.observations >= opts.winningPrimaryRate,
  );
  if (winningPlatforms.length > 0) {
    const top = winningPlatforms[0];
    const otherAbsent = byPlatform.filter(
      (p) => p.platform !== top.platform && p.observations > 0 && p.absent === p.observations,
    );
    const reasoning =
      otherAbsent.length > 0
        ? `Primary on ${platformLabel(top.platform)} (${top.primary} of ${top.observations}) · absent on ${otherAbsent.map((p) => platformLabel(p.platform)).join(", ")}.`
        : `Primary on ${platformLabel(top.platform)} (${top.primary} of ${top.observations}).`;
    return {
      prompt_id: args.prompt.id,
      category: "winning",
      tags,
      signalStrength: Math.min(
        100,
        Math.round((top.primary / top.observations) * 100),
      ),
      reasoning,
      evidence,
    };
  }

  // --- Precedence 3: Outranked (brand absent + dominant competitors) ---
  const brandTrulyAbsent =
    primaryCount === 0 && citedCount === 0 && mentionedCount === 0;
  if (
    brandTrulyAbsent &&
    dominantCompetitors.length >= opts.outrankedMinCompetitors
  ) {
    const top3 = dominantCompetitors.slice(0, 3).join(", ");
    return {
      prompt_id: args.prompt.id,
      category: "outranked",
      tags,
      signalStrength: Math.min(
        100,
        50 + dominantCompetitors.length * 10 + relevant.length * 2,
      ),
      reasoning: `You're absent; ${dominantCompetitors.length} competitors dominate (${top3}) across ${relevant.length} observations.`,
      evidence,
    };
  }

  // --- Precedence 4: Close (cited but never primary) ---
  if (!brandTrulyAbsent && primaryCount === 0) {
    const rankNote =
      avgCitationRank !== null ? `avg #${avgCitationRank}` : `no rank data`;
    return {
      prompt_id: args.prompt.id,
      category: "close",
      tags,
      signalStrength: Math.min(
        100,
        40 + (citedCount + mentionedCount) * 5,
      ),
      reasoning: `Cited or mentioned in ${citedCount + mentionedCount} of ${relevant.length} answers (${rankNote}), never primary.`,
      evidence,
    };
  }

  // --- Precedence 5: Absent (fallback) ---
  const rankedNote = isRankedListPrompt
    ? ` Prompt is answered as a ranked list — worth appearing on.`
    : "";
  const competitorNote =
    dominantCompetitors.length > 0
      ? ` ${dominantCompetitors.length} competitor${dominantCompetitors.length === 1 ? "" : "s"} appear here.`
      : "";
  return {
    prompt_id: args.prompt.id,
    category: "absent",
    tags,
    signalStrength: Math.min(
      100,
      30 + relevant.length * 3 + dominantCompetitors.length * 5,
    ),
    reasoning: `You're not mentioned in any of the last ${relevant.length} answers.${competitorNote}${rankedNote}`,
    evidence,
  };
}

/**
 * Convenience: convert platform key → operator label. Local copy to avoid
 * pulling UI-side constants into domain code.
 */
function platformLabel(p: string): string {
  if (p === "perplexity") return "Perplexity";
  if (p === "chatgpt" || p === "openai") return "ChatGPT";
  return p;
}
