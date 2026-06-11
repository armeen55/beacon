/**
 * 2026-06-10 — learning from the operator's edits (P0 wall 7).
 *
 * `verified_live_modified` means the live text matched the draft's
 * intent but NOT its words — the operator rewrote it before shipping.
 * Until now nothing consumed that signal. This module turns it into:
 *
 *   1. The EDIT RATE per action type: of the drafts that went live,
 *      how many did the operator rewrite? ("My edit rate dropped" is
 *      the dream's proof the engine is learning.)
 *   2. A deterministic confidence adjustment for FUTURE drafts: when
 *      the operator rewrites most drafts of an action type (rate >
 *      0.5 across ≥5 shipped), new rows of that type are downgraded
 *      from high/medium confidence and carry a plain-English note —
 *      honest "you usually reword these" signal on the card.
 *
 * Pure compute over recommended_edits rows the writer ALREADY loads —
 * no new I/O, no LLM, windowed to the last 90 days.
 */

import type { ActionType } from "@/domains/recommendations/action-types";
import type { DeterministicPromotionEditRow } from "@/domains/recommendation-intelligence/promotion-result-to-edit-row";

/** Minimal row shape needed — structurally satisfied by RecommendedEditRow
 *  (whose lifecycle fields are optional on legacy rows). */
export type EditFeedbackSourceRow = {
  action_type: ActionType | string;
  implementation_status?: string | null;
  updated_at?: string | null;
  live_at?: string | null;
};

export type ActionTypeEditStats = {
  /** Shipped exactly as drafted (verified_live). */
  asProposed: number;
  /** Shipped with operator rewording (verified_live_modified). */
  modified: number;
  /** modified / (asProposed + modified); null when nothing shipped. */
  editRate: number | null;
};

export type EditFeedback = {
  byActionType: ReadonlyMap<string, ActionTypeEditStats>;
  overall: ActionTypeEditStats;
  windowDays: number;
};

export const EDIT_FEEDBACK_WINDOW_DAYS = 90;
/** Minimum shipped drafts of a type before the downgrade can apply. */
export const EDIT_FEEDBACK_MIN_SHIPPED = 5;
/** Edit-rate threshold above which new drafts of the type downgrade. */
export const EDIT_FEEDBACK_DOWNGRADE_RATE = 0.5;

export function computeEditFeedback(
  rows: EditFeedbackSourceRow[],
  now: Date,
  windowDays: number = EDIT_FEEDBACK_WINDOW_DAYS,
): EditFeedback {
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const byActionType = new Map<string, ActionTypeEditStats>();
  const overall: ActionTypeEditStats = { asProposed: 0, modified: 0, editRate: null };

  for (const r of rows) {
    const isAsProposed = r.implementation_status === "verified_live";
    const isModified = r.implementation_status === "verified_live_modified";
    if (!isAsProposed && !isModified) continue;
    const stamp = r.live_at ?? r.updated_at ?? "";
    if (stamp < cutoff) continue;
    const stats = byActionType.get(r.action_type) ?? {
      asProposed: 0,
      modified: 0,
      editRate: null,
    };
    if (isAsProposed) {
      stats.asProposed++;
      overall.asProposed++;
    } else {
      stats.modified++;
      overall.modified++;
    }
    byActionType.set(r.action_type, stats);
  }

  for (const stats of byActionType.values()) {
    const shipped = stats.asProposed + stats.modified;
    stats.editRate = shipped > 0 ? stats.modified / shipped : null;
  }
  const shippedAll = overall.asProposed + overall.modified;
  overall.editRate = shippedAll > 0 ? overall.modified / shippedAll : null;

  return { byActionType, overall, windowDays };
}

/**
 * Apply the learned signal to a freshly promoted row. Deterministic and
 * conservative: only fires at ≥ EDIT_FEEDBACK_MIN_SHIPPED shipped
 * drafts of the type AND editRate > EDIT_FEEDBACK_DOWNGRADE_RATE.
 * Downgrades confidence one step (high→medium, medium→low) and appends
 * a plain-English risk note so the card says WHY.
 */
export function applyEditFeedbackToRow(
  row: DeterministicPromotionEditRow,
  feedback: EditFeedback,
): DeterministicPromotionEditRow {
  const stats = feedback.byActionType.get(row.action_type);
  if (!stats) return row;
  const shipped = stats.asProposed + stats.modified;
  if (shipped < EDIT_FEEDBACK_MIN_SHIPPED) return row;
  if (stats.editRate === null || stats.editRate <= EDIT_FEEDBACK_DOWNGRADE_RATE) return row;

  const downgraded: DeterministicPromotionEditRow["confidence"] =
    row.confidence === "high" ? "medium" : "low";
  const note = `You reworded ${stats.modified} of the last ${shipped} drafts like this before shipping — review the wording closely.`;
  return {
    ...row,
    confidence: downgraded,
    risks: [...row.risks, note],
  };
}
