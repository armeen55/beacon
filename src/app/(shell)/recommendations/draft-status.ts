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
