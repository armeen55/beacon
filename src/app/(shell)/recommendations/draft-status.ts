import type { TodayMove } from "../today-moves-data";

/**
 * Draft-readiness status for the Drafts surface — PURE + shared by the server page
 * (counts) and the client tab filter. Keep it out of the "use client" module so the
 * server can call it. "ready" only when actual prepared copy exists (operator: no
 * fake "draft ready").
 */
export type DraftStatus = "ready" | "ready_to_draft" | "needs_review";

export function draftStatusOf(m: TodayMove): DraftStatus {
  if (m.preparedStale) return "needs_review";
  // W5 (2026-07-09, J-69): a factual draft with no authoritative source is
  // held for review, never shown as paste-ready copy, the missing piece is
  // a source, not a re-draft, so it lands in "needs review" like any other
  // draft that isn't done yet.
  if (m.preparedQuality?.status === "missing_source") return "needs_review";
  const hasCopy = Boolean(
    m.preparedDraftText ||
      m.savedAnswerBlock ||
      m.draftTitle ||
      (m.titleVariants && m.titleVariants.length > 0) ||
      m.answerBrief,
  );
  if (m.preparedChecklist?.readyToReview || hasCopy) return "ready";
  return "ready_to_draft";
}

/**
 * W5 (2026-07-09, J-69), an honest, first-person reason for a "needs_review"
 * verdict when we know a SPECIFIC one, for surfaces that want to say more
 * than the bucket name. Returns null when there's nothing more specific to
 * say (the caller keeps whatever generic copy it already renders), purely
 * additive, never required by draftStatusOf above.
 */
export function draftStatusReason(m: TodayMove): string | null {
  if (m.preparedQuality?.status === "missing_source") {
    return "I need a source before this is paste-ready.";
  }
  return null;
}
