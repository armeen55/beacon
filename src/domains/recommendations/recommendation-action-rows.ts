/**
 * W3 Step 3.5e (2026-05-03) — recommendation → action-row builder.
 *
 * Operator scope (browser audit, fourth pass): /recommendations is a
 * RANKED ACTION TABLE, not a card dashboard, lifecycle dashboard, or
 * evidence feed. Each row is ONE concrete website task an operator
 * (or their dev) can execute:
 *
 *   - Edit this H2
 *   - Create this page
 *   - Change this meta description
 *   - Add this schema
 *   - Add this FAQ
 *   - Rewrite this title
 *   - Add this section
 *
 * This module flattens the recommendation queue + linked specific
 * edits into a flat list of `RecommendationActionRow`s ready to feed
 * a HubSpot/Jira-style table. One rec with three usable edits emits
 * three rows. A rec with no usable edit emits at most ONE row, and
 * only when there's a clear manual task (split-page decision /
 * regenerate-edits / create-page); otherwise the rec is suppressed.
 *
 * Pure / deterministic. No I/O. No React.
 */

import type { LiveRecQueueItem } from "./load-queue";
import type { ActionType } from "./action-types";
import type {
  ImplementationStatus,
  RecommendedEditRow,
} from "./recommended-edits-persistence";
import type { SpecificEditEvidenceRef } from "./specific-edit-provider";
import type {
  PageIntentResolution,
  RecommendationAction,
  RecommendationMotive,
  ResolverTier,
} from "./resolved-types";
import { NEEDS_NEW_PAGE } from "./resolved-types";
import type { RecConfidenceVerdict } from "./confidence";
import type { SuggestedEdit } from "./adjudicator-schema";
import type { RecommendationResponse } from "@/domains/product/recommendation-response-store";
import { shouldExcludeFromCompetitorRanking } from "./entity-pollution-filter";
import { deriveConfidence } from "./derived-confidence";
import {
  buildGscEvidenceLines,
  buildSemrushEvidenceLines,
  type EvidenceLine,
} from "@/domains/recommendation-intelligence/evidence-summary";
import {
  composeEvidencePreview,
  composeRecommendedMove,
} from "./recommendation-evidence-preview";
import {
  cleanDisplayLabel,
  extractGeoTag,
  extractTopicFromPrompts,
  extractTopicTag,
  humanizeRecTitle,
  pageNameFromUrl,
  sanitizeClusterLabel,
} from "./recommendation-title-humanizer";
import { titleCase } from "./providers/generators/_text-utils";

// ── Type system ─────────────────────────────────────────────────────────

/**
 * Operator-facing action-row category. Ten visible types + two
 * meta-actions (review_decision / regenerate_edit) for recs that
 * need operator judgment instead of a copy-paste edit.
 */
export type ActionRowType =
  | "create_page"
  | "edit_h1"
  | "edit_h2"
  | "edit_title"
  | "edit_meta"
  | "add_schema"
  | "add_faq"
  | "add_section"
  | "improve_copy"
  | "add_internal_links"
  | "add_comparison_table"
  | "technical_fix"
  | "review_decision"
  | "regenerate_edit";

/**
 * Operator-readable label for a row's Type column.
 * W3 §3.11 (2026-05-04) — operator-locked taxonomy: 13 visible task
 * types + Regenerate meta-action. New since §3.5g: `edit_h1` (was
 * folded into "H2"), `add_comparison_table` (was folded into "Copy").
 */
export const ACTION_ROW_TYPE_LABEL: Record<ActionRowType, string> = {
  // W3 §3.11 (2026-05-04, operator-locked): "Page" replaces the
  // verbose "Create page" so this canonical label matches the
  // table's compact pill + the operator's planner taxonomy.
  create_page: "Page",
  edit_h1: "Page headline",
  edit_h2: "Section heading",
  edit_title: "Title",
  edit_meta: "Search result preview (title & description)",
  add_schema: "Search-engine details (schema)",
  add_faq: "FAQ",
  add_section: "Section",
  improve_copy: "Copy",
  add_internal_links: "Internal links",
  add_comparison_table: "Comparison table",
  technical_fix: "Technical fix",
  review_decision: "Review",
  regenerate_edit: "Regenerate",
};

/** Operator-facing priority label. NEVER "Weak signal" — we use Low
 *  when evidence is thin instead. */
export type ActionRowPriority = "high" | "medium" | "low";

export const ACTION_ROW_PRIORITY_LABEL: Record<ActionRowPriority, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Operator-facing status of one row. Maps from edit
 *  implementation_status + rec response.status. */
export type ActionRowStatus =
  | "new"
  | "accepted"
  | "shipped"
  | "measuring"
  | "needs_review"
  | "needs_fresh_edit"
  | "dismissed"
  | "deferred";

export const ACTION_ROW_STATUS_LABEL: Record<ActionRowStatus, string> = {
  new: "New",
  accepted: "Accepted",
  shipped: "Shipped",
  measuring: "Measuring",
  needs_review: "Needs review",
  // 2026-05-06 demo-path Phase 3-bis fix 2 — operator-friendly rename.
  // The internal enum stays `needs_fresh_edit` for backwards compat;
  // only the customer-visible label changes.
  needs_fresh_edit: "Needs new recommendation",
  dismissed: "Dismissed",
  deferred: "Deferred",
};

/**
 * Drawer / expansion payload. Available after the operator clicks a
 * row; never rendered in the default table. Pure data shape — the
 * UI maps fields onto sections (Exact change / Why / Evidence /
 * Measurement plan / Debug).
 */
export type ActionRowDetail = {
  /** Exact "before" copy when the action edits an existing element. */
  readonly currentText: string | null;
  /** Exact "after" copy the operator should ship. May be null for
   *  meta-actions (review_decision / regenerate_edit) and for some
   *  page-creation rows (a page brief takes its place). */
  readonly proposedText: string | null;
  /** Plain-English explanation. Comes from edit.why or the rec's
   *  resolution.reasoning (scrubbed). */
  readonly why: string | null;
  /** What Beacon will watch after acceptance. */
  readonly measurementPlan: string | null;
  /** Structured evidence refs from the edit (prompts, observations,
   *  citations). UI renders compactly; debug detail collapsed. */
  readonly evidenceRefs: ReadonlyArray<SpecificEditEvidenceRef>;
  /** The resolver's full reasoning paragraph. Diagnostic-grade —
   *  collapsed in the drawer's Debug section. */
  readonly fullReasoning: string | null;
  /** The resolver's `confidenceReason`. Diagnostic. */
  readonly confidenceReason: string | null;
  /** Operator-readable motive label (one sentence). Diagnostic. */
  readonly motiveLabel: string | null;
  /** Resolver-emitted page brief, when present. */
  readonly pageBrief: PageIntentResolution["pageBrief"] | null;
  /** Resolver-emitted suggested-edit list, when present. */
  readonly suggestedEdits: ReadonlyArray<SuggestedEdit>;
  /** Risks emitted by the resolver. */
  readonly risks: ReadonlyArray<string>;
  /** Cannibalization candidates emitted by the resolver. */
  readonly cannibalization: ReadonlyArray<string> | null;
  /** Top REAL competitor (filtered through entity-pollution-filter)
   *  with their primary share — for the drawer's evidence section. */
  readonly topCompetitor: {
    name: string;
    primaryPct: number;
  } | null;
  /** Affected prompt count (denormalized from rec.evidence). */
  readonly affectedPromptCount: number;
  /** Observation count (denormalized from rec.evidence). */
  readonly observationCount: number;
  /**
   * Customer-facing, number-rich Google Search evidence bullets
   * (2026-06-15) — the SPECIFIC "why this, why now": the exact query, how
   * many times the page showed up for it, the current rank, click-through
   * vs typical, and the recoverable-visits estimate. Built by
   * `buildGscEvidenceLines` from the rec's attached `gscSignal.topQueries`
   * (the richest evidence on the render path). Empty when the page has no
   * quotable Google Search demand — the card/drawer then keep their prose
   * "why". Honest: only numbers actually present on the signal.
   */
  readonly gscEvidenceLines: ReadonlyArray<EvidenceLine>;
  /**
   * Customer-facing SEMrush evidence bullets (2026-06-15 follow-up) — the
   * owner-requested "why": the exact keyword, its monthly search VOLUME,
   * its keyword DIFFICULTY (KD) with a plain band ("difficulty 31
   * (low/winnable)"), and the current rank. Built by
   * `buildSemrushEvidenceLines` from the rec's attached `semrushSignal`
   * (its striking-distance shortlist). Empty when the page has no SEMrush
   * striking-distance keyword — the card/drawer then keep their GSC lines /
   * prose "why". Honest: difficulty clause omitted when KD is absent.
   */
  readonly semrushEvidenceLines: ReadonlyArray<EvidenceLine>;
  /**
   * T4.2 (2026-05-06) — derived evidence depth: count of distinct
   * grounding-signal categories present on this row. Categories scanned:
   * prompt evidence (1), owned-page (1), competitor (1), element (1),
   * prior-outcome (1), multi-prompt bonus (1 when ≥2 prompts).
   * Used as a tiebreaker in the customer-facing rank sort so a
   * thin single-prompt row cannot outrank a multi-prompt-with-owned-page
   * row simply because it was created later.
   */
  readonly evidenceDepth: number;
  /**
   * T4.4 (2026-05-06) — customer-safe derived confidence label:
   * "strong_evidence" | "moderate_evidence" | "needs_review".
   * Derived from evidence depth + grounding-category presence so the
   * operator stops seeing every row labeled "medium". Pure function
   * of the row's signals; never mutates the persisted `confidence`
   * column.
   */
  readonly derivedConfidence: "strong_evidence" | "moderate_evidence" | "needs_review";
  /**
   * W3 §3.15 (2026-05-04) — for grouped FAQ Q+A rows, the answer's
   * full proposedText so the drawer can render question + answer
   * side-by-side. Null for non-FAQ rows and for orphan/legacy FAQ
   * rows that don't have a paired answer.
   */
  readonly faqAnswerText: string | null;
  /**
   * #310 (2026-06-14) — the source edit's RAW `action_type`. The
   * customer-facing `ActionRowType` collapses every indexability fix
   * (`fix_robots` / `fix_noindex` / `fix_canonical` / `fix_status_code`
   * / `fix_sitemap`) into `review_decision`, which loses the
   * distinction the indexing-safety caveat needs. Surfacing the
   * original action type here lets the directive card render the
   * "this changes how search engines crawl/index your site" warning
   * only for crawl/index-affecting directives (see
   * `isIndexingDirectiveActionType`). Null for meta-action rows
   * (review_decision / regenerate / create_page) with no source edit.
   */
  readonly editActionType: ActionType | null;
  /** Diagnostic block — internal taxonomy + IDs. Collapsed by default. */
  readonly debug: {
    readonly recommendationId: string;
    readonly editId: string | null;
    /**
     * W3 §3.15 (2026-05-04) — when this row groups a FAQ Q+A pair,
     * the answer edit's id (the `editId` field above carries the
     * QUESTION's id, since that's the primary key for accept/dismiss
     * routing). Null for non-paired rows.
     */
    readonly pairedAnswerEditId: string | null;
    readonly resolverTier: ResolverTier | null;
    readonly resolutionAction: RecommendationAction | null;
    readonly motive: RecommendationMotive | null;
    readonly engineConfidence: RecConfidenceVerdict;
    readonly evidenceHash: string | null;
    readonly editLifecycleStatus: ImplementationStatus | null;
    /**
     * T4.2 (2026-05-06) — prioritize.ts's tier ("now" | "this_week"
     * | "later"). Pre-T4.2 the customer-facing table discarded this
     * field; now it threads through as a sort tiebreaker between
     * status bucket and per-row priority. Diagnostic-grade — UI may
     * surface in operator-mode debug only.
     */
    readonly prioritizerTier: "now" | "this_week" | "later" | null;
    /**
     * T4.2 (2026-05-06) — the prioritizer's raw score (severity +
     * cluster bonus + competitor pressure − effort). Diagnostic only.
     */
    readonly prioritizerScore: number | null;
  };
};

