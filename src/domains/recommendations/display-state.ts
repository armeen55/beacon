/**
 * W3 Step 3.5c (2026-05-02) — recommendation display-state classifier.
 *
 * Operator-facing /recommendations page is a DECISION QUEUE, not a
 * data dump. Each rec lands in exactly one display state that
 * controls:
 *   - whether it renders at all
 *   - whether it can sit in the NOW tier
 *   - which action surface it shows (Accept/Defer/Dismiss vs.
 *     Tracking + Mark-shipped vs. nothing)
 *   - copy emphasis ("Recommended move" vs. "Needs fresh edit" etc.)
 *
 * Operator-locked states (W3 §3.5c.A):
 *   actionable_edit   — has at least one usable specific edit. Default
 *                       Accept/Defer/Dismiss surface. Can sit in NOW.
 *   manual_review     — operator must choose direction (split / pick
 *                       page / etc.). No fake edit emitted yet.
 *                       Render with Defer/Dismiss only.
 *   needs_fresh_edit  — opportunity exists but every edit was
 *                       dismissed/invalid. CANNOT appear in NOW —
 *                       force-downgrade to this_week.
 *   accepted_tracking — already accepted; rec is being watched. NOT
 *                       a normal action card. Render with Mark
 *                       shipped + Undo only; no Accept/Defer/Dismiss.
 *   backlog           — lower-priority rec. May render in this_week
 *                       or later but never in NOW.
 *   suppressed        — never renders in the main queue (dismissed,
 *                       deferred-not-yet-due, etc.). Visible only
 *                       behind the "show all" toggle.
 *
 * Pure / deterministic. No I/O, no React. Tests drive against
 * synthetic inputs.
 */

import type { ImplementationStatus } from "./recommended-edits-persistence";
import type { RecommendationAction } from "./resolved-types";

export type RecDisplayState =
  | "actionable_edit"
  | "manual_review"
  | "needs_fresh_edit"
  | "accepted_tracking"
  | "backlog"
  | "suppressed";

export type RecResponseStatus = "accepted" | "dismissed" | "deferred";

/**
 * Minimal edit shape the classifier reads. Mirrors the subset of
 * `RecommendedEditRow` that drives display state. Pre-W3 rows
 * without `implementation_status` are treated as `recommended`.
 */
export type ClassifierEdit = {
  readonly implementation_status?: ImplementationStatus;
};

/**
 * Minimal response shape. The `respondedAt` + `deferUntil` fields
 * are only consulted for `deferred` state (whether the defer window
 * has expired).
 */
export type ClassifierResponse = {
  readonly status: RecResponseStatus;
  readonly deferUntil?: string | null;
};

export type ClassifyRecDisplayStateArgs = {
  /** Resolved action — drives manual-review classification when no
   *  edits are present. Optional (legacy callers) — when missing,
   *  the classifier never returns `manual_review`. */
  readonly resolvedAction?: RecommendationAction | null;
  /** Did the resolver flag the rec for human review? */
  readonly needsHumanReview?: boolean;
  /** Operator response state. `null` = no decision recorded. */
  readonly response: ClassifierResponse | null;
  /** ALL recommended_edits linked to this rec (including dismissed). */
  readonly allEdits: ReadonlyArray<ClassifierEdit>;
  /** Filtered edits that are renderable (excludes dismissed +
   *  not_found_after_7d — same filter the rec card UI applies). */
  readonly renderableEdits: ReadonlyArray<ClassifierEdit>;
  /** Optional `now` for the deferred-window check. Defaults to
   *  `new Date()`. */
  readonly now?: Date;
};

/**
 * Action types that ALWAYS require operator judgment (no
 * deterministic-edit path). When a rec resolves to one of these AND
 * has zero edits, it lands in `manual_review` so the UI shows the
 * Defer/Dismiss surface instead of an empty Accept button.
 */
const MANUAL_REVIEW_ACTIONS: ReadonlySet<RecommendationAction> = new Set([
  "split_or_separate_page",
  "needs_review",
  "merge_or_dedupe",
]);

export function classifyRecDisplayState(
  args: ClassifyRecDisplayStateArgs,
): RecDisplayState {
  const now = (args.now ?? new Date()).getTime();

  // 1. Suppression rules — operator already decided.
  if (args.response) {
    if (args.response.status === "dismissed") return "suppressed";
    if (args.response.status === "deferred") {
      // Deferred-not-yet-due → suppressed. Due-or-past → re-emerge as
      // a normal rec (fall through to the unclassified-response
      // branches below).
      const deferUntil = args.response.deferUntil
        ? new Date(args.response.deferUntil).getTime()
        : null;
      if (deferUntil != null && deferUntil > now) return "suppressed";
      // else: defer window has expired — treat like no response
    }
    if (args.response.status === "accepted") return "accepted_tracking";
  }

  // 2. needsHumanReview — operator-flagged ambiguity. Always a
  //    manual_review card regardless of edit count.
  if (args.needsHumanReview) return "manual_review";

  // 3. Edit-driven classification.
  if (args.renderableEdits.length > 0) return "actionable_edit";

  // No renderable edits left.
  if (args.allEdits.length > 0) {
    // Had edits, all filtered. Operator should regenerate or
    // dismiss; not a top-priority "do this" card.
    return "needs_fresh_edit";
  }

  // No edits at all. Manual-review action types open the operator-
  // judgment surface; everything else lands in backlog.
  if (
    args.resolvedAction &&
    MANUAL_REVIEW_ACTIONS.has(args.resolvedAction)
  ) {
    return "manual_review";
  }
  return "backlog";
}

