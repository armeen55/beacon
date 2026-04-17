/**
 * The subset of `FindingType` values that represent operator-relevant
 * content changes — the ones that appear in Today's "N changes detected"
 * review strip and drive the sidebar Today badge. Excludes health-class
 * findings like `faq_without_schema`, `schema_invalid`,
 * `robots_txt_blocked`, `schema_missing_for_page_type`, and guardrails
 * (those go in a separate bug-class bucket).
 *
 * Single source of truth shared between:
 *   - `src/components/today/change-review.tsx` (the banner + list)
 *   - `src/app/(shell)/layout.tsx`           (the Today sidebar badge)
 */

import type { FindingType } from "./types";

export const CONTENT_CHANGE_TYPES: ReadonlySet<FindingType> = new Set([
  "title_changed",
  "meta_changed",
  "h1_changed",
  "faq_changed",
  "schema_changed",
  "content_changed",
  "canonical_changed",
  "links_changed",
  "page_added",
  "page_removed",
]);

/**
 * Bug-class finding types — actual page health issues (not experiments).
 * Used for the Pages sidebar badge. Clicking Pages should surface the
 * pages with these findings so the operator can fix them.
 */
export const BUG_FINDING_TYPES: ReadonlySet<FindingType> = new Set([
  "schema_invalid",
  "faq_without_schema",
  "robots_txt_blocked",
  "deploy_mismatch",
]);
