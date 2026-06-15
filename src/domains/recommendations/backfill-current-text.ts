/**
 * Detail-page "before" backfill (2026-06-15).
 *
 * The recommendation detail page shows a before → after comparison on the
 * Suggested Copy act (see `suggested-copy-act.tsx`). The "before" comes from
 * `row.detail.currentText`, which the draft generator stores on the edit
 * when a page snapshot was available at generation time. Edits generated
 * before a scan ran (or by a path that didn't capture the current value)
 * have a null `current_text` — so the before→after silently degrades to
 * "proposed only".
 *
 * This module backfills the before AT DETAIL-RENDER TIME from the latest
 * page snapshot for the edit's target URL — a single tenant-scoped indexed
 * read, run ONLY on the single resolved detail row (never the list), so it
 * is cheap. Pure helpers here; the I/O wrapper lives in the detail page.
 *
 * Honesty: the snapshot value is "what was on the page at the last scan" —
 * the truest "current" Beacon has. We only show it when it is non-empty AND
 * differs from the proposed text (no-op edits never render a diff).
 */
import type { ActionRowType } from "./recommendation-action-rows";

/** Minimal shape of the page-snapshot fields we read for a "before". */
export type SnapshotBeforeFields = {
  title?: string | null;
  meta_description?: string | null;
  h1?: string | null;
};

/**
 * Which snapshot field is the "current value" for an edit action type.
 * Only the four field-replacing EDIT types have a meaningful before; every
 * other (additive) action returns null → no backfill.
 */
export function currentTextFieldForAction(
  actionType: ActionRowType,
): keyof SnapshotBeforeFields | null {
  switch (actionType) {
    case "edit_title":
      return "title";
    case "edit_meta":
      return "meta_description";
    case "edit_h1":
      return "h1";
    case "edit_h2":
      // H2 isn't a single-valued snapshot field (there's an h2_list), so
      // there's no reliable single "current H2" to compare against — skip.
      return null;
    default:
      return null;
  }
}

/**
 * Decide the "before" value for a resolved detail row.
 *
 * Returns the trimmed snapshot value when it is a genuine, showable before:
 *   - the action is a field-replacing edit type,
 *   - the row has no stored currentText yet,
 *   - the snapshot field is present + non-empty,
 *   - and it differs from the proposed text (a no-op isn't a "change").
 * Returns null otherwise (caller leaves the row unchanged).
 */
export function pickBackfilledCurrentText(input: {
  actionType: ActionRowType;
  existingCurrentText: string | null | undefined;
  proposedText: string | null | undefined;
  snapshot: SnapshotBeforeFields | null | undefined;
}): string | null {
  const { actionType, existingCurrentText, proposedText, snapshot } = input;
  // Already have a before — nothing to backfill.
  if (existingCurrentText != null && existingCurrentText.trim() !== "") {
    return null;
  }
  if (!snapshot) return null;
  const field = currentTextFieldForAction(actionType);
  if (field === null) return null;
  const raw = snapshot[field];
  if (typeof raw !== "string") return null;
  const before = raw.trim();
  if (before === "") return null;
  // A diff only makes sense when the proposed value actually differs.
  if (proposedText != null && before === proposedText.trim()) return null;
  return before;
}