/**
 * Operator-facing label for a display state. Used by debug surfaces
 * (data-attributes, tooltips). NOT the primary card copy — each
 * state drives a different card layout in the UI.
 */
export const REC_DISPLAY_STATE_LABEL: Record<RecDisplayState, string> = {
  actionable_edit: "Ready to ship",
  manual_review: "Needs your judgment",
  needs_fresh_edit: "Needs fresh edit",
  accepted_tracking: "Tracking",
  backlog: "Backlog",
  suppressed: "Hidden",
};

/**
 * Tier downgrade rule — `needs_fresh_edit` cannot appear in NOW
 * (operator-locked W3 §3.5c.A). When the prioritizer assigned a
 * rec to NOW but the display state says otherwise, callers route
 * it to this_week instead.
 *
 * Returns the effective tier the UI should render the rec under.
 */
export function effectiveTierForDisplay(args: {
  readonly originalTier: "now" | "this_week" | "later";
  readonly displayState: RecDisplayState;
}): "now" | "this_week" | "later" {
  if (
    args.displayState === "needs_fresh_edit" &&
    args.originalTier === "now"
  ) {
    return "this_week";
  }
  return args.originalTier;
}

// ---------------------------------------------------------------------------
// W3 Step 3.5d (2026-05-02) — Lane model.
//
// Operator browser audit (2026-05-02 third pass) failed Step 3.5c
// product acceptance. The page was still rendered as
// "NOW · 5 / THIS WEEK · 5 / LATER · 5" — a priority gradient that
// mixes ready-to-ship recs, needs-decision recs, accepted/tracking
// items, and backlog into one undifferentiated stack. Operator scope
// reset: replace tiers with LANES, where each lane has distinct
// semantics + distinct action surface.
//
// Five lanes. One display state per rec → one lane.
//   ready_to_ship    ← actionable_edit
//   needs_decision   ← manual_review
//   needs_fresh_edit ← needs_fresh_edit
//   tracking         ← accepted_tracking
//   backlog          ← backlog
//   (suppressed states do not render in any lane)
// ---------------------------------------------------------------------------

export type RecLane =
  | "ready_to_ship"
  | "needs_decision"
  | "needs_fresh_edit"
  | "tracking"
  | "backlog";

/**
 * Display-state → lane mapping. The classifier guarantees each rec
 * has exactly one display state, so each rec maps to exactly one
 * lane (or `null` when suppressed).
 */
export function laneForDisplayState(
  state: RecDisplayState,
): RecLane | null {
  switch (state) {
    case "actionable_edit":
      return "ready_to_ship";
    case "manual_review":
      return "needs_decision";
    case "needs_fresh_edit":
      return "needs_fresh_edit";
    case "accepted_tracking":
      return "tracking";
    case "backlog":
      return "backlog";
    case "suppressed":
      return null;
  }
}

/**
 * Operator-facing lane labels. Use these as section headings; the
 * rec card itself stamps the lane name as a small badge.
 */
export const REC_LANE_LABEL: Record<RecLane, string> = {
  ready_to_ship: "Ready to ship",
  needs_decision: "Needs decision",
  needs_fresh_edit: "Needs fresh edit",
  tracking: "Tracking",
  backlog: "Backlog",
};

/**
 * One-line operator copy explaining what each lane is for. Sits
 * under the section heading so a non-technical operator can tell
 * lanes apart at a glance.
 */
export const REC_LANE_LEAD: Record<RecLane, string> = {
  ready_to_ship:
    "Beacon has an exact edit. Accept to track whether shipping it moves AI visibility.",
  needs_decision:
    "Beacon found an opportunity but can't pick the direction. You decide.",
  needs_fresh_edit:
    "Real opportunity, but the previous edits were dismissed. Regenerate when you're ready.",
  tracking:
    "Already accepted. Beacon is watching whether the change moved citations.",
  backlog: "Lower-priority opportunities. Promote any of these into the queue.",
};

/**
 * Action-button surface per lane. Each rec card consults this map
 * to render the right buttons. The current state of the rec
 * (response.status, eligibleEditCount) further refines which
 * buttons are enabled.
 */
export type LaneAction =
  | "accept_and_track"
  | "choose_direction"
  | "regenerate_later"
  | "promote"
  | "mark_shipped"
  | "view_evidence"
  | "defer"
  | "dismiss"
  | "undo";

export const REC_LANE_BUTTONS: Record<RecLane, ReadonlyArray<LaneAction>> = {
  ready_to_ship: ["accept_and_track", "defer", "dismiss"],
  needs_decision: ["choose_direction", "defer", "dismiss"],
  needs_fresh_edit: ["regenerate_later", "dismiss"],
  tracking: ["mark_shipped", "undo"],
  backlog: ["promote", "defer", "dismiss"],
};

/**
 * Operator-facing button copy. Internal `LaneAction` enum stays
 * stable so logs / analytics can reference it.
 */
export const LANE_ACTION_LABEL: Record<LaneAction, string> = {
  accept_and_track: "Accept + Track",
  choose_direction: "Choose direction",
  regenerate_later: "Regenerate later",
  promote: "Promote",
  mark_shipped: "Mark shipped",
  view_evidence: "View evidence",
  defer: "Defer",
  dismiss: "Dismiss",
  undo: "Undo",
};

/**
 * Tone for the lane badge in the rec card header. Drives color
 * palette so the operator can scan the page and tell "what kind of
 * action is this?" by hue alone.
 */
export const REC_LANE_TONE: Record<
  RecLane,
  "success" | "warning" | "muted" | "info"
> = {
  ready_to_ship: "success",
  needs_decision: "warning",
  needs_fresh_edit: "warning",
  tracking: "info",
  backlog: "muted",
};