/** One operator-facing row in the ranked action table. */
export type RecommendationActionRow = {
  /** Stable composite key for React + tests. Combines rec stableKey +
   *  edit id (or a suffix when this row maps to a meta-action). */
  readonly id: string;
  /** 1-based rank in the rendered table. */
  readonly rank: number;
  /** Concrete operator-readable action title. NOT a cluster
   *  description. NEVER "Create a page for this scenario." */
  readonly title: string;
  /** Clean target label ("Whole Home Remodel page" / "Homepage" /
   *  "New page"). */
  readonly targetLabel: string;
  /** Resolved target URL (or NEEDS_NEW_PAGE sentinel). Drawer-link
   *  consumers can use this. */
  readonly targetUrl: string | null;
  readonly actionType: ActionRowType;
  readonly priority: ActionRowPriority;
  readonly status: ActionRowStatus;
  /** Compact one-line evidence summary. */
  readonly evidenceSummary: string;
  /** Source recommendation `stableKey`. Rows from the same rec share
   *  this id. */
  readonly sourceRecommendationId: string;
  /** Specific-edit `id` when this row maps to one. Null for meta-
   *  action rows (create_page / review_decision / regenerate_edit). */
  readonly sourceEditId: string | null;
  /**
   * Round 1 customer-readiness (2026-05-05) — edit provider source so
   * the operator can see which rows came from the OpenAI specific-edit
   * provider vs the deterministic generators. Surfaces as a small
   * "AI" pill on the row. Null when no specific edit anchored this row
   * (meta-action rows: create_page / review_decision / regenerate_edit).
   * Values mirror `RecommendedEditRow.source` ("openai", "deterministic",
   * "anthropic", "operator_edited", "historical_recovered").
   */
  readonly editSource: string | null;
  /**
   * Round 1 customer-readiness (2026-05-05) — engine confidence verdict
   * promoted from `detail.debug.engineConfidence.confidence` to a
   * top-level field so the rec table can render a "High/Medium/Low
   * confidence" pill on the row without requiring the operator to
   * expand the Debug block. The full reason (`engineConfidence.reasons`)
   * stays in the drawer's Debug section per Round 1 brief
   * ("Keep `confidenceReason` in details/debug").
   */
  readonly engineConfidence: "high" | "medium" | "low" | null;
  /**
   * T4.4 (2026-05-06) — customer-safe derived confidence label promoted
   * to row top-level so the table can render a Strong/Moderate/Needs-
   * review pill alongside (or in place of) the legacy engineConfidence
   * pill. Pre-T4.4 every production row reported confidence='medium';
   * derivedConfidence is computed from evidence depth + grounding
   * categories so the operator sees true differentiation.
   */
  readonly derivedConfidence: "strong_evidence" | "moderate_evidence" | "needs_review";
  /** Whether this row was generated from an exact specific edit (vs
   *  a meta-action like Choose direction). Drives default-state copy. */
  readonly hasExactEdit: boolean;
  /** Whether the row should suppress accept-flow buttons (already
   *  accepted, dismissed, deferred-active). */
  readonly responseStatus: "accepted" | "dismissed" | "deferred" | null;
  /** Days since accept (when status === "accepted"). 0 otherwise. */
  readonly acceptedAgeDays: number;
  /** Defer-window expiration when applicable. */
  readonly deferUntil: string | null;
  /** Eligible (still pre-verified) edit count on the source rec —
   *  drives Mark-shipped affordance counts. */
  readonly eligibleEditCount: number;
  /** Drawer payload. Pure data; UI maps fields onto sections. */
  readonly detail: ActionRowDetail;
};

// ── Builder ─────────────────────────────────────────────────────────────

/**
 * Map an `ActionType` (specific-edit taxonomy) to the operator-facing
 * `ActionRowType`. Multiple action types may collapse into one row
 * type — e.g., `add_h2_section` and `rewrite_h2` both render as "H2".
 */
export function actionRowTypeForEdit(actionType: ActionType): ActionRowType {
  switch (actionType) {
    case "edit_title":
      return "edit_title";
    case "edit_meta":
      return "edit_meta";
    case "change_h1":
      // W3 §3.11 (2026-05-04): H1 surfaces as its own column; was
      // folded into "H2" prior to the planner landing.
      return "edit_h1";
    case "add_h2_section":
    case "rewrite_h2":
      return "edit_h2";
    case "add_faq":
    case "rewrite_faq":
      return "add_faq";
    case "add_schema":
    case "fix_schema":
      return "add_schema";
    case "add_internal_link":
      return "add_internal_links";
    case "add_proof_section":
    case "add_cost_section":
    case "add_timeline_section":
    case "add_answer_block":
      return "add_section";
    case "add_comparison_section":
    case "add_table":
      // W3 §3.11 (2026-05-04): comparison-stage demand surfaces as
      // its own "Table" column so the operator can pick it as a
      // distinct task from generic "Copy".
      return "add_comparison_table";
    case "edit_table_row":
      return "improve_copy";
    case "reorder_sections":
      return "technical_fix";
    case "create_page":
      return "create_page";
    case "split_page":
    case "merge_pages":
      return "review_decision";
    case "watch":
      return "review_decision";
    // Section 7 C7b (2026-05-16) — off-site / manual action types map
    // to the existing "review_decision" row type. This keeps Act 4
    // Suggested Copy suppressed automatically (review_decision is NOT
    // in SUGGESTED_COPY_ACTION_ROW_TYPES in suggested-copy-adapters.ts)
    // AND avoids adding a new ActionRowType value (which would force
    // edits to the customer-facing recommendations-client.tsx
    // COMPACT_LABEL exhaustive map). When C7e introduces a dedicated
    // off-site row type for the customer queue, this mapping flips
    // there. In C7b these arms are reachable only via type-narrowing —
    // no production code path persists or renders an off-site rec row
    // yet (generatorActive: false on every entry; rec creation /
    // acceptance / queue rendering all gated separately).
    case "claim_gbp":
    case "optimize_gbp_profile":
    case "request_gbp_reviews":
    case "claim_or_optimize_houzz":
    case "claim_or_optimize_yelp":
    case "submit_to_industry_directory":
    case "pursue_local_pr":
      return "review_decision";
    // Slice 4.5.B.α₀ (2026-05-19) — registry expansion. Dead-code
    // exhaustiveness arms: every entry below has
    // `generatorActive: false` in α₀, so no row builder path can
    // reach these in production. Real row-type mapping lands
    // alongside the matching deterministic predicates in later
    // 4.5.B.x / 4.5.C+ slices.
    case "update_intro":
    case "add_h3_section":
    case "add_image_alt_text":
      return "review_decision";
    // Slice 4.5.C.α₀ (2026-05-19) — indexability remediation
    // registry foundation. Dead-code arms; all five carry
    // `generatorActive: false` in α₀. Routing to "review_decision"
    // keeps Act 4 Suggested Copy suppressed automatically
    // (review_decision is NOT in SUGGESTED_COPY_ACTION_ROW_TYPES
    // in suggested-copy-adapters.ts) — these are operator-task
    // recommendations carrying `task_instructions`, not
    // publishable text. Real row-type mapping may revisit when
    // α₁/α₂ predicates land and the customer queue flip ships.
    case "fix_sitemap":
    case "fix_robots":
    case "fix_noindex":
    case "fix_status_code":
    case "fix_canonical":
      return "review_decision";
    // Clarity fuse (2026-06-13): page-experience defects render as a
    // technical fix (review_decision keeps Suggested Copy suppressed).
    case "fix_page_experience":
      return "review_decision";
  }
}

/**
 * Drop a target URL into a clean operator-facing label.
 *   /                              → "Homepage"
 *   /services/whole-home-remodel   → "Whole Home Remodel page"
 *   /locations/palo-alto           → "Palo Alto page"
 *   NEEDS_NEW_PAGE                 → "New page"
 *   ""                             → "Target page"
 *
 * The `pageNameFromUrl` helper already returns the readable phrase;
 * this helper appends " page" when the result isn't already a
 * page-name (avoids "homepage page").
 */
export function targetLabelForUrl(url: string | null): string {
  if (!url || url === NEEDS_NEW_PAGE) return "New page";
  const phrase = pageNameFromUrl(url);
  if (phrase === "homepage") return "Homepage";
  if (phrase === "target page") return "Target page";
  // For everything else ("Whole Home Remodel" / "Palo Alto"), append
  // " page" so the column reads as the operator expects ("Add an H2
  // to the Palo Alto page").
  return `${phrase} page`;
}

