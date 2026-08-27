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

const CONTENT_CHANGE_TYPES: ReadonlySet<FindingType> = new Set([
  "title_changed",
  "meta_changed",
  "h1_changed",
  // Phase post-A+B1 (2026-04-21): surface H2 / H3 / schema-entity-name
  // edits in Today's "Review changes" banner. Previously these flowed
  // through the diff but produced `unexpected_change` findings that the
  // banner filter excluded.
  "h2_changed",
  "h3_changed",
  "schema_entity_names_changed",
  "faq_changed",
  "schema_changed",
  "content_changed",
  "canonical_changed",
  "links_changed",
  "page_added",
  "page_removed",
]);

