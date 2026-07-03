/**
 * Insight layer — page-primary action labels (operator-OS rebuild, Phase 1).
 *
 * `resolvePagePrimary` (the Opportunity Map / State of the Union / Workbench
 * CTA resolver) and its `REVIEW_HREF` fallback were deleted 2026-07-02 (UX5
 * legacy sweep) alongside the whole `/workbench` route and the dead
 * State of the Union chain — none of those surfaces ever shipped a live
 * caller. `actionLabel`/`PRIMARY_ACTION_LABEL` remain: `today-v2-data.ts`
 * still uses `actionLabel` to render Page Surgeon action headlines.
 */

/** Page Surgeon `recommended_atomic_action` → imperative operator headline.
 *  Keys mirror `AtomicChangeType` (+ the three non-change verdicts). */
export const PRIMARY_ACTION_LABEL: Record<string, string> = {
  title: "Rewrite the title",
  meta: "Rewrite the meta description",
  h1: "Fix the H1 / page headline",
  intro_answer_block: "Add a direct answer block",
  faq: "Add a visible Q&A",
  section_add: "Add a missing section",
  section_remove: "Remove a weak section",
  section_reorder: "Reorder the sections",
  internal_link: "Add internal links",
  schema: "Add structured data (JSON-LD)",
  image_alt: "Add image alt text",
  ux_cta_fix: "Fix UX / CTA",
  citation_source: "Cite a source",
  create_new_page: "Create a new page",
  keep_current: "Healthy, monitor",
  needs_more_evidence: "Needs more evidence",
  needs_llm_review: "Needs review",
};

export function actionLabel(action: string | null | undefined): string {
  if (!action) return "Review the page";
  return PRIMARY_ACTION_LABEL[action] ?? "Review the page";
}
