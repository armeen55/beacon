/**
 * Recommendation Execution Layer v1 — Phase A (2026-05-13).
 *
 * Adapter layer between `RecommendationActionRow` and the UI tile the
 * Suggested Copy act renders. Pure / deterministic / no React / no I/O.
 *
 * The Beacon-drafted publishable text already exists in
 * `recommended_edits.proposed_text` (written by the OpenAI specific-edit
 * provider, validated, sanitized save-side). The detail-page row builder
 * surfaces it as `row.detail.proposedText` / `row.detail.currentText` /
 * `row.detail.faqAnswerText`. Phase A's only job is to surface what's
 * there — no new generation, no persistence, no server actions.
 *
 * Two boundaries:
 *   1. `supportsSuggestedCopy(actionType)` — pure type-level predicate.
 *      Returns true for action-row types that CAN have publishable copy
 *      (FAQ, H2, H1, title, meta, internal link, table, generic section /
 *      copy improvement). False for lifecycle-only types
 *      (create_page, split/merge, watch, regenerate, review_decision).
 *   2. `buildCopyTile(row)` — returns a typed `CopyTile` describing what
 *      the renderer should display, OR `null` to suppress the act. The
 *      display-safety guard runs INSIDE this builder so the renderer
 *      stays a pure presentation component.
 *
 * No dependency on the LLM provider, the validator, or the persistence
 * layer. No dependency on adjudicator-budget. Safe to import from
 * server- and client-side code.
 */

import type {
  ActionRowType,
  RecommendationActionRow,
} from "./recommendation-action-rows";
import {
  checkCopyDisplaySafe,
  type DisplayGuardReason,
} from "./suggested-copy-display-guard";

// ── Tile types ────────────────────────────────────────────────────────────

export type CopyTile =
  | { kind: "faq"; question: string; answer: string | null }
  | {
      kind: "h2";
      heading: string;
      paragraph: string;
      /** Current/before heading (the paragraph is treated as net-new).
       *  Null for additive H2s or when the snapshot has no current value. */
      before?: string | null;
    }
  | {
      kind: "h1";
      heading: string;
      /** Current/before H1 heading. Null when no snapshot value exists. */
      before?: string | null;
    }
  | {
      kind: "title_meta";
      title: string;
      meta: string | null;
      /** Current/before title tag (only for edit_title). */
      beforeTitle?: string | null;
      /** Current/before meta description (only for edit_meta). */
      beforeMeta?: string | null;
    }
  | { kind: "internal_link"; anchor: string; targetUrl: string | null }
  | { kind: "table"; markdown: string }
  | { kind: "section"; heading: string | null; body: string }
  | { kind: "plain"; text: string }
  | {
      kind: "fallback";
      /** Why the underlying copy was suppressed — diagnostic only. */
      reason: DisplayGuardReason;
    };

// ── Supported action-row types ────────────────────────────────────────────

/**
 * The 11 action-row types for which a Suggested Copy tile is rendered.
 * Operator-locked. Adding a new ActionRowType later requires either an
 * explicit entry here or a deliberate decision to suppress the act.
 *
 * Suppressed (no entry):
 *   - create_page   — page-level lifecycle; copy is in a separate brief
 *   - review_decision   — split / merge / watch meta-actions
 *   - regenerate_edit   — meta-action; no copy to show
 */
export const SUGGESTED_COPY_ACTION_ROW_TYPES: ReadonlyArray<ActionRowType> = [
  "edit_h1",
  "edit_h2",
  "edit_title",
  "edit_meta",
  "add_schema",
  "add_faq",
  "add_section",
  "improve_copy",
  "add_internal_links",
  "add_comparison_table",
  "technical_fix",
];

