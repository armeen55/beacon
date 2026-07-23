/**
 * Action type taxonomy (CORE 100K collapse, 2026-07-22).
 *
 * The typed-edit vocabulary an edit can carry (`recommended_edits.action_type`,
 * `changelog_entries.action_type`). The old 835-line registry (per-type spec map,
 * generatorActive flags, element-domain validation, pushability metadata) is
 * retired: the Decision kernel proposes and validates `ChangeProposal`s directly,
 * so nothing consumed the spec apparatus any longer. What remains is the live
 * surface: the union itself, the indexing-directive predicate, and the
 * operator-locked HOLD caveat. PURE TYPES + CONSTANTS. Server and client safe.
 */

// The universe of valid action-type identifiers. `ActionType` derives from this
// so persisted rows keep the exact same string vocabulary.
export const ACTION_TYPES = [
  // On-page copy edits
  "edit_title",
  "edit_meta",
  "improve_meta",
  "change_h1",
  "add_h2_section",
  "rewrite_h2",
  "add_faq",
  "rewrite_faq",
  "full_rewrite",
  "add_table",
  "edit_table_row",
  "add_answer_block",
  "add_proof_section",
  "add_comparison_section",
  "add_cost_section",
  "add_timeline_section",
  // Technical / structural
  "add_internal_link",
  "add_schema",
  "fix_schema",
  "reorder_sections",
  // Page-level lifecycle
  "split_page",
  "merge_pages",
  "create_page",
  // Passive
  "watch",
  "update_intro",
  "add_h3_section",
  "add_image_alt_text",
  // Indexability remediation
  "fix_sitemap",
  "fix_robots",
  "fix_noindex",
  "fix_status_code",
  "fix_canonical",
  "fix_page_experience",
  // Off-site authority (detection-only; no write paths)
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

// The crawl/index directives: types whose proposed value can deindex a page
// (robots, meta noindex, canonical, redirect/status). Purely additive technical
// edits (sitemap publish, schema, internal links, page-experience) are excluded.
const INDEXING_DIRECTIVE_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "fix_robots",
  "fix_noindex",
  "fix_canonical",
  "fix_status_code",
]);

/**
 * True when the action type's directive changes crawling/indexing. Surfaces use
 * this to render the indexing-safety caveat and suppress the one-tap Accept CTA.
 * Pure; accepts null/undefined (returns false) so callers can pass an optional
 * row field without a guard.
 */
export function isIndexingDirectiveActionType(
  actionType: ActionType | null | undefined,
): boolean {
  return actionType != null && INDEXING_DIRECTIVE_ACTION_TYPES.has(actionType);
}

/**
 * Plain-English HOLD framing shown next to an indexing/crawling directive.
 * Operator-locked copy (#310; destructive-action audit 2026-07-20). A HELD-FOR-
 * REVIEW notice, not a paste-ready caption. Beacon voice, no dashes.
 */
export const INDEXING_DIRECTIVE_CAVEAT =
  "This changes how search engines index this page. Double check the exact value before you touch it; a wrong value can remove this page from Google, so I hold it for review instead of making it one tap.";
