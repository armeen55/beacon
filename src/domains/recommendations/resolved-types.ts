/**
 * Resolved recommendation types for Phase v7 (2026-04-23).
 *
 * v6 Commit 1 emits RecommendationCandidate (raw signal).
 * v7 Commit 1 wraps each candidate with a PageIntentResolution produced by
 * the observation-led resolver (+ inventory fallback and LLM adjudicator
 * in later commits). The resolver decides the operator-facing action,
 * motive, and target URL, so /recommendations shows "Strengthen
 * /locations/palo-alto" instead of "Create a Palo Alto page".
 *
 * Action says WHAT to do. Motive says WHY. They're separate fields because
 * "counter competitor" is not an action an operator can take directly —
 * the operator executes it as strengthen / expand / add / create / merge.
 */

import type { RecommendationCandidate } from "./generate";
import type {
  PageBrief,
  SuggestedEdit,
} from "./adjudicator-schema";

/** Operator-facing final action. The thing they actually do. */
export type RecommendationAction =
  | "strengthen_existing_page"
  | "expand_existing_page"
  | "add_section_or_faq"
  | "create_new_page"
  | "merge_or_dedupe"
  | "needs_review"
  | "watch";

/** Why this action is recommended. Separate from action on purpose. */
export type RecommendationMotive =
  | "counter_competitor"
  | "capture_absent_cluster"
  | "improve_close_prompt"
  | "defend_winning_cluster"
  | "resolve_cannibalization"
  | "improve_citation_depth";

/** Which layer produced the resolution. Drives the UI badge. */
export type ResolverTier =
  | "observation"         // Layer 1: cluster observations cite an owned URL
  | "inventory"           // Layer 2: sitemap / page-snapshots matched a URL
  | "adjudicated"         // Layer 3: LLM adjudicated the decision
  | "deterministic_only"; // all layers silent — no URL resolved

/** Sentinel value used in `targetUrl` when no existing page covers the
 *  cluster. Keeps the field a plain string (enum-friendly for the LLM's
 *  strict JSON schema). */
export const NEEDS_NEW_PAGE = "needs_new_page" as const;

/** Structured evidence refs. More debuggable than freeform strings —
 *  the UI can link to the prompt, the URL, or the competitor detail. */
export type EvidenceRef =
  | { type: "prompt"; id: string; promptText?: string }
  | { type: "url"; url: string; citationCount: number; observationCount: number }
  | { type: "competitor"; name: string; primaryShare: number };

export type PageIntentResolution = {
  action: RecommendationAction;
  motive: RecommendationMotive;
  /** Canonicalized URL string or `NEEDS_NEW_PAGE`. When the LLM
   *  adjudicator runs, this is enum-constrained at the schema level. */
  targetUrl: string;
  confidence: "high" | "medium" | "low";
  /** One-sentence operator-facing justification for the confidence level. */
  confidenceReason: string;
  tier: ResolverTier;
  /** One-sentence operator-facing explanation of the recommendation. */
  reasoning: string;
  /** Other URLs involved when `action === "merge_or_dedupe"`. Null otherwise. */
  cannibalization: string[] | null;
  /** Structured evidence refs; UI links back to these. */
  evidenceRefs: EvidenceRef[];
  /** Adjudicator-only fields — populated when tier === "adjudicated". */
  operatorTitle?: string;
  specificRecommendation?: string;
  suggestedEdits?: SuggestedEdit[];
  pageBrief?: PageBrief | null;
  proposedSlug?: string | null;
  risks?: string[];
  needsHumanReview?: boolean;
};

/** A candidate with its resolved action/motive/URL attached. */
export type ResolvedRecommendationCandidate = RecommendationCandidate & {
  resolution: PageIntentResolution;
};