/**
 * Compose a per-row title for a specific edit. Operator scope (W3
 * §3.5f): must read as a concrete task with NO duplicate type
 * prefixes ("Add an H2 'H2: …'" was the operator-caught bug). Uses
 * `cleanDisplayLabel` to strip taxonomy prefixes like `H2:`, `New
 * FAQ:`, `H2 heading (new):`, `Title:`, `Meta:`, etc., plus matched
 * outer quotes. Re-quotes consistently with curly quotes (`"…"`).
 *
 * Priority:
 *   1. Edit's `display_label` when present — cleaned + re-quoted.
 *   2. Action-aware fallback ("Add an H2 to the {page} page",
 *      "Rewrite the {page} meta description", etc.).
 */
export function composeEditRowTitle(args: {
  readonly edit: RecommendedEditRow;
  readonly targetLabel: string;
  readonly topicTag: string | null;
}): string {
  const label = cleanDisplayLabel(args.edit.display_label);
  const targetLabel = args.targetLabel;
  const at = args.edit.action_type;
  const q = (s: string) => `“${truncate(s, 70)}”`; // curly quotes

  // Action-specific verb composition. Each branch reads as one
  // imperative ending at the target page — operator can scan the
  // table column quickly.
  switch (at) {
    case "edit_title":
      return label
        ? `Rewrite the ${targetLabel} title to ${q(label)}`
        : `Rewrite the ${targetLabel} title`;
    case "edit_meta":
      return label
        ? `Rewrite the ${targetLabel} meta description: ${q(label)}`
        : `Rewrite the ${targetLabel} meta description`;
    case "change_h1":
      return label
        ? `Change the H1 on the ${targetLabel} to ${q(label)}`
        : `Change the H1 on the ${targetLabel}`;
    case "add_h2_section":
      // W3 §3.15 (2026-05-04, operator scope): "Add "..." H2", not
      // "Add an "..."". Drop the dangling article so the title reads
      // as one imperative ending at the target page.
      return label
        ? `Add ${q(label)} H2 to the ${targetLabel}`
        : `Add a new H2 section to the ${targetLabel}`;
    case "rewrite_h2":
      return label
        ? `Rewrite the ${q(label)} H2 on the ${targetLabel}`
        : `Rewrite an H2 on the ${targetLabel}`;
    case "add_faq":
      // Standalone (un-paired) add_faq edits aren't surfaced as main
      // rows by `buildRecommendationActionRows` — paired Q+A rows are
      // grouped into one `Add FAQ: "{question}" …` row via
      // `composeFaqPairRowTitle`. This branch stays as a defensive
      // fallback for legacy data.
      return label
        ? `Add FAQ ${q(label)} to the ${targetLabel}`
        : `Add an FAQ entry to the ${targetLabel}`;
    case "rewrite_faq":
      return label
        ? `Rewrite the FAQ ${q(label)} on the ${targetLabel}`
        : `Rewrite an FAQ on the ${targetLabel}`;
    case "add_proof_section":
      return `Add a proof section to the ${targetLabel}`;
    case "add_cost_section":
      return `Add a cost section${args.topicTag ? ` (${args.topicTag})` : ""} to the ${targetLabel}`;
    case "add_timeline_section":
      return `Add a timeline section to the ${targetLabel}`;
    case "add_comparison_section":
      return `Add a comparison section${args.topicTag ? ` (${args.topicTag})` : ""} to the ${targetLabel}`;
    case "add_answer_block":
      return label
        ? `Add an answer block ${q(label)} to the ${targetLabel}`
        : `Add an answer block to the ${targetLabel}`;
    case "add_internal_link":
      return label
        ? `Add an internal link to the ${targetLabel} (${truncate(label, 40)})`
        : `Add an internal link to the ${targetLabel}`;
    case "add_schema":
      return label
        ? `Add ${truncate(label, 40)} schema to the ${targetLabel}`
        : `Add schema to the ${targetLabel}`;
    case "fix_schema":
      return label
        ? `Fix ${truncate(label, 40)} schema on the ${targetLabel}`
        : `Fix schema on the ${targetLabel}`;
    case "add_table":
      return `Add a comparison table to the ${targetLabel}`;
    case "edit_table_row":
      return `Update a comparison-table row on the ${targetLabel}`;
    case "reorder_sections":
      return `Reorder sections on the ${targetLabel}`;
    case "create_page":
      return label
        ? `Create the ${truncate(label, 60)} page`
        : `Create a new page`;
    case "split_page":
      return `Decide whether to split the ${targetLabel} into its own page`;
    case "merge_pages":
      return `Merge overlapping pages into the ${targetLabel}`;
    case "watch":
      return `Watch the ${targetLabel} cluster`;
    // Section 7 C7b (2026-05-16) — off-site / manual action types.
    // Row-title text mirrors the registry's `operatorLabel` verbatim
    // so the same locked, customer-safe phrasing is used wherever a
    // row title might surface. These arms are dead code in C7b (no
    // off-site rec row creation path exists yet — generatorActive is
    // false on every entry) but are required for TypeScript's
    // exhaustive switch on `ActionType`. C7c+ may revisit the
    // wording when actual generation lands.
    case "claim_gbp":
      return "Claim your Google Business Profile";
    case "optimize_gbp_profile":
      return "Optimize your Google Business Profile";
    case "request_gbp_reviews":
      return "Encourage new Google reviews";
    case "claim_or_optimize_houzz":
      return "Claim or improve your Houzz profile";
    case "claim_or_optimize_yelp":
      return "Claim or improve your Yelp profile";
    case "submit_to_industry_directory":
      return "Submit to an industry directory";
    case "pursue_local_pr":
      return "Pursue local press coverage";
    // Slice 4.5.B.α₀ (2026-05-19) — registry expansion. Dead-code
    // arms; generatorActive is false on each, so the action-row
    // builder never reaches these branches in production. Real
    // verb composition lands when the paired predicates do.
    case "update_intro":
      return label
        ? `Update the ${targetLabel} intro to ${q(label)}`
        : `Update the ${targetLabel} intro`;
    case "add_h3_section":
      return label
        ? `Add an H3 sub-section ${q(label)} to the ${targetLabel}`
        : `Add an H3 sub-section to the ${targetLabel}`;
    case "add_image_alt_text":
      return `Add image alt text on the ${targetLabel}`;
    // Slice 4.5.C.α₀ (2026-05-19) — indexability remediation
    // registry foundation. Dead-code arms; generatorActive is
    // false on each, so the action-row builder never reaches
    // these branches in production. Row-title wording mirrors the
    // registry's `operatorLabel` verbatim so the same locked,
    // customer-safe phrasing is used wherever a row title might
    // surface. α₁/α₂ may revisit the wording when actual
    // generation lands.
    case "fix_sitemap":
      return `Add the ${targetLabel} to your sitemap`;
    case "fix_robots":
      return `Unblock the ${targetLabel} in robots.txt`;
    case "fix_noindex":
      return `Remove the noindex tag from the ${targetLabel}`;
    case "fix_status_code":
      return `Restore a clean 200 response for the ${targetLabel}`;
    case "fix_canonical":
      return `Update the canonical tag on the ${targetLabel}`;
    case "fix_page_experience":
      return `Fix the page-experience issue on the ${targetLabel}`;
  }
}

// ── W3 §3.15 — FAQ Q+A pair grouping ──────────────────────────────────

/**
 * Extract the hash suffix from a `<type>[new]:<hash>` element key —
 * the same shape `validateSpecificEditBundle.checkFaqPairing` uses
 * for FAQ Q+A pairing. Returns null when the key is not additive or
 * has no `:hash` suffix.
 *
 * Pure, exported so the action-row builder + tests can dedupe FAQ
 * pairs by the same identity the validator uses.
 */
export function extractElementKeyHashSuffix(
  elementKey: string | null | undefined,
): string | null {
  if (typeof elementKey !== "string") return null;
  const additive = elementKey.match(/\[new\]:(.+)$/);
  if (additive && additive[1].length > 0) return additive[1];
  const colonIdx = elementKey.indexOf(":");
  if (colonIdx > 0 && colonIdx < elementKey.length - 1) {
    return elementKey.slice(colonIdx + 1);
  }
  return null;
}

/**
 * Compose the row title for a grouped FAQ Q+A pair. Operator scope
 * (W3 §3.15, 2026-05-04): the title uses the actual question text
 * (from the question row's `proposedText`), NOT the displayLabel
 * which often carries `(new)` / `(question)` qualifiers.
 *
 *   Add FAQ: "{question text}" to the {targetLabel}
 *
 * The question text is curly-quoted and capped at 100 chars (the FAQ
 * column needs to stay scannable). Falls back to a generic phrasing
 * when the question text is missing — defensive only; the validator
 * already enforces non-empty FAQ question text at persist time.
 */
export function composeFaqPairRowTitle(args: {
  readonly questionText: string | null;
  readonly targetLabel: string;
}): string {
  const q = (s: string) => `“${truncate(s, 100)}”`;
  const text = (args.questionText ?? "").trim();
  if (text.length === 0) {
    return `Add FAQ to the ${args.targetLabel}`;
  }
  return `Add FAQ: ${q(text)} to the ${args.targetLabel}`;
}

/**
 * Split a rec's renderable edits into:
 *   - `faqPairs[]`        — matched (faq_question[new]:<hash>,
 *                            faq_answer[new]:<hash>) tuples
 *   - `nonFaqEdits[]`     — every non-FAQ edit (existing one-row-per-
 *                            edit behavior)
 *   - `orphanFaqEdits[]`  — FAQ rows whose pair isn't present.
 *                            Operator scope (W3 §3.15): "unpaired FAQ
 *                            question/answer does not render as
 *                            active main-row task" — these are
 *                            suppressed from the table. Caller may
 *                            consult the array for diagnostics.
 *
 * Pure / deterministic. The validator's bundle-pairing gate already
 * blocks orphans at persist time, so production data will rarely
 * surface orphans. This helper is defensive against legacy bundles
 * + unit-test fixtures.
 */