export function supportsSuggestedCopy(actionType: ActionRowType): boolean {
  return SUGGESTED_COPY_ACTION_ROW_TYPES.includes(actionType);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Split a `proposed_text` value into a heading + paragraph for H2 tiles.
 * Common shapes the OpenAI provider emits:
 *   "H2: Some heading\n\nBody paragraph..."
 *   "Some heading\n\nBody paragraph..."
 *   "Body paragraph only..."
 *
 * Returns `{ heading, paragraph }`. If the input can't be split (single
 * sentence, no newline, no leading "H2:" marker), the caller's `row.title`
 * fills in for the heading and the entire input becomes the paragraph.
 */
export function splitHeadingAndParagraph(
  text: string,
  fallbackHeading: string,
): { heading: string; paragraph: string } {
  const trimmed = text.trim();
  // Explicit "H2: ..." marker on first line.
  const explicit = trimmed.match(/^H2:\s*(.+?)(?:\n+([\s\S]+))?$/);
  if (explicit) {
    const heading = explicit[1].trim();
    const paragraph = explicit[2]?.trim() ?? "";
    if (heading.length > 0 && paragraph.length > 0) {
      return { heading, paragraph };
    }
    if (heading.length > 0) {
      return { heading, paragraph: trimmed };
    }
  }
  // Newline-separated heading + paragraph.
  const newlineSplit = trimmed.split(/\n\n+/);
  if (newlineSplit.length >= 2) {
    const first = newlineSplit[0].trim();
    const rest = newlineSplit.slice(1).join("\n\n").trim();
    // Heuristic: a "heading" line shouldn't end in a period and should
    // be reasonably short (≤ 120 chars). Otherwise treat the whole text
    // as the paragraph with the fallback heading.
    if (first.length > 0 && first.length <= 120 && !first.endsWith(".")) {
      return { heading: first, paragraph: rest };
    }
  }
  return { heading: fallbackHeading, paragraph: trimmed };
}

/**
 * Trim and collapse internal whitespace in a single-line field.
 */
function singleLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Sanitize a current/before field value for a before→after comparison.
 * Trims, treats empty as null, and runs the SAME display-safety guard as
 * the proposed text. A before value that fails the guard is dropped (null)
 * rather than downgrading the whole tile — only the proposed text drives
 * the fallback decision.
 */
function safeBefore(raw: string | null | undefined): string | null {
  const trimmed = typeof raw === "string" ? singleLine(raw) : "";
  if (trimmed.length === 0) return null;
  return checkCopyDisplaySafe(trimmed).safe ? trimmed : null;
}

// ── Builder ───────────────────────────────────────────────────────────────

/**
 * Build the CopyTile for one row, or return null to suppress the
 * Suggested Copy act entirely. Decisions:
 *
 *   1. Unsupported action-row type → null.
 *   2. No `proposedText` AND no `faqAnswerText` → null.
 *   3. Display-safety guard fails on ANY rendered field → fallback tile.
 *   4. Otherwise → a typed tile.
 */
