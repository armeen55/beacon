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

// The universe of valid action-type identifiers: the exact string vocabulary
// persisted rows carry.

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

/**
 * WHAT I DID TO THIS PAGE, as a sentence, from the slug the ledger actually stores. A row's action type is a
 * change-family key ("section_add"), not English, and pasting it into "I changed the ..." printed "I changed
 * the section add" on the operator's own Measuring lane. Every family that reads as broken English when it is
 * glued to an article is written out here in full; anything unmapped keeps the generic derivation the caller
 * already has, so a slug I have never seen still renders as words rather than blowing up.
 */
const CHANGE_SENTENCE: Record<string, string> = {
  title: "I rewrote the page title", meta: "I rewrote the description", h1: "I rewrote the main heading",
  opening_answer: "I rewrote the opening answer", answer_block: "I rewrote the opening answer",
  section: "I rewrote a section", section_add: "I added a section", section_remove: "I removed a section",
  section_rewrite: "I rewrote a section", paragraph_correction: "I corrected a paragraph",
  restructure: "I reordered the page", full_rewrite: "I rewrote the whole page", new_page: "I published a new page",
  create_page: "I published a new page", factual_correction: "I corrected a fact",
  source_update: "I updated the sources", source_pack: "I added sources", entity_expansion: "I named what was missing",
  table_or_list_add: "I added a table", internal_links: "I changed the internal links",
  internal_link_add: "I added an internal link", internal_link_remove: "I removed an internal link",
  anchor_text: "I changed the link wording", schema: "I changed the schema markup", canonical: "I changed the canonical address",
  redirect: "I added a redirect", noindex: "I changed the indexing rule", consolidation: "I merged pages",
  navigation: "I changed the navigation", faq: "I changed the FAQ",
};

/** The sentence for one stored action type, or null when nothing is mapped and the caller's own fallback wins. */
export function changeSentence(actionType: string | null | undefined): string | null {
  return CHANGE_SENTENCE[(actionType ?? "").trim().toLowerCase()] ?? null;
}