export function partitionEditsForFaqPairing(
  edits: ReadonlyArray<RecommendedEditRow>,
): {
  faqPairs: ReadonlyArray<{
    hash: string;
    question: RecommendedEditRow;
    answer: RecommendedEditRow;
  }>;
  nonFaqEdits: ReadonlyArray<RecommendedEditRow>;
  orphanFaqEdits: ReadonlyArray<RecommendedEditRow>;
} {
  const questions = new Map<string, RecommendedEditRow>();
  const answers = new Map<string, RecommendedEditRow>();
  const nonFaqEdits: RecommendedEditRow[] = [];

  for (const edit of edits) {
    const key = edit.target_element_key ?? "";
    const isFaqQuestion = key.startsWith("faq_question[new]:");
    const isFaqAnswer = key.startsWith("faq_answer[new]:");
    if (!isFaqQuestion && !isFaqAnswer) {
      nonFaqEdits.push(edit);
      continue;
    }
    const hash = extractElementKeyHashSuffix(key);
    if (!hash) {
      // Malformed FAQ key — treat as orphan.
      nonFaqEdits.push(edit);
      continue;
    }
    if (isFaqQuestion) {
      // First-write wins on duplicate hashes (the validator rejects
      // duplicates upstream; this is defensive).
      if (!questions.has(hash)) questions.set(hash, edit);
      else nonFaqEdits.push(edit);
    } else {
      if (!answers.has(hash)) answers.set(hash, edit);
      else nonFaqEdits.push(edit);
    }
  }

  const faqPairs: Array<{
    hash: string;
    question: RecommendedEditRow;
    answer: RecommendedEditRow;
  }> = [];
  const orphanFaqEdits: RecommendedEditRow[] = [];
  // Stable iteration order: by hash ascending so tests + UI rendering
  // are deterministic across rec rebuilds.
  const allHashes = [
    ...new Set([...questions.keys(), ...answers.keys()]),
  ].sort();
  for (const hash of allHashes) {
    const q = questions.get(hash);
    const a = answers.get(hash);
    if (q && a) {
      faqPairs.push({ hash, question: q, answer: a });
    } else if (q) {
      orphanFaqEdits.push(q);
    } else if (a) {
      orphanFaqEdits.push(a);
    }
  }

  return { faqPairs, nonFaqEdits, orphanFaqEdits };
}

/**
 * For meta-action rows (create_page / review_decision / regenerate)
 * we don't have a specific edit to lean on. Compose from rec
 * resolution + topic tag + affected-prompt scan.
 *
 * Operator scope (Step 3.5f): NEVER "this opportunity" or
 * "this scenario". Decision rows must name the actual decision
 * (split / merge / strengthen / regenerate) plus topic + geo when
 * known. The `affectedPromptTexts` scan recovers a topic when the
 * cluster label is geo-only ("Atherton") or thin.
 */
export function composeMetaRowTitle(args: {
  readonly action: RecommendationAction;
  readonly clusterLabel: string | null;
  readonly affectedPromptTexts: ReadonlyArray<string>;
  readonly resolution: PageIntentResolution | null;
  readonly metaKind: "create_page" | "review_decision" | "regenerate_edit";
  readonly targetLabel: string;
  /** #149: per-tenant city vocabulary; absent → legacy Bay-Area default. */
  readonly knownCities?: ReadonlyArray<string>;
  /** #149-sibling: per-tenant service phrases for topic extraction. */
  readonly knownServices?: ReadonlyArray<string>;
}): string {
  // Topic ladder: cluster label first, then prompts.
  const topic =
    extractTopicTag(args.clusterLabel ?? "", args.knownServices) ??
    extractTopicFromPrompts(args.affectedPromptTexts, args.knownServices);
  const geo =
    extractGeoTag(args.clusterLabel ?? "", args.knownCities) ??
    extractGeoTag(args.affectedPromptTexts.join(" "), args.knownCities);

  if (args.metaKind === "create_page") {
    // Reuse the title humanizer (now topic-from-prompts aware).
    return humanizeRecTitle({
      clusterLabel: args.clusterLabel,
      affectedPromptTexts: args.affectedPromptTexts,
      resolution: args.resolution,
      knownCities: args.knownCities,
      knownServices: args.knownServices,
    });
  }
  if (args.metaKind === "review_decision") {
    if (args.action === "split_or_separate_page") {
      if (topic && args.targetLabel !== "New page") {
        return `Decide whether to split ${topic} off the ${args.targetLabel}`;
      }
      if (args.targetLabel !== "New page") {
        return `Decide whether to split the ${args.targetLabel} into its own page`;
      }
      if (topic) {
        return `Decide whether to split off a dedicated ${topic} page`;
      }
      return `Decide whether to split a bundled page`;
    }
    if (args.action === "merge_or_dedupe") {
      return args.targetLabel !== "New page"
        ? `Decide whether to merge overlapping pages into the ${args.targetLabel}`
        : `Decide whether to merge overlapping pages`;
    }
    if (args.action === "needs_review") {
      if (topic && geo) return `Decide direction for ${geo} ${topic}`;
      if (topic) return `Decide direction for ${topic}`;
      if (geo) return `Decide direction for ${geo}`;
      if (args.targetLabel !== "New page") {
        return `Review this ${args.targetLabel} opportunity`;
      }
      return `Review this page opportunity`;
    }
    return `Review this recommendation`;
  }
  // regenerate_edit
  if (topic && geo) {
    return `Regenerate edits for ${geo} ${topic}`;
  }
  if (topic) {
    return `Regenerate edits for ${topic}`;
  }
  if (args.targetLabel !== "New page") {
    return `Regenerate edits for the ${args.targetLabel}`;
  }
  return `Regenerate edits for this recommendation`;
}

/**
 * Map per-row priority. Operator scope (W3 §3.5f): "High = high
 * business priority," not raw confidence. The prior version capped
 * single-prompt at Low and treated `engineConfidence === low` as
 * always Low — that produced a queue of mostly-Low rows, which the
 * operator browser audit declared "looks like Beacon doesn't trust
 * itself."
 *
 * Revised rubric blends five signals:
 *   1. severity (high/medium/low) from the prioritizer
 *   2. observation count (richer evidence → higher priority)
 *   3. brand citation share (zero share + 10+ obs → Medium minimum)
 *   4. needsHumanReview (operator-flagged → Medium minimum)
 *   5. engineConfidence (still influences, never solely caps)
 *
 * Top-of-rank protection: a rec with `severity === "high"` AND
 * `observationCount >= 10` lands at High regardless of confidence.
 *
 * Pure / deterministic. No clock reads. Same inputs → same output.
 */
/**
 * T4.2 (2026-05-06) — Evidence-depth helper used by the customer-facing
 * sort to break ties between rows that share a status bucket + priority
 * tier. Counts how many distinct grounding-signal categories a row's
 * evidence array carries. The categories tracked match the structural
 * sources the abstention contract (T4.1) considers grounding:
 *
 *   - prompt: at least one prompt evidence ref → +1
 *   - multi-prompt bonus: ≥2 prompt refs → +1 (rewards multi-prompt
 *     packets, which the abstention contract treats as stronger
 *     grounding for FAQ answers)
 *   - owned_page: at least one owned-page evidence ref → +1
 *   - competitor: at least one competitor evidence ref → +1
 *   - element: at least one page-element evidence ref → +1
 *   - prior_outcome: at least one prior-outcome evidence ref → +1
 *
 * Returns 0..6. Higher = richer evidence. Pure: same input → same
 * output, safe to call from sort.
 *
 * Note: the persisted `evidence` array undercounts the original packet
 * (Phase 2.B audit found `search_query` evidence rows never ship). This
 * helper still returns a useful tiebreaker because it captures the
 * dimensions present, not absent.
 */
export function computeEvidenceDepth(
  evidenceRefs: ReadonlyArray<SpecificEditEvidenceRef>,
): number {
  let promptCount = 0;
  let ownedPageCount = 0;
  let competitorCount = 0;
  let elementCount = 0;
  let priorOutcomeCount = 0;
  for (const ref of evidenceRefs) {
    switch (ref.type) {
      case "prompt":
        promptCount += 1;
        break;
      case "owned_page":
        ownedPageCount += 1;
        break;
      case "competitor":
        competitorCount += 1;
        break;
      case "element":
        elementCount += 1;
        break;
      case "prior_outcome":
        priorOutcomeCount += 1;
        break;
    }
  }
  let depth = 0;
  if (promptCount > 0) depth += 1;
  if (promptCount >= 2) depth += 1; // multi-prompt bonus
  if (ownedPageCount > 0) depth += 1;
  if (competitorCount > 0) depth += 1;
  if (elementCount > 0) depth += 1;
  if (priorOutcomeCount > 0) depth += 1;
  return depth;
}

export function priorityForRow(args: {
  readonly engineConfidence: "high" | "medium" | "low";
  readonly severity: "high" | "medium" | "low";
  readonly affectedPromptCount: number;
  readonly observationCount: number;
  /** 0..1 — share of affected prompts where the brand is the
   *  primary cited entity. */
  readonly brandPrimaryShare: number;
  readonly needsHumanReview: boolean;
  readonly hasExactEdit: boolean;
  /** Pivot (2026-06-13) — per-page Google Search demand. First-party demand
   *  floors priority up independent of AEO. Impressions + striking-distance
   *  position are used (robust); CTR is intentionally NOT used to elevate
   *  until per-page totals land (the page+query CTR runs high). */
  readonly gscImpressions?: number;
  readonly gscPosition?: number;
}): ActionRowPriority {
  // GSC demand HIGH floor (pivot): a page with real first-party search demand
  // is worth acting on regardless of AEO. Heavy impressions, or
  // striking-distance (ranking ~5–20: one push from page one) with meaningful
  // impressions → High.
  const gscImpr = args.gscImpressions ?? 0;
  const gscPos = args.gscPosition ?? 0;
  if (gscImpr >= 1000) return "high";
  if (gscImpr >= 300 && gscPos >= 5 && gscPos <= 20) return "high";

  // High floor: operator-flagged + high-severity + rich-observation
  // recs cannot fall below High.
  if (args.severity === "high" && args.observationCount >= 10) return "high";
  if (
    args.severity === "high" &&
    args.hasExactEdit &&
    args.engineConfidence !== "low"
  ) {
    return "high";
  }

  // Medium floors:
  //   - operator-flagged review never lands at Low
  //   - zero brand share + 10+ observations + named cluster signals a
  //     real visibility gap, regardless of how thin per-edit confidence
  //   - exact edit + multi-prompt + non-low confidence
  //   - single-prompt + 8+ observations + non-zero severity (was
  //     forcibly Low under the old rubric)
  if (args.needsHumanReview) {
    return args.severity === "high" ? "high" : "medium";
  }
  if (args.brandPrimaryShare === 0 && args.observationCount >= 10) {
    return args.engineConfidence === "high" ? "high" : "medium";
  }
  if (
    args.hasExactEdit &&
    args.affectedPromptCount >= 2 &&
    args.engineConfidence !== "low"
  ) {
    return args.engineConfidence === "high" ? "high" : "medium";
  }
  if (
    args.affectedPromptCount === 1 &&
    args.observationCount >= 8 &&
    args.severity !== "low"
  ) {
    return "medium";
  }

  // GSC demand MEDIUM floor: moderate first-party impressions mean the page
  // has real search demand — it should never read as "thin/Low".
  if (gscImpr >= 200) return "medium";

  // Genuinely thin — Low.
  if (
    args.observationCount < 3 ||
    (args.affectedPromptCount <= 1 && args.observationCount < 5)
  ) {
    return "low";
  }
  if (args.engineConfidence === "low" && args.severity === "low") {
    return "low";
  }

  // Default Medium for everything else with measurable evidence.
  return "medium";
}

