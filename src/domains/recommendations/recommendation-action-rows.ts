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
import {
  composeEvidencePreview,
  composeRecommendedMove,
} from "./recommendation-evidence-preview";
import {
  extractTopicTag,
  humanizeRecTitle,
  pageNameFromUrl,
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
  | "edit_h2"
  | "edit_title"
  | "edit_meta"
  | "add_schema"
  | "add_faq"
  | "add_section"
  | "improve_copy"
  | "add_internal_links"
  | "technical_fix"
  | "review_decision"
  | "regenerate_edit";

/** Operator-readable label for a row's Type column. */
export const ACTION_ROW_TYPE_LABEL: Record<ActionRowType, string> = {
  create_page: "Create page",
  edit_h2: "H2",
  edit_title: "Title",
  edit_meta: "Meta",
  add_schema: "Schema",
  add_faq: "FAQ",
  add_section: "Section",
  improve_copy: "Copy",
  add_internal_links: "Links",
  technical_fix: "Technical",
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
  needs_fresh_edit: "Needs fresh edit",
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
  /** Diagnostic block — internal taxonomy + IDs. Collapsed by default. */
  readonly debug: {
    readonly recommendationId: string;
    readonly editId: string | null;
    readonly resolverTier: ResolverTier | null;
    readonly resolutionAction: RecommendationAction | null;
    readonly motive: RecommendationMotive | null;
    readonly engineConfidence: RecConfidenceVerdict;
    readonly evidenceHash: string | null;
    readonly editLifecycleStatus: ImplementationStatus | null;
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
    case "add_comparison_section":
    case "add_answer_block":
      return "add_section";
    case "add_table":
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
 * Compose a per-row title for a specific edit. Operator scope: must
 * read as a concrete task ("Add an architect-led design-build H2 to
 * the Whole Home Remodel page" / "Rewrite the Luxury Home Builder
 * meta description"), never as a cluster description.
 *
 * Priority:
 *   1. Edit's `display_label` if the persistence layer carries one
 *      (the LLM provider emits operator-facing labels). Combined with
 *      a verb prefix per action type so the row reads as a verb, not
 *      a fragment.
 *   2. Action-aware fallback ("Add an H2 to the {page} page",
 *      "Rewrite the {page} meta description", etc.).
 */
export function composeEditRowTitle(args: {
  readonly edit: RecommendedEditRow;
  readonly targetLabel: string;
  readonly topicTag: string | null;
}): string {
  const label = (args.edit.display_label ?? "").trim();
  const targetLabel = args.targetLabel;
  const at = args.edit.action_type;

  // Action-specific verb composition.
  switch (at) {
    case "edit_title":
      return label
        ? `Rewrite the ${targetLabel} title to "${truncate(label, 60)}"`
        : `Rewrite the ${targetLabel} title`;
    case "edit_meta":
      return label
        ? `Rewrite the ${targetLabel} meta description: "${truncate(label, 60)}"`
        : `Rewrite the ${targetLabel} meta description`;
    case "change_h1":
      return label
        ? `Change the H1 on the ${targetLabel} to "${truncate(label, 60)}"`
        : `Change the H1 on the ${targetLabel}`;
    case "add_h2_section":
      return label
        ? `Add an H2 "${truncate(label, 60)}" to the ${targetLabel}`
        : `Add a new H2 section to the ${targetLabel}`;
    case "rewrite_h2":
      return label
        ? `Rewrite the H2 "${truncate(label, 60)}" on the ${targetLabel}`
        : `Rewrite an H2 on the ${targetLabel}`;
    case "add_faq":
      return label
        ? `Add an FAQ "${truncate(label, 60)}" to the ${targetLabel}`
        : `Add an FAQ entry to the ${targetLabel}`;
    case "rewrite_faq":
      return label
        ? `Rewrite the FAQ "${truncate(label, 60)}" on the ${targetLabel}`
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
        ? `Add an answer block "${truncate(label, 60)}" to the ${targetLabel}`
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
      return `Split the ${targetLabel} into a dedicated page`;
    case "merge_pages":
      return `Merge overlapping pages into the ${targetLabel}`;
    case "watch":
      return `Watch the ${targetLabel} cluster`;
  }
}

/**
 * For meta-action rows (create_page / review_decision / regenerate)
 * we don't have a specific edit to lean on. Compose from rec
 * resolution + topic tag.
 */
export function composeMetaRowTitle(args: {
  readonly action: RecommendationAction;
  readonly clusterLabel: string | null;
  readonly resolution: PageIntentResolution | null;
  readonly metaKind: "create_page" | "review_decision" | "regenerate_edit";
  readonly targetLabel: string;
}): string {
  if (args.metaKind === "create_page") {
    // Reuse the title humanizer's create-page path so the operator
    // sees "Create an Atherton older-home rebuild page" instead of
    // a generic "Create a page" entry.
    return humanizeRecTitle({
      clusterLabel: args.clusterLabel,
      resolution: args.resolution,
    });
  }
  if (args.metaKind === "review_decision") {
    if (args.action === "split_or_separate_page") {
      const topic = extractTopicTag(args.clusterLabel ?? "");
      return topic
        ? `Choose whether to split the ${args.targetLabel} into a dedicated ${topic} page`
        : `Choose whether to split the ${args.targetLabel}`;
    }
    if (args.action === "merge_or_dedupe") {
      return `Choose whether to merge overlapping pages into the ${args.targetLabel}`;
    }
    if (args.action === "needs_review") {
      const topic = extractTopicTag(args.clusterLabel ?? "");
      return topic
        ? `Pick a direction for the ${topic} opportunity`
        : `Pick a direction for this opportunity`;
    }
    return `Review this recommendation`;
  }
  // regenerate_edit
  const topic = extractTopicTag(args.clusterLabel ?? "");
  return topic
    ? `Regenerate edits for the ${topic} recommendation`
    : `Regenerate edits for this recommendation`;
}

/**
 * Map per-row priority. Operator scope: "High = high business
 * priority," not raw confidence. We blend three signals:
 *   - engine confidence (high/medium/low)
 *   - severity (high/medium/low) from the prioritizer
 *   - prompt count (single-prompt → cap at low)
 */
export function priorityForRow(args: {
  readonly engineConfidence: "high" | "medium" | "low";
  readonly severity: "high" | "medium" | "low";
  readonly affectedPromptCount: number;
}): ActionRowPriority {
  if (args.affectedPromptCount <= 1) return "low";
  if (args.engineConfidence === "high" && args.severity !== "low") return "high";
  if (args.engineConfidence === "low") return "low";
  if (args.severity === "high") return "high";
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
 * Compose a one-line evidence summary for a row. Operator scope: NO
 * paragraphs, NO debug, NO "site inventory shows…", NO "label tokens".
 *
 * Strategy:
 *   - Defer to `composeEvidencePreview` (which already produces a
 *     single sentence with generic-competitor filtering).
 *   - For meta-rows (regenerate / review_decision), compose a
 *     specific compact summary instead.
 *   - For technical-fix / schema / FAQ rows we sometimes have
 *     structural facts (schema missing, FAQ missing) that are
 *     stronger than the rec-level evidence — the caller can pass an
 *     override.
 */
export function composeRowEvidenceSummary(args: {
  readonly rec: LiveRecQueueItem;
  readonly action: RecommendationAction;
  readonly hasResolvedTarget: boolean;
  readonly resolvedUrl: string | null;
  /** Optional structural override (e.g., "Schema missing"). When
   *  present, takes precedence over the share-based summary. */
  readonly override?: string | null;
}): string {
  if (args.override && args.override.trim().length > 0) {
    return args.override.trim();
  }
  const ev = args.rec.evidence;
  const sharePct =
    ev.brandPrimaryPromptCount > 0 && ev.promptCount > 0
      ? ev.brandPrimaryPromptCount / ev.promptCount
      : null;
  return composeEvidencePreview({
    affectedPromptCount: ev.promptCount,
    observationCount: ev.observationCount,
    brandPrimaryShare: sharePct,
    primaryCompetitors: ev.primaryCompetitors,
    resolvedAction: args.action,
    resolvedTargetUrl: args.resolvedUrl,
    hasResolvedTarget: args.hasResolvedTarget,
  });
}

/**
 * Pick a structural override for an edit that has a specific
 * operator-readable evidence bullet (e.g., schema rows say
 * "Schema missing" instead of share %). Falls back to null when
 * no specific structural fact applies.
 */
function structuralOverrideForEdit(
  edit: RecommendedEditRow,
): string | null {
  switch (edit.action_type) {
    case "add_schema":
      return "Schema missing";
    case "fix_schema":
      return "Schema needs fixing";
    case "add_faq":
      return "FAQ missing";
    case "rewrite_faq":
      return "FAQ weak";
    case "edit_meta":
      return "Meta description weak";
    case "edit_title":
      return "Title underperforming";
    case "add_internal_link":
      return "Internal links missing";
    case "reorder_sections":
      return "Section order suboptimal";
    default:
      return null;
  }
}

// ── Top-level builder ──────────────────────────────────────────────────

/** Minimal MOTIVE_LABEL map (mirrors the client constant). Kept here
 *  so the row builder is self-contained for tests. */
const MOTIVE_LABEL: Record<RecommendationMotive, string> = {
  counter_competitor: "A competitor is currently winning this answer.",
  capture_absent_cluster: "AI is not citing Ritz for this topic yet.",
  improve_close_prompt: "Ritz is close, but the page needs more coverage.",
  defend_winning_cluster:
    "Ritz is currently the primary answer — keep it that way.",
  resolve_cannibalization:
    "Multiple Ritz pages compete for the same answer.",
  improve_citation_depth:
    "Ritz is cited but ranks low — strengthen the page.",
};

export type BuildActionRowsArgs = {
  /** The full prioritized queue + per-rec response + per-rec edits. */
  readonly queue: ReadonlyArray<{
    readonly rec: LiveRecQueueItem;
    readonly response: RecommendationResponse | null;
    readonly edits: ReadonlyArray<RecommendedEditRow>;
  }>;
  /** Optional now-clock for stale-pending math. Defaults to
   *  Date.now(). */
  readonly now?: Date;
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
    const topicTag = extractTopicTag(rec.clusterLabel ?? rec.title ?? "");

    const motiveLabel = resolution?.motive
      ? MOTIVE_LABEL[resolution.motive] ?? null
      : null;

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

    // ── Path A: renderable specific edits → one row per edit. ──
    if (renderable.length > 0) {
      for (const edit of renderable) {
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
        });
        const status = statusForRow({
          responseStatus,
          editLifecycleStatus: edit.implementation_status ?? "recommended",
          needsHumanReview: resolution?.needsHumanReview ?? false,
          hasNoEdits: false,
          hasOnlyDismissedEdits: false,
        });
        const evidenceSummary = composeRowEvidenceSummary({
          rec,
          action,
          hasResolvedTarget: resolvedUrl !== null,
          resolvedUrl,
          override: structuralOverrideForEdit(edit),
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
          hasExactEdit: true,
          responseStatus,
          acceptedAgeDays,
          deferUntil: response?.deferUntil ?? null,
          eligibleEditCount,
          detail: {
            currentText: edit.current_text,
            proposedText: edit.proposed_text,
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
            debug: {
              recommendationId: rec.stableKey,
              editId: edit.id,
              resolverTier: resolution?.tier ?? null,
              resolutionAction: resolution?.action ?? null,
              motive: resolution?.motive ?? null,
              engineConfidence: rec.engineConfidence,
              evidenceHash: edit.evidence_hash ?? null,
              editLifecycleStatus: edit.implementation_status ?? null,
            },
          },
        });
      }
      continue;
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
      resolution,
      metaKind,
      targetLabel,
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
    });
    const status = statusForRow({
      responseStatus,
      editLifecycleStatus: null,
      needsHumanReview: resolution?.needsHumanReview ?? false,
      hasNoEdits: allEdits.length === 0,
      hasOnlyDismissedEdits,
    });
    const evidenceSummary = composeRowEvidenceSummary({
      rec,
      action,
      hasResolvedTarget: resolvedUrl !== null,
      resolvedUrl,
      override: null,
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
      hasExactEdit: false,
      responseStatus,
      acceptedAgeDays,
      deferUntil: response?.deferUntil ?? null,
      eligibleEditCount,
      detail: {
        currentText: null,
        proposedText: null,
        why:
          metaKind === "regenerate_edit"
            ? "Beacon's prior edits were dismissed. Run the generator again to produce fresh copy you can ship."
            : metaKind === "review_decision"
              ? composeRecommendedMove({
                  action,
                  topic: extractTopicTag(rec.clusterLabel ?? ""),
                  pageName:
                    resolvedUrl !== null
                      ? pageNameFromUrl(resolvedUrl)
                      : null,
                  resolution,
                })
              : composeRecommendedMove({
                  action,
                  topic: extractTopicTag(rec.clusterLabel ?? ""),
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
        debug: {
          recommendationId: rec.stableKey,
          editId: null,
          resolverTier: resolution?.tier ?? null,
          resolutionAction: resolution?.action ?? null,
          motive: resolution?.motive ?? null,
          engineConfidence: rec.engineConfidence,
          evidenceHash: null,
          editLifecycleStatus: null,
        },
      },
    });
  }

  // ── Rank assignment. Operator-locked sort:
  //     1. priority DESC (high → medium → low)
  //     2. accept-and-track candidacy first (responseStatus === null)
  //     3. observation count DESC (richer evidence first)
  //     4. id ASC (deterministic tie-break)
  const PRIORITY_RANK: Record<ActionRowPriority, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  rows.sort((a, b) => {
    const p = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (p !== 0) return p;
    const aOpen = a.responseStatus === null ? 0 : 1;
    const bOpen = b.responseStatus === null ? 0 : 1;
    if (aOpen !== bOpen) return aOpen - bOpen;
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
