/**
 * Base recommendation type contracts.
 *
 * These types were previously co-located with the (now-removed) in-file
 * LLM generation pipeline (`generate.ts`) and the adjudicator schema
 * (`adjudicator-schema.ts`). The runtime that produced them is gone, but
 * the SHAPES remain the shared vocabulary the live surfaces still speak:
 *   - `RecommendationCandidate` / `RecommendationType` anchor the persisted
 *     queue loader + the Today top-pick card.
 *   - `SuggestedEdit` / `PageBrief` are carried on `PageIntentResolution`
 *     and rendered by the action-row builder.
 *
 * Pure types only. No runtime, no I/O.
 */

import type { PromptOpportunityCategory } from "@/domains/prompts/opportunity-classify";

/** Action taxonomy for v1. Five types; four participate in the ranked
 *  work queue, one (watch_winning_cluster) routes to the Watchlist. */
export type RecommendationType =
  | "create_cluster_page"
  | "create_single"
  | "target_competitors"
  | "strengthen_page_copy"
  | "watch_winning_cluster";

/** Severity tiers inherited from the v5 classifier categories. */
export type RecommendationSeverity = "high" | "medium" | "low";

/** Rule-based effort hint. No estimation math; maps directly from type. */
export type RecommendationEffort = "low" | "medium" | "high";

/** Aggregated primary-competitor rollup across the affected prompts. */
export type RecommendationPrimaryCompetitor = {
  name: string;
  /** How many of the affected prompts this competitor is primary-majority on. */
  promptsWherePrimary: number;
  /** Total affected prompts (denominator for share). */
  totalAffectedPrompts: number;
};

/** Evidence aggregated across the affected prompts. No extrapolation. */
export type RecommendationEvidence = {
  promptCount: number;
  observationCount: number;
  /** Counts by v5 category (absent/outranked/close/winning/early). */
  categoryBreakdown: Partial<Record<PromptOpportunityCategory, number>>;
  /** Top 3 dominant competitors aggregated from affected prompts. */
  dominantCompetitors: string[];
  /** Descriptors AI used near the brand (only populated for Strengthen
   *  where Ritz is cited). */
  descriptorsNearBrand: string[];
  /** Highest signalStrength from the affected prompt set (for ranking). */
  maxSignalStrength: number;
  /**
   * Top competitors by prompts where they're primary-majority, sorted
   * desc. Empty when no competitor hits majority on any affected prompt.
   * Populated from `matrix.primaryByPromptId`. (Phase v6 Commit 3.)
   */
  primaryCompetitors: RecommendationPrimaryCompetitor[];
  /** Count of affected prompts where the tracked brand is primary-majority. */
  brandPrimaryPromptCount: number;
  /** Count of affected prompts classified as fragmented (no majority). */
  fragmentedPromptCount: number;
};

export type RecommendationCandidate = {
  /** Stable identity for decision persistence. Survives small data shifts. */
  stableKey: string;
  type: RecommendationType;
  /** Short imperative phrase. */
  title: string;
  /** 1-2 sentence operator-facing "what this is" sentence. */
  description: string;
  /** Which prompt_ids this recommendation affects. */
  affectedPromptIds: string[];
  /** Cluster label (geo or topic) when applicable, else null. */
  clusterLabel: string | null;
  clusterKind: "geo" | "topic" | null;
  evidence: RecommendationEvidence;
  severity: RecommendationSeverity;
  effort: RecommendationEffort;
};

// ---------------------------------------------------------------------------
// Suggested-edit shapes (formerly in adjudicator-schema.ts). Carried on
// `PageIntentResolution.suggestedEdits` / `.pageBrief` and rendered by the
// action-row builder.
// ---------------------------------------------------------------------------

export type SuggestedEditType =
  | "new_page"
  | "section"
  | "faq"
  | "heading"
  | "meta_description"
  | "schema_markup"
  | "internal_link";

export type SuggestedEditScope =
  | "above_the_fold"
  | "body"
  | "sidebar"
  | "footer"
  | "metadata";

export type SuggestedEdit = {
  type: SuggestedEditType;
  scope: SuggestedEditScope;
  title: string | null;
  body: string | null;
  why: string;
};

export type PageBrief = {
  recommendedTitle: string;
  recommendedH1: string;
  targetPrompts: string[];
  mustCoverAngles: string[];
  competitorAnglesToCounter: string[];
  internalLinksToAdd: string[];
};