/**
 * Map a (rec response, edit lifecycle, displayState) tuple to the
 * operator-facing status enum. The priority order matters:
 *   1. Rec response.status (accept/dismiss/defer) wins because it's
 *      the most-recent operator decision.
 *   2. Otherwise the edit's lifecycle status drives.
 *   3. needsHumanReview overrides to "needs_review" before lifecycle.
 */
export function statusForRow(args: {
  readonly responseStatus: "accepted" | "dismissed" | "deferred" | null;
  readonly editLifecycleStatus: ImplementationStatus | null;
  readonly needsHumanReview: boolean;
  readonly hasNoEdits: boolean;
  readonly hasOnlyDismissedEdits: boolean;
}): ActionRowStatus {
  if (args.responseStatus === "dismissed") return "dismissed";
  if (args.responseStatus === "deferred") return "deferred";
  if (args.responseStatus === "accepted") {
    // Distinguish Accepted (operator said yes, scan hasn't yet
    // confirmed) from Shipped (verified live) and Measuring (verdict
    // clock running).
    const lifecycle = args.editLifecycleStatus;
    if (
      lifecycle === "verified_live" ||
      lifecycle === "verified_live_modified"
    ) {
      return "measuring";
    }
    return "accepted";
  }
  if (args.needsHumanReview) return "needs_review";
  if (args.hasOnlyDismissedEdits) return "needs_fresh_edit";
  if (args.hasNoEdits) return "needs_review";
  // Edit-specific lifecycle when the row isn't operator-decided yet.
  const lifecycle = args.editLifecycleStatus;
  if (lifecycle === "verified_live" || lifecycle === "verified_live_modified") {
    return "shipped";
  }
  if (lifecycle === "needs_review" || lifecycle === "wrong_page") {
    return "needs_review";
  }
  return "new";
}

/**
 * Compose a one-line evidence summary for a row. Operator scope (W3
 * §3.5f): NEVER repeat the same generic evidence across multiple
 * rows. Surface the specific gap — topic, city, target page — so
 * the operator can scan the Evidence column and tell rows apart.
 *
 * Format: `{N} AI answers; {specific gap}.`
 *
 * Examples (operator-locked):
 *   "12 AI answers; Ritz not cited for Atherton design-build comparisons."
 *   "33 AI answers; homepage cited instead of the Whole Home Remodel page."
 *   "36 AI answers; Los Altos page exists but Ritz is not winning."
 *   "8 AI answers; De Mattei winning Cupertino custom home queries."
 *   "12 AI answers; Schema missing on the Available Homes page."
 *
 * Pure / deterministic. Generic competitors filtered through
 * `shouldExcludeFromCompetitorRanking`.
 */
export function composeRowEvidenceSummary(args: {
  readonly rec: LiveRecQueueItem;
  readonly action: RecommendationAction;
  readonly hasResolvedTarget: boolean;
  readonly resolvedUrl: string | null;
  readonly targetLabel: string;
  readonly topicTag: string | null;
  readonly geoTag: string | null;
  /** Optional structural override (e.g., "Schema missing on the X
   *  page"). When present, takes precedence over the share-based
   *  summary. */
  readonly override?: string | null;
}): string {
  // ── Pivot (2026-06-13): lead with first-party Google Search demand when
  // present. For a review-gated SEO operator, GSC impressions/clicks/CTR/
  // position are the primary "why now" evidence; AEO citations are a
  // secondary signal (surfaced as a chip, not the lead). Falls through to the
  // AEO summary when the page has no GSC data. ──
  // Minimum 90-day page impressions before we LEAD with the precise Google
  // Search stat line. Below this, clicks/CTR/avg-position are noise — a page
  // with a handful of impressions has no demand signal worth quoting to four
  // significant figures — so fall through to the AEO/structural "why". 100
  // matches the page-level STRIKING_MIN_IMPRESSIONS the triggers gate on
  // (gsc-low-ctr.ts), so the lead and the trigger predicates agree.
  const GSC_EVIDENCE_MIN_IMPRESSIONS_90D = 100;
  const gsc = args.rec.gscSignal;
  if (gsc != null && gsc.impressions90d >= GSC_EVIDENCE_MIN_IMPRESSIONS_90D) {
    const clicks = Math.round(gsc.clicks90d).toLocaleString();
    const imp = Math.round(gsc.impressions90d).toLocaleString();
    const ctrPct = (gsc.ctr90d * 100).toFixed(1);
    const pos = gsc.position90d.toFixed(1);
    return `${clicks} clicks · ${imp} impressions · ${ctrPct}% CTR · avg position ${pos} (90-day Google Search)`;
  }

  const ev = args.rec.evidence;
  const N = ev.observationCount;
  const lead = `${N} AI answer${N === 1 ? "" : "s"}`;
  const topic = args.topicTag;
  const geo = args.geoTag;
  // Compose a topic+geo phrase ("Atherton design-build comparisons")
  // when both are known. Falls back to topic only / geo only / null.
  const topicGeoPhrase = topicGeoQueriesPhrase({ topic, geo });

  // audit wave-2 #10 (2026-06-14): only lead with the AEO answer COUNT when
  // it's real. With ZERO observations — a non-AEO-triggered card (content /
  // schema / internal-link) that also lacks a GSC signal — "0 AI answers;"
  // is noise, not the "why" (mirrors the #9 override-branch fix). Drop the
  // count and let the structural clause stand (capitalized). When N > 0 the
  // count is meaningful ("5 AI answers; your site isn't cited") and kept.
  const leadSummary = (clause: string): string =>
    N > 0 ? `${lead}; ${clause}` : clause.charAt(0).toUpperCase() + clause.slice(1);

  if (args.override && args.override.trim().length > 0) {
    const o = args.override.trim().replace(/\.$/, "");
    // audit #9 (2026-06-14): with NO GSC signal and ZERO AEO observations,
    // don't lead with a misleading "0 AI answers; …" — the structural reason
    // IS the honest "why". Keep the AEO count only when it's real (N > 0).
    return N > 0 ? `${lead}; ${o}.` : `${o}.`;
  }

  // Find the first REAL competitor that's clearly winning (≥ 50%
  // primary share). Used to surface "X winning {topic} queries" copy.
  const winningCompetitor = ev.primaryCompetitors.find((c) => {
    if (
      !c ||
      typeof c.name !== "string" ||
      c.name.trim().length === 0 ||
      shouldExcludeFromCompetitorRanking(c.name)
    ) {
      return false;
    }
    if (!c.totalAffectedPrompts) return false;
    const ratio = c.promptsWherePrimary / c.totalAffectedPrompts;
    return ratio >= 0.5;
  });
  const sharePct =
    ev.brandPrimaryPromptCount > 0 && ev.promptCount > 0
      ? Math.round((ev.brandPrimaryPromptCount / ev.promptCount) * 100)
      : 0;
  // W3 §3.5g — does at least one REAL competitor (filtered through
  // the entity-pollution filter) appear in any AI answer for this
  // cluster? Drives the "while competitors appear" suffix when Ritz
  // is absent.
  const realCompetitorPresent = ev.dominantCompetitors.some(
    (name) =>
      typeof name === "string" &&
      name.trim().length > 0 &&
      !shouldExcludeFromCompetitorRanking(name),
  );

  // ── Branch: explicit competitor dominance + topic ──
  if (winningCompetitor && topicGeoPhrase) {
    return `${lead}; ${winningCompetitor.name} winning ${topicGeoPhrase}.`;
  }
  // ── Branch: explicit competitor dominance, no topic ──
  if (winningCompetitor && args.targetLabel !== "New page") {
    return `${lead}; ${winningCompetitor.name} winning across the ${args.targetLabel}.`;
  }
  // ── Branch: zero brand share, has cluster + topic ──
  if (sharePct === 0 && topicGeoPhrase) {
    const tail = realCompetitorPresent ? " while competitors appear" : "";
    return `${leadSummary(`your site isn't cited for ${topicGeoPhrase}${tail}`)}.`;
  }
  // ── Branch: zero brand share, has target page ──
  if (sharePct === 0 && args.targetLabel !== "New page") {
    const tail = realCompetitorPresent ? " while competitors appear" : "";
    return `${leadSummary(`${args.targetLabel} not cited${tail}`)}.`;
  }
  // ── Branch: zero brand share, no signal ──
  if (sharePct === 0) {
    const tail = realCompetitorPresent ? " while competitors appear" : "";
    return `${leadSummary(`your site isn't cited yet${tail}`)}.`;
  }
  // ── Branch: brand cited but losing — has topic ──
  if (sharePct < 30 && topicGeoPhrase) {
    return `${lead}; your site cited ${sharePct}% of ${topicGeoPhrase}.`;
  }
  if (sharePct < 30 && args.targetLabel !== "New page") {
    return `${lead}; ${args.targetLabel} cited ${sharePct}%; needs more coverage.`;
  }
  // ── Branch: brand close to winning ──
  if (sharePct < 60 && topicGeoPhrase) {
    return `${lead}; your site close on ${topicGeoPhrase} (${sharePct}%).`;
  }
  if (sharePct < 60 && args.targetLabel !== "New page") {
    return `${lead}; ${args.targetLabel} close at ${sharePct}%; needs more coverage.`;
  }
  // ── Branch: brand winning — defend ──
  if (topicGeoPhrase) {
    return `${lead}; your site primary on ${topicGeoPhrase} (${sharePct}%).`;
  }
  if (args.targetLabel !== "New page") {
    return `${lead}; ${args.targetLabel} primary at ${sharePct}%.`;
  }
  // ── Last-resort fallback (no topic, no target). Defer to the
  //     existing one-sentence preview helper for safety. ──
  const fallback = composeEvidencePreview({
    affectedPromptCount: ev.promptCount,
    observationCount: ev.observationCount,
    brandPrimaryShare: ev.brandPrimaryPromptCount / Math.max(ev.promptCount, 1),
    primaryCompetitors: ev.primaryCompetitors,
    resolvedAction: args.action,
    resolvedTargetUrl: args.resolvedUrl,
    hasResolvedTarget: args.hasResolvedTarget,
  });
  // Force the operator-locked "{N} AI answers; …" lead.
  return /^\d+\s+AI answer/.test(fallback)
    ? fallback
    : `${lead}; ${fallback.replace(/\.$/, "")}.`;
}

