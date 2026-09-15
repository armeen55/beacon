/**
 * Action type taxonomy (CORE 100K collapse, 2026-07-22).
 *
 * The typed-edit vocabulary an edit can carry (`recommended_edits.action_type`, `changelog_entries.action_type`). The old 835-line registry (per-type spec map,
 * generatorActive flags, element-domain validation, pushability metadata) is retired: the Decision kernel proposes and validates `ChangeProposal`s directly,
 * so nothing consumed the spec apparatus any longer. What remains is the union itself. PURE TYPES. Server and client safe.
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
