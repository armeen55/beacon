/**
 * Canonical evidence scopes — keep Diagnostics, Results, and proof copy aligned.
 * When UI uses the same word for different data, users lose trust.
 */
export const EVIDENCE_SCOPE = {
  /** `Result.attributed_changelog_ids` populated by import / workbook / bridge. */
  storedResultChangeIds:
    "Change IDs stored on each result row (import or workbook).",
  /** Same pipeline as Results → Suggested cause. */
  eventReviewDriver:
    "Suggested cause from outcome events + matching + Review when locked.",
  /** Dashboard / benchmark headline. */
  citationSample:
    "Share of citation observations in the imported evidence index — not every possible AI answer.",
  /** Review UI: locking a cause for an event. */
  reviewLockedCause:
    "You picked a cause for a visibility shift in Review — not proof of revenue impact.",
} as const;