/**
 * Compose a topic + geo phrase suitable for the Evidence column.
 *
 *   topic="design-build vs architect" + geo="Atherton" →
 *     "Atherton design-build vs architect queries"
 *   topic="vacant-lot custom home" + geo="Palo Alto" →
 *     "Palo Alto vacant-lot custom home queries"
 *   topic only → "{topic} queries"
 *   geo only → "{geo} queries"
 *   neither → null
 */
function topicGeoQueriesPhrase(args: {
  topic: string | null;
  geo: string | null;
}): string | null {
  const { topic, geo } = args;
  if (topic && geo) {
    // Decision/comparison topics read better as "comparisons" /
    // "decisions" instead of "queries" — hint is the " vs " marker.
    if (topic.includes(" vs ")) {
      return `${geo} ${topic} comparisons`;
    }
    return `${geo} ${topic} queries`;
  }
  if (topic) {
    if (topic.includes(" vs ")) return `${topic} comparisons`;
    return `${topic} queries`;
  }
  if (geo) return `${geo} queries`;
  return null;
}

/**
 * Pick a structural override for an edit that has a specific
 * operator-readable evidence bullet (e.g., schema rows say
 * "Schema missing on the X page" instead of a share %). Falls back
 * to null when no specific structural fact applies.
 *
 * The override is plugged into `composeRowEvidenceSummary` and
 * surfaces as `{N} AI answers; {override}` so each row reads
 * specifically.
 */
function structuralOverrideForEdit(
  edit: RecommendedEditRow,
  targetLabel: string,
): string | null {
  const onPage =
    targetLabel === "New page"
      ? ""
      : targetLabel === "Homepage"
        ? " on the homepage"
        : ` on the ${targetLabel}`;
  switch (edit.action_type) {
    case "add_schema":
      return `Schema missing${onPage}`;
    case "fix_schema":
      return `Schema needs fixing${onPage}`;
    case "add_faq":
      return `FAQ missing${onPage}`;
    case "rewrite_faq":
      return `FAQ weak${onPage}`;
    case "edit_meta":
      return `Meta description weak${onPage}`;
    case "edit_title":
      return `Title underperforming${onPage}`;
    case "add_internal_link":
      return `Internal links missing${onPage}`;
    case "reorder_sections":
      return `Section order suboptimal${onPage}`;
    default:
      return null;
  }
}

// ── Top-level builder ──────────────────────────────────────────────────

/** Minimal MOTIVE_LABEL map (mirrors the client constant). Kept here
 *  so the row builder is self-contained for tests. */
const MOTIVE_LABEL: Record<RecommendationMotive, string> = {
  counter_competitor: "A competitor is currently winning this answer.",
  capture_absent_cluster: "AI isn't citing your site for this topic yet.",
  improve_close_prompt: "Your site is close, but the page needs more coverage.",
  defend_winning_cluster:
    "Your site is currently the primary answer — keep it that way.",
  resolve_cannibalization:
    "Multiple of your pages compete for the same answer.",
  improve_citation_depth:
    "Your site is cited but ranks low — strengthen the page.",
};

export type BuildActionRowsArgs = {
  /** The full prioritized queue + per-rec response + per-rec edits. */
  readonly queue: ReadonlyArray<{
    readonly rec: LiveRecQueueItem;
    readonly response: RecommendationResponse | null;
    readonly edits: ReadonlyArray<RecommendedEditRow>;
  }>;
  /** Prompt-id → prompt-text lookup. Used to scan affected-prompt
   *  texts for topic / geo signals when the cluster label is thin
   *  (e.g., geo-only "Atherton" → topic recovered via prompts).
   *  Optional — falls back to empty when missing. */
  readonly promptTextById?: Record<string, string>;
  /** Optional now-clock for stale-pending math. Defaults to
   *  Date.now(). */
  readonly now?: Date;
  /** #149 (2026-06-11): per-tenant city vocabulary
   *  (BusinessConfig.locations) for geo-tag extraction in row titles.
   *  Absent → legacy Bay-Area default (founder parity). */
  readonly knownCities?: ReadonlyArray<string>;
  /** #149-sibling: per-tenant service phrases (BusinessConfig.services)
   *  — topic extraction tries these before the builder topic table. */
  readonly knownServices?: ReadonlyArray<string>;
};

/**
 * Flatten the recommendation queue into a flat ranked action table.
 *
 * Rules (operator-locked):
 *   - One renderable specific edit → one action row.
 *   - Rec with action `create_new_page` and zero edits → one
 *     create_page action row.
 *   - Rec with action `split_or_separate_page` / `merge_or_dedupe` /
 *     `needs_review` and zero renderable edits → one review_decision row.
 *   - Rec with all-dismissed edits → one regenerate_edit row.
 *   - Otherwise (no renderable edits AND no manual task) → suppressed.
 *   - Dismissed/deferred-active recs → suppressed (they live behind
 *     the status filter).
 *   - The `rank` field is 1-based after sort by (priority desc → rec
 *     score desc → stableKey asc) for deterministic order.
 */
