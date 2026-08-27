/**
 * Action type taxonomy (CORE 100K collapse, 2026-07-22).
 *
 * The typed-edit vocabulary an edit can carry (`recommended_edits.action_type`, `changelog_entries.action_type`). The old 835-line registry (per-type spec map,
 * generatorActive flags, element-domain validation, pushability metadata) is retired: the Decision kernel proposes and validates `ChangeProposal`s directly,
 * so nothing consumed the spec apparatus any longer. What remains is the live surface: the union itself, the indexing-directive predicate, and the
 * operator-locked HOLD caveat. PURE TYPES + CONSTANTS. Server and client safe.
 */

// The universe of valid action-type identifiers: the exact string vocabulary persisted rows carry.

export type ActionType =
  | "edit_title"
  | "edit_meta"
  | "improve_meta"
  | "change_h1"
  | "add_h2_section"
  | "rewrite_h2"
  | "add_faq"
  | "rewrite_faq"
  | "full_rewrite"
  | "add_table"
  | "edit_table_row"
  | "add_answer_block"
  | "add_proof_section"
  | "add_comparison_section"
  | "add_cost_section"
  | "add_timeline_section"
  | "add_internal_link"
  | "add_schema"
  | "fix_schema"
  | "reorder_sections"
  | "split_page"
  | "merge_pages"
  | "create_page"
  | "watch"
  | "update_intro"
  | "add_h3_section"
  | "add_image_alt_text"
  | "fix_sitemap"
  | "fix_robots"
  | "fix_noindex"
  | "fix_status_code"
  | "fix_canonical"
  | "fix_page_experience"
  | "claim_gbp"
  | "optimize_gbp_profile"
  | "request_gbp_reviews"
  | "claim_or_optimize_houzz"
  | "claim_or_optimize_yelp"
  | "submit_to_industry_directory"
  | "pursue_local_pr";

// The crawl/index directives: types whose proposed value can deindex a page (robots, meta noindex, canonical, redirect/status). Purely additive technical
// edits (sitemap publish, schema, internal links, page-experience) are excluded.
const INDEXING_DIRECTIVE_ACTION_TYPES: ReadonlySet<ActionType> = new Set<ActionType>([
  "fix_robots",
  "fix_noindex",
  "fix_canonical",
  "fix_status_code",
]);

/**
 * True when the action type's directive changes crawling/indexing. Surfaces use this to render the indexing-safety caveat and suppress the one-tap Accept CTA.
 * Pure; accepts null/undefined (returns false) so callers can pass an optional row field without a guard.
 */
function isIndexingDirectiveActionType(
  actionType: ActionType | null | undefined,
): boolean {
  return actionType != null && INDEXING_DIRECTIVE_ACTION_TYPES.has(actionType);
}

/**
 * Plain-English HOLD framing shown next to an indexing/crawling directive. Operator-locked copy (#310; destructive-action audit 2026-07-20). A HELD-FOR-
 * REVIEW notice, not a paste-ready caption. Beacon voice, no dashes.
 */
const INDEXING_DIRECTIVE_CAVEAT =
  "This changes how search engines index this page. Double check the exact value before you touch it; a wrong value can remove this page from Google, so it is held for review instead of being one tap.";

/**
 * WHAT WAS DONE TO THIS PAGE, as a sentence, from the slug the ledger actually stores. A row's action type is a
 * change-family key ("section_add"), not English, and gluing it to an article printed "the section add" on the
 * operator's own Measuring lane. Every family that reads as broken English that way is written out here in
 * full; anything unmapped keeps the caller's generic derivation, so an unknown slug still renders as words.
 */
const CHANGE_SENTENCE: Record<string, string> = {
  title: "The page title was rewritten", meta: "The description was rewritten", h1: "The main heading was rewritten",
  opening_answer: "The opening answer was rewritten", answer_block: "The opening answer was rewritten",
  section: "A section was rewritten", section_add: "A section was added", section_remove: "A section was removed",
  section_rewrite: "A section was rewritten", paragraph_correction: "A paragraph was corrected",
  restructure: "The page was reordered", full_rewrite: "The whole page was rewritten", new_page: "A new page was published",
  create_page: "A new page was published", factual_correction: "A fact was corrected",
  source_update: "The sources were updated", source_pack: "Sources were added", entity_expansion: "What was missing got named",
  table_or_list_add: "A table was added", internal_links: "The internal links changed",
  internal_link_add: "An internal link was added", internal_link_remove: "An internal link was removed",
  anchor_text: "The link wording changed", schema: "The schema markup changed", canonical: "The canonical address changed",
  redirect: "A redirect was added", noindex: "The indexing rule changed", consolidation: "Pages were merged",
  navigation: "The navigation changed", faq: "The FAQ changed",
};

/** The sentence for one stored action type, or null when nothing is mapped and the caller's own fallback wins. */
function changeSentence(actionType: string | null | undefined): string | null {
  return CHANGE_SENTENCE[(actionType ?? "").trim().toLowerCase()] ?? null;
}