export function buildCopyTile(row: RecommendationActionRow): CopyTile | null {
  if (!supportsSuggestedCopy(row.actionType)) return null;

  const proposed = row.detail.proposedText?.trim() ?? "";
  const faqAnswer = row.detail.faqAnswerText?.trim() ?? "";

  // FAQ rows: special case — the question comes from `row.title`, the
  // answer from `row.detail.faqAnswerText` (paired-row write path) with
  // `row.detail.proposedText` as a fallback for legacy single-row FAQs.
  if (row.actionType === "add_faq") {
    const question = singleLine(row.title);
    const answer = faqAnswer.length > 0 ? faqAnswer : proposed;
    if (question.length === 0 && answer.length === 0) return null;

    const guard = guardCombined(question, answer || null);
    if (!guard.safe) return { kind: "fallback", reason: guard.reason };
    return {
      kind: "faq",
      question,
      answer: answer.length > 0 ? answer : null,
    };
  }

  // Everything else requires non-empty `proposedText`.
  if (proposed.length === 0) return null;

  // Current/before value of the field being edited, surfaced from the page
  // snapshot via draft-enrichment. Only meaningful for EDIT-type tiles
  // (a true before/after). Sanitized through the SAME display-safety guard
  // as the proposed text — if the before value fails the guard we drop it
  // (set to null) rather than downgrading the whole tile to fallback. Only
  // the proposed text drives fallback.
  const currentBefore = safeBefore(row.detail.currentText);

  switch (row.actionType) {
    case "edit_h1": {
      const heading = singleLine(proposed);
      const guard = checkCopyDisplaySafe(heading);
      if (!guard.safe) return { kind: "fallback", reason: guard.reason };
      return { kind: "h1", heading, before: currentBefore };
    }
    case "edit_h2": {
      const { heading, paragraph } = splitHeadingAndParagraph(
        proposed,
        row.title,
      );
      const guard = guardCombined(heading, paragraph);
      if (!guard.safe) return { kind: "fallback", reason: guard.reason };
      return { kind: "h2", heading, paragraph, before: currentBefore };
    }
    case "edit_title": {
      const title = singleLine(proposed);
      const guard = checkCopyDisplaySafe(title);
      if (!guard.safe) return { kind: "fallback", reason: guard.reason };
      return {
        kind: "title_meta",
        title,
        meta: null,
        beforeTitle: currentBefore,
        beforeMeta: null,
      };
    }
    case "edit_meta": {
      // The meta description IS the proposed text. Title slot stays null
      // unless a future paired-row format surfaces both.
      const meta = singleLine(proposed);
      const guard = checkCopyDisplaySafe(meta);
      if (!guard.safe) return { kind: "fallback", reason: guard.reason };
      return {
        kind: "title_meta",
        title: "",
        meta,
        beforeTitle: null,
        beforeMeta: currentBefore,
      };
    }
    case "add_internal_links": {
      const anchor = singleLine(proposed);
      const guard = checkCopyDisplaySafe(anchor);
      if (!guard.safe) return { kind: "fallback", reason: guard.reason };
      return {
        kind: "internal_link",
        anchor,
        targetUrl: row.targetUrl,
      };
    }
    case "add_comparison_table": {
      // OpenAI provider emits markdown table rows directly in proposed_text.
      const guard = checkCopyDisplaySafe(proposed);
      if (!guard.safe) return { kind: "fallback", reason: guard.reason };
      return { kind: "table", markdown: proposed };
    }
    case "add_section":
    case "add_schema":
    case "technical_fix": {
      // Section-style tiles: keep a heading prefix when present, otherwise
      // present the whole body.
      const split = splitHeadingAndParagraph(proposed, row.title);
      // For schema / technical fix, treat headings as informational only
      // when the rest of the body is non-empty.
      const heading =
        split.paragraph.length > 0 && split.heading !== row.title
          ? split.heading
          : null;
      const body =
        split.paragraph.length > 0 ? split.paragraph : proposed;
      const guard = guardCombined(heading, body);
      if (!guard.safe) return { kind: "fallback", reason: guard.reason };
      return { kind: "section", heading, body };
    }
    case "improve_copy": {
      const guard = checkCopyDisplaySafe(proposed);
      if (!guard.safe) return { kind: "fallback", reason: guard.reason };
      return { kind: "plain", text: proposed };
    }
    default:
      return null;
  }
}

function guardCombined(
  ...texts: ReadonlyArray<string | null | undefined>
):
  | { safe: true }
  | { safe: false; reason: DisplayGuardReason } {
  for (const t of texts) {
    const r = checkCopyDisplaySafe(t);
    if (!r.safe) return { safe: false, reason: r.reason };
  }
  return { safe: true };
}

// ── Char-count helper for title/meta UX ───────────────────────────────────

/** Operator-facing character count for title/meta affordances.
 *  Renderer uses this to show `52 / 60` next to title tiles. Pure. */
export function countChars(text: string | null | undefined): number {
  if (typeof text !== "string") return 0;
  return text.length;
}

/** Recommended max length for an HTML `<title>` tag (search-listing
 *  display) — operator-locked at 60. */
export const TITLE_TAG_MAX_CHARS = 60;
/** Recommended max length for a `<meta name="description">` — 155. */
export const META_DESCRIPTION_MAX_CHARS = 155;