export function buildRecommendationActionRows(
  args: BuildActionRowsArgs,
): RecommendationActionRow[] {
  const now = (args.now ?? new Date()).getTime();
  const promptTextById = args.promptTextById ?? {};
  const rows: RecommendationActionRow[] = [];

  for (const item of args.queue) {
    const { rec, response, edits } = item;
    const responseStatus = response?.status ?? null;
    // Defer-active is suppressed unless the operator explicitly
    // shows it via filter.
    if (responseStatus === "dismissed") {
      // Dismissed recs are visible only behind a filter — emit no
      // rows here. Future: add a `includeDismissed` flag if needed.
      continue;
    }
    if (responseStatus === "deferred") {
      const deferUntil = response?.deferUntil
        ? new Date(response.deferUntil).getTime()
        : null;
      if (deferUntil != null && deferUntil > now) {
        continue;
      }
    }
    const renderable = edits.filter((e) => {
      const s = e.implementation_status ?? "recommended";
      return s !== "dismissed" && s !== "not_found_after_7d";
    });
    const allEdits = edits;
    const hasOnlyDismissedEdits =
      renderable.length === 0 && allEdits.length > 0;

    const resolution = rec.resolution ?? null;
    const action: RecommendationAction =
      resolution?.action ?? "create_new_page";
    const resolvedUrl =
      resolution?.targetUrl && resolution.targetUrl !== NEEDS_NEW_PAGE
        ? resolution.targetUrl
        : null;
    const targetLabel = targetLabelForUrl(resolvedUrl);

    // W3 §3.5f — affected-prompt scan: gives us topic + geo for
    // geo-only clusters (e.g., "Atherton" alone → "design-build vs
    // architect" when the cluster's prompts cover that scenario).
    const affectedPromptTexts: string[] = (rec.affectedPromptIds ?? [])
      .map((id) => promptTextById[id] ?? "")
      .filter((s) => s.length > 0);
    const topicTag =
      extractTopicTag(rec.clusterLabel ?? rec.title ?? "", args.knownServices) ??
      extractTopicFromPrompts(affectedPromptTexts, args.knownServices);
    const geoTag =
      extractGeoTag(rec.clusterLabel ?? rec.title ?? "", args.knownCities) ??
      extractGeoTag(affectedPromptTexts.join(" "), args.knownCities);

    const motiveLabel = resolution?.motive
      ? MOTIVE_LABEL[resolution.motive] ?? null
      : null;
    const brandPrimaryShare =
      rec.evidence.promptCount > 0
        ? rec.evidence.brandPrimaryPromptCount / rec.evidence.promptCount
        : 0;
    const needsHumanReview = resolution?.needsHumanReview ?? false;

    const topCompetitor = (() => {
      const c = rec.evidence.primaryCompetitors.find(
        (cc) =>
          cc &&
          typeof cc.name === "string" &&
          cc.name.trim().length > 0 &&
          !shouldExcludeFromCompetitorRanking(cc.name),
      );
      if (!c || c.totalAffectedPrompts === 0) return null;
      const pct = Math.round(
        (c.promptsWherePrimary / c.totalAffectedPrompts) * 100,
      );
      return { name: c.name, primaryPct: pct };
    })();

    const acceptedAt =
      response?.status === "accepted" && response.respondedAt
        ? new Date(response.respondedAt)
        : null;
    const acceptedAgeDays = acceptedAt
      ? Math.floor((now - acceptedAt.getTime()) / 86_400_000)
      : 0;
    const eligibleEditCount = renderable.filter((e) => {
      const s = e.implementation_status ?? "recommended";
      return s === "recommended" || s === "accepted";
    }).length;

    // Customer-facing, number-rich Google Search evidence (2026-06-15).
    // Depends only on the rec's attached GSC signal, so it's the same for
    // every row this rec emits — compute once, share across push sites.
    const gscEvidenceLines = buildGscEvidenceLines(rec.gscSignal);
    // Customer-facing SEMrush evidence (2026-06-15 follow-up): exact search
    // volume + keyword difficulty + current rank. Same for every row this
    // rec emits — compute once, share across the three push sites below.
    const semrushEvidenceLines = buildSemrushEvidenceLines(rec.semrushSignal);

    // ── Path A: renderable specific edits → group FAQ Q+A pairs into
    // one row, then emit one row per non-FAQ edit. Orphan FAQ rows
    // (question without answer or vice-versa) are suppressed per
    // operator scope W3 §3.15. Non-empty `nonFaqEdits` OR `faqPairs`
    // means we emit at least one row and skip the meta-path below.
    if (renderable.length > 0) {
      const { faqPairs, nonFaqEdits } = partitionEditsForFaqPairing(renderable);

      // ── Path A.1: one grouped row per matched FAQ Q+A pair. ──
      for (const pair of faqPairs) {
        const { question, answer, hash } = pair;
        const editAnchorUrl =
          typeof question.target_url === "string" &&
          question.target_url.length > 0 &&
          question.target_url !== NEEDS_NEW_PAGE
            ? question.target_url
            : null;
        const editTargetLabel = editAnchorUrl
          ? targetLabelForUrl(editAnchorUrl)
          : targetLabel;
        // Use the question row's actual proposedText as the title —
        // operator scope W3 §3.15 explicitly bans the displayLabel
        // ("FAQ question: What to look for in a luxury home builder
        // (new)") from leaking into the table title.
        const title = composeFaqPairRowTitle({
          questionText: question.proposed_text,
          targetLabel: editTargetLabel,
        });
        const priority = priorityForRow({
          engineConfidence: rec.engineConfidence.confidence,
          severity: rec.severity,
          affectedPromptCount: rec.evidence.promptCount,
          observationCount: rec.evidence.observationCount,
          brandPrimaryShare,
          needsHumanReview,
          hasExactEdit: true,
          gscImpressions: rec.gscSignal?.impressions90d,
          gscPosition: rec.gscSignal?.position90d,
        });
        // Status is keyed off the question row's lifecycle (the
        // primary side of the pair). The validator-pairing guarantee
        // means both rows ship together, so any divergence between
        // the two is an operator-fixable persistence drift, not a
        // model defect.
        const status = statusForRow({
          responseStatus,
          editLifecycleStatus:
            question.implementation_status ?? "recommended",
          needsHumanReview,
          hasNoEdits: false,
          hasOnlyDismissedEdits: false,
        });
        const evidenceSummary = composeRowEvidenceSummary({
          rec,
          action,
          hasResolvedTarget: resolvedUrl !== null,
          resolvedUrl,
          targetLabel: editTargetLabel,
          topicTag,
          geoTag,
          override: structuralOverrideForEdit(question, editTargetLabel),
        });
        // Union evidence refs + risks from both rows so the drawer
        // shows the full audit trail; first-seen wins on duplicate
        // refs.
        const evidenceRefsSeen = new Set<string>();
        const evidenceRefs: SpecificEditEvidenceRef[] = [];
        for (const ref of [...question.evidence, ...answer.evidence]) {
          const key = JSON.stringify(ref);
          if (evidenceRefsSeen.has(key)) continue;
          evidenceRefsSeen.add(key);
          evidenceRefs.push(ref);
        }
        const risks = [
          ...(question.risks ?? []),
          ...(answer.risks ?? []),
        ].filter((r, i, a) => a.indexOf(r) === i); // de-dupe
        // T4.4 — derived confidence for the FAQ-pair row.
        const faqPairEvidenceDepth = computeEvidenceDepth(evidenceRefs);
        const faqPairDerivedConfidence = deriveConfidence({
          evidenceRefs,
          evidenceDepth: faqPairEvidenceDepth,
          affectedPromptCount: rec.evidence.promptCount,
          isFaqAnswer: false,
          hasTopCompetitor: topCompetitor !== null,
          // Pivot 2026-06-13: first-party Google Search demand floors
          // the confidence label (never "Needs more evidence" when the
          // page is provably trafficked).
          gscImpressions: rec.gscSignal?.impressions90d,
        });
        rows.push({
          id: `${rec.stableKey}::faq-pair::${hash}`,
          rank: 0, // assigned after sort
          title,
          targetLabel: editTargetLabel,
          targetUrl: editAnchorUrl ?? resolvedUrl,
          actionType: "add_faq",
          priority,
          status,
          evidenceSummary,
          sourceRecommendationId: rec.stableKey,
          // Primary edit id is the QUESTION's — the rec-level accept
          // / dismiss / ship dispatch is keyed by stableKey anyway,
          // but tests + drawers that index by editId resolve to the
          // question row.
          sourceEditId: question.id,
          // Round 1 (2026-05-05) — surface edit provider + engine
          // confidence on the row. The FAQ pair groups question +
          // answer; we report the question's source (canonical
          // primary) but they should match for any sane bundle.
          editSource: question.source ?? null,
          engineConfidence: rec.engineConfidence?.confidence ?? null,
          // T4.4 — derived confidence for the FAQ-pair row.
          derivedConfidence: faqPairDerivedConfidence,
          hasExactEdit: true,
          responseStatus,
          acceptedAgeDays,
          deferUntil: response?.deferUntil ?? null,
          eligibleEditCount,
          detail: {
            currentText: null, // FAQ pairs are additive
            proposedText: question.proposed_text, // question text
            faqAnswerText: answer.proposed_text, // W3 §3.15
            editActionType: question.action_type, // #310 — always add_faq here
            why: question.why ?? answer.why ?? resolution?.reasoning ?? null,
            measurementPlan:
              question.measurement_plan ?? answer.measurement_plan,
            evidenceRefs,
            fullReasoning: resolution?.reasoning ?? null,
            confidenceReason: resolution?.confidenceReason ?? null,
            motiveLabel,
            pageBrief: resolution?.pageBrief ?? null,
            suggestedEdits: resolution?.suggestedEdits ?? [],
            risks,
            cannibalization: resolution?.cannibalization ?? null,
            topCompetitor,
            affectedPromptCount: rec.evidence.promptCount,
            observationCount: rec.evidence.observationCount,
            gscEvidenceLines,
            semrushEvidenceLines,
            // T4.2 — evidence depth + prioritizer threading.
            evidenceDepth: faqPairEvidenceDepth,
            // T4.4 — customer-safe derived confidence label (hoisted above).
            derivedConfidence: faqPairDerivedConfidence,
            debug: {
              recommendationId: rec.stableKey,
              editId: question.id,
              pairedAnswerEditId: answer.id,
              resolverTier: resolution?.tier ?? null,
              resolutionAction: resolution?.action ?? null,
              motive: resolution?.motive ?? null,
              engineConfidence: rec.engineConfidence,
              evidenceHash: question.evidence_hash ?? answer.evidence_hash ?? null,
              editLifecycleStatus: question.implementation_status ?? null,
              prioritizerTier: rec.tier ?? null,
              prioritizerScore: typeof rec.score === "number" ? rec.score : null,
            },
          },
        });
      }

      // ── Path A.2: one row per non-FAQ edit (existing behavior). ──
      for (const edit of nonFaqEdits) {
        const rowType = actionRowTypeForEdit(edit.action_type);
        // Prefer the edit's anchor URL over the rec's resolution
        // when both exist — edits often anchor more specifically than
        // the rec's resolved page (e.g. an H2 edit on
        // /services/whole-home-remodel even when the cluster maps to
        // a generic "needs new page" outcome). Fall back to the rec's
        // resolved URL when the edit has none.
        const editAnchorUrl =
          typeof edit.target_url === "string" &&
          edit.target_url.length > 0 &&
          edit.target_url !== NEEDS_NEW_PAGE
            ? edit.target_url
            : null;
        const editTargetLabel = editAnchorUrl
          ? targetLabelForUrl(editAnchorUrl)
          : targetLabel;
        const title = composeEditRowTitle({
          edit,
          targetLabel: editTargetLabel,
          topicTag,
        });
        const priority = priorityForRow({
          engineConfidence: rec.engineConfidence.confidence,
          severity: rec.severity,
          affectedPromptCount: rec.evidence.promptCount,
          observationCount: rec.evidence.observationCount,
          brandPrimaryShare,
          needsHumanReview,
          hasExactEdit: true,
          gscImpressions: rec.gscSignal?.impressions90d,
          gscPosition: rec.gscSignal?.position90d,
        });
        const status = statusForRow({
          responseStatus,
          editLifecycleStatus: edit.implementation_status ?? "recommended",
          needsHumanReview,
          hasNoEdits: false,
          hasOnlyDismissedEdits: false,
        });
        const evidenceSummary = composeRowEvidenceSummary({
          rec,
          action,
          hasResolvedTarget: resolvedUrl !== null,
          resolvedUrl,
          targetLabel: editTargetLabel,
          topicTag,
          geoTag,
          override: structuralOverrideForEdit(edit, editTargetLabel),
        });
        // T4.4 — derived confidence for the non-FAQ edit row.
        const editEvidenceDepth = computeEvidenceDepth(edit.evidence ?? []);
        const editDerivedConfidence = deriveConfidence({
          evidenceRefs: edit.evidence ?? [],
          evidenceDepth: editEvidenceDepth,
          affectedPromptCount: rec.evidence.promptCount,
          isFaqAnswer:
            typeof edit.target_element_key === "string" &&
            /^faq_answer\[/.test(edit.target_element_key),
          hasTopCompetitor: topCompetitor !== null,
          // Pivot 2026-06-13: first-party Google Search demand floors
          // the confidence label (never "Needs more evidence" when the
          // page is provably trafficked).
          gscImpressions: rec.gscSignal?.impressions90d,
        });
        rows.push({
          id: `${rec.stableKey}::${edit.id}`,
          rank: 0, // assigned after sort
          title,
          targetLabel: editTargetLabel,
          targetUrl: editAnchorUrl ?? resolvedUrl,
          actionType: rowType,
          priority,
          status,
          evidenceSummary,
          sourceRecommendationId: rec.stableKey,
          sourceEditId: edit.id,
          // Round 1 (2026-05-05) — see FAQ-pair path above.
          editSource: edit.source ?? null,
          engineConfidence: rec.engineConfidence?.confidence ?? null,
          // T4.4 — derived confidence (hoisted above).
          derivedConfidence: editDerivedConfidence,
          hasExactEdit: true,
          responseStatus,
          acceptedAgeDays,
          deferUntil: response?.deferUntil ?? null,
          eligibleEditCount,
          detail: {
            currentText: edit.current_text,
            proposedText: edit.proposed_text,
            faqAnswerText: null,
            editActionType: edit.action_type, // #310 — indexing-safety caveat key
            why: edit.why ?? resolution?.reasoning ?? null,
            measurementPlan: edit.measurement_plan,
            evidenceRefs: edit.evidence,
            fullReasoning: resolution?.reasoning ?? null,
            confidenceReason: resolution?.confidenceReason ?? null,
            motiveLabel,
            pageBrief: resolution?.pageBrief ?? null,
            suggestedEdits: resolution?.suggestedEdits ?? [],
            risks: edit.risks ?? [],
            cannibalization: resolution?.cannibalization ?? null,
            topCompetitor,
            affectedPromptCount: rec.evidence.promptCount,
            observationCount: rec.evidence.observationCount,
            gscEvidenceLines,
            semrushEvidenceLines,
            // T4.2 — evidence depth + prioritizer threading.
            evidenceDepth: editEvidenceDepth,
            // T4.4 — customer-safe derived confidence label (hoisted above).
            derivedConfidence: editDerivedConfidence,
            debug: {
              recommendationId: rec.stableKey,
              editId: edit.id,
              pairedAnswerEditId: null,
              resolverTier: resolution?.tier ?? null,
              resolutionAction: resolution?.action ?? null,
              motive: resolution?.motive ?? null,
              engineConfidence: rec.engineConfidence,
              evidenceHash: edit.evidence_hash ?? null,
              editLifecycleStatus: edit.implementation_status ?? null,
              prioritizerTier: rec.tier ?? null,
              prioritizerScore: typeof rec.score === "number" ? rec.score : null,
            },
          },
        });
      }

      // If we emitted ANY row from this rec (paired or non-FAQ), skip
      // the meta-path. Orphan FAQ rows alone don't qualify — but the
      // rec falls through to meta-path detection only when there were
      // genuinely no shippable edits to surface, not just FAQ orphans
      // (which is a persistence drift the validator already prevents).
      if (faqPairs.length > 0 || nonFaqEdits.length > 0) {
        continue;
      }
    }

    // ── Path B: meta-action rows (no renderable edits). ──
    // Determine whether this rec is worth surfacing as a single
    // operator-decision row. Otherwise skip.
    let metaKind:
      | "create_page"
      | "review_decision"
      | "regenerate_edit"
      | null = null;

    if (action === "create_new_page" && !resolvedUrl) {
      metaKind = "create_page";
    } else if (
      action === "split_or_separate_page" ||
      action === "merge_or_dedupe" ||
      action === "needs_review" ||
      (resolution?.needsHumanReview ?? false)
    ) {
      metaKind = "review_decision";
    } else if (hasOnlyDismissedEdits) {
      metaKind = "regenerate_edit";
    } else if (action === "watch") {
      // Watch-only recs aren't actions; suppress.
      metaKind = null;
    } else {
      // No renderable edits, no manual task → suppress.
      metaKind = null;
    }
    if (!metaKind) continue;

    const title = composeMetaRowTitle({
      action,
      clusterLabel: rec.clusterLabel,
      affectedPromptTexts,
      resolution,
      metaKind,
      targetLabel,
      knownCities: args.knownCities,
      knownServices: args.knownServices,
    });
    const rowType: ActionRowType =
      metaKind === "create_page"
        ? "create_page"
        : metaKind === "review_decision"
          ? "review_decision"
          : "regenerate_edit";
    const priority = priorityForRow({
      engineConfidence: rec.engineConfidence.confidence,
      severity: rec.severity,
      affectedPromptCount: rec.evidence.promptCount,
      observationCount: rec.evidence.observationCount,
      brandPrimaryShare,
      needsHumanReview,
      hasExactEdit: false,
      gscImpressions: rec.gscSignal?.impressions90d,
      gscPosition: rec.gscSignal?.position90d,
    });
    const status = statusForRow({
      responseStatus,
      editLifecycleStatus: null,
      needsHumanReview,
      hasNoEdits: allEdits.length === 0,
      hasOnlyDismissedEdits,
    });
    const evidenceSummary = composeRowEvidenceSummary({
      rec,
      action,
      hasResolvedTarget: resolvedUrl !== null,
      resolvedUrl,
      targetLabel,
      topicTag,
      geoTag,
      override: null,
    });
    // T4.4 — derived confidence for meta-action rows. They have no
    // edit-level evidence; lean on rec-level promptCount + topCompetitor.
    const metaDerivedConfidence = deriveConfidence({
      evidenceRefs: [],
      evidenceDepth: 0,
      affectedPromptCount: rec.evidence.promptCount,
      isFaqAnswer: false,
      hasTopCompetitor: topCompetitor !== null,
      // Pivot 2026-06-13: first-party Google Search demand floors the
      // confidence label for meta-action rows too.
      gscImpressions: rec.gscSignal?.impressions90d,
    });
    rows.push({
      id: `${rec.stableKey}::${metaKind}`,
      rank: 0,
      title,
      targetLabel,
      targetUrl: resolvedUrl,
      actionType: rowType,
      priority,
      status,
      evidenceSummary,
      sourceRecommendationId: rec.stableKey,
      sourceEditId: null,
      // Round 1 (2026-05-05) — meta-action rows have no anchoring
      // specific edit, so no provider attribution. The engine
      // confidence still carries (it's a rec-level property).
      editSource: null,
      engineConfidence: rec.engineConfidence?.confidence ?? null,
      // T4.4 — derived confidence for meta-action rows.
      derivedConfidence: metaDerivedConfidence,
      hasExactEdit: false,
      responseStatus,
      acceptedAgeDays,
      deferUntil: response?.deferUntil ?? null,
      eligibleEditCount,
      detail: {
        currentText: null,
        proposedText: null,
        faqAnswerText: null,
        // #310 — meta-action rows have no source edit (and no exact
        // copy), so no indexing-safety caveat applies.
        editActionType: null,
        why:
          metaKind === "regenerate_edit"
            ? "Beacon's prior edits were dismissed. Run the generator again to produce fresh copy you can ship."
            : metaKind === "review_decision"
              ? composeRecommendedMove({
                  action,
                  topic: extractTopicTag(rec.clusterLabel ?? "", args.knownServices),
                  pageName:
                    resolvedUrl !== null
                      ? pageNameFromUrl(resolvedUrl)
                      : null,
                  resolution,
                })
              : composeRecommendedMove({
                  action,
                  topic: extractTopicTag(rec.clusterLabel ?? "", args.knownServices),
                  pageName: null,
                  resolution,
                }),
        measurementPlan: null,
        evidenceRefs: [],
        fullReasoning: resolution?.reasoning ?? null,
        confidenceReason: resolution?.confidenceReason ?? null,
        motiveLabel,
        pageBrief: resolution?.pageBrief ?? null,
        suggestedEdits: resolution?.suggestedEdits ?? [],
        risks: resolution?.risks ?? [],
        cannibalization: resolution?.cannibalization ?? null,
        topCompetitor,
        affectedPromptCount: rec.evidence.promptCount,
        observationCount: rec.evidence.observationCount,
        gscEvidenceLines,
        semrushEvidenceLines,
        // T4.2 — meta rows have no edit-level evidence; depth = 0.
        evidenceDepth: 0,
        // T4.4 — meta-row derived confidence (hoisted above).
        derivedConfidence: metaDerivedConfidence,
        debug: {
          recommendationId: rec.stableKey,
          editId: null,
          pairedAnswerEditId: null,
          resolverTier: resolution?.tier ?? null,
          resolutionAction: resolution?.action ?? null,
          motive: resolution?.motive ?? null,
          engineConfidence: rec.engineConfidence,
          evidenceHash: null,
          editLifecycleStatus: null,
          prioritizerTier: rec.tier ?? null,
          prioritizerScore: typeof rec.score === "number" ? rec.score : null,
        },
      },
    });
  }

  // ── Rank assignment. Operator-locked sort (W3 §3.5f, T4.2 §4.2):
  //     1. STATUS BUCKET (open work above tracking; tracking above
  //        archived). Operator scope: tracking rows must NOT outrank
  //        open work by default — without this, a queue of accepted
  //        recs pushes new opportunities below the fold.
  //          new / needs_review / needs_fresh_edit  (bucket 0)
  //          accepted                                (bucket 1)
  //          measuring                               (bucket 2)
  //          shipped                                 (bucket 3)
  //          deferred / dismissed                    (bucket 4)
  //     2. PRIORITIZER TIER (T4.2): the prioritize.ts queue tier
  //        ("now" → "this_week" → "later"). Pre-T4.2 the customer-
  //        facing table discarded this — the prioritizer's signals
  //        (severity + cluster size + competitor pressure − effort)
  //        drove a queue position that was then re-shuffled by a
  //        priorityForRow rubric. Now the tier sets the BAND inside
  //        each status bucket; priorityForRow refines within band.
  //     3. PRIORITY DESC (high → medium → low) within bucket+tier
  //     4. EVIDENCE DEPTH DESC (T4.2): rows with more grounding
  //        signals (multi-prompt, owned page, competitor angle, etc.)
  //        outrank thin single-prompt rows that share the same
  //        priority. This closes the "thin FAQ answer outranks
  //        multi-prompt H2" failure mode.
  //     5. observation count DESC (richer evidence first)
  //     6. id ASC (deterministic tie-break)
  const PRIORITY_RANK: Record<ActionRowPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  const STATUS_BUCKET: Record<ActionRowStatus, number> = {
    new: 0,
    needs_review: 0,
    needs_fresh_edit: 0,
    accepted: 1,
    measuring: 2,
    shipped: 3,
    deferred: 4,
    dismissed: 4,
  };
  const PRIORITIZER_TIER_RANK: Record<"now" | "this_week" | "later", number> = {
    now: 0,
    this_week: 1,
    later: 2,
  };
  rows.sort((a, b) => {
    const sb = STATUS_BUCKET[a.status] - STATUS_BUCKET[b.status];
    if (sb !== 0) return sb;
    // T4.2: prioritizer tier band before priorityForRow refinement.
    const aTier = a.detail.debug.prioritizerTier;
    const bTier = b.detail.debug.prioritizerTier;
    const aTierRank = aTier ? PRIORITIZER_TIER_RANK[aTier] : 99;
    const bTierRank = bTier ? PRIORITIZER_TIER_RANK[bTier] : 99;
    if (aTierRank !== bTierRank) return aTierRank - bTierRank;
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    // T4.2: evidence depth — richer grounding wins ties.
    const ed = b.detail.evidenceDepth - a.detail.evidenceDepth;
    if (ed !== 0) return ed;
    const obs = b.detail.observationCount - a.detail.observationCount;
    if (obs !== 0) return obs;
    return a.id.localeCompare(b.id);
  });
  rows.forEach((r, i) => {
    rows[i] = { ...r, rank: i + 1 };
  });
  return rows;
}

// ── Helpers ────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trim()}…`;
}

/**
 * Re-export `titleCase` for downstream consumers that want consistent
 * page-name styling (e.g., custom target-label formatting in the
 * client). Keeps callers from importing the private `_text-utils`
 * directly.
 */
export { titleCase };
