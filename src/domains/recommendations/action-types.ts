/**
 * Sprint 6A.1 Phase 2 (2026-04-24) — Action type registry.
 *
 * Single source of truth for the typed-edit taxonomy. Every specific edit
 * produced by a deterministic generator (Phase 6A.1.9) or LLM provider
 * (Sprint 6A.2) carries an `actionType` drawn from this registry. Every
 * row in `recommended_edits` and every row in `changelog_entries` with a
 * `target_element_key` pulls its `action_type` column from this enum.
 *
 * Adding a new edit type later = append one entry to `ACTION_TYPES` and
 * one spec to `ACTION_TYPE_REGISTRY`. No other files change structurally
 * (only the generator implementation, when that type goes active).
 *
 * Slice 4.5.C.α₂ policy (2026-05-20): 37-type universe registered;
 * 10 have `generatorActive: true` (edit_title, edit_meta, change_h1,
 * add_h2_section, add_faq, fix_sitemap, fix_robots, fix_status_code,
 * fix_canonical, fix_noindex). 7 off-site authority types are locked
 * inactive per Section 7 C7b. The remaining 20 ship as registered-
 * but-inactive so the provider-adapter knows the space of valid
 * outputs from day one — Slice 4.5.C.α₃ will activate
 * `add_internal_link` + `add_schema`. 4.5.C.α₂ flips
 * `fix_noindex` on paired with the Tier-2 sensitive predicate
 * `noindex-on-indexable-page` (emits at `confidence: "low"` →
 * routes to `diagnostic_only`, NOT customer queue). α₂ also
 * adds the `robots-blocks-ai-bots` Tier-2 predicate which
 * reuses the existing α₁ `fix_robots` action type (also at
 * `confidence: "low"`).
 *
 * This module is PURE TYPES + CONSTANTS. No DB writes. No extractors.
 * No UI. Safe to import from both server and client code.
 */

import type { SignalType, AssetType } from "@/lib/constants";
import type { ElementType } from "@/domains/pages/extractors/registry";

// ── Enum ────────────────────────────────────────────────────────────────────

export const ACTION_TYPES = [
  // On-page copy edits
  "edit_title",
  "edit_meta",
  "change_h1",
  "add_h2_section",
  "rewrite_h2",
  "add_faq",
  "rewrite_faq",
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
  // ── Slice 4.5.B.α additions (2026-05-19) — registered inactive ──────────
  // These three are added to the universe of valid outputs but DO NOT
  // flip `generatorActive: true` in this slice — paired deterministic
  // trigger predicates land in Slice 4.5.C (or later for image alt
  // text once PageSnapshot exposes the `images` field).
  "update_intro",
  "add_h3_section",
  "add_image_alt_text",
  // ── Slice 4.5.C.α₀ additions (2026-05-19) — indexability
  //    remediation foundation. Registered as inactive; paired
  //    deterministic trigger predicates land in Slice 4.5.C.α₁
  //    (Tier-1 fixes: `fix_sitemap`, `fix_robots` for googlebot,
  //    `fix_status_code`, `fix_canonical`) and Slice 4.5.C.α₂
  //    (Tier-2 sensitive: `fix_noindex`, robots blocks AI bots).
  //    Section 4 (Phase A.3) ships the upstream
  //    `owned_url_indexability` verdict (10-verdict enum); these
  //    types map 1:1 to verdict shapes. All five carry
  //    `signalType: "technical"` per O4 (technical / indexability
  //    fix grouping); `elementTypeDomain: []` per the indexability
  //    family (the recommendation targets a configuration file or
  //    HTTP header, not an on-page element); `requiresCurrentText:
  //    false` AND `requiresProposedText: false` because these
  //    flow as `task_instructions`-bearing human-task rows in
  //    α₁/α₂ (deterministic; no LLM drafts a robots.txt rule).
  //    Customer-copy templates land alongside in this slice; Act 4
  //    Suggested Copy stays suppressed for these types via the
  //    existing review_decision row-type mapping.
  "fix_sitemap",
  "fix_robots",
  "fix_noindex",
  "fix_status_code",
  "fix_canonical",
  // ── Off-site authority (Section 7 C7b — locked invariants: read-only,
  //    no LLM generation, no Suggested Copy, no write paths to GBP /
  //    Yelp / Houzz / Angi / BBB / industry directories / press).
  //    Detection lives on /diagnostics/off-site-authority (C7a).
  //    Recommendation generation + customer surfaces defer to
  //    C7c / C7d / C7e behind the multi-tenant prerequisite.
  "claim_gbp",
  "optimize_gbp_profile",
  "request_gbp_reviews",
  "claim_or_optimize_houzz",
  "claim_or_optimize_yelp",
  "submit_to_industry_directory",
  "pursue_local_pr",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

// ── Spec shape ──────────────────────────────────────────────────────────────

export type ActionTypeSpec = {
  /** The action type identifier. Redundant with the map key, but lets
   *  callers pass around a single `ActionTypeSpec` without losing
   *  provenance. */
  actionType: ActionType;
  /**
   * Which element types this action can legitimately target. Used by
   * Phase 6A.1.10's output-validation layer to reject LLM outputs that
   * pair an action_type with an incompatible element_type (e.g.,
   * `edit_title` with `target_element_key` pointing at an `h2`).
   *
   * Empty array means "no specific element" — applies to page-level
   * lifecycle actions (`split_page`, `merge_pages`, `create_page`,
   * `watch`). Those actions store `target_element_key = NULL` on the
   * `recommended_edits` row; the upsert's NULLS NOT DISTINCT behavior
   * keeps them deduplicated per (rec_id, action_type).
   *
   * Wired in Phase 6A.1.4 (pure type-level addition, no runtime logic
   * changes from Phase 6A.1.2).
   */
  elementTypeDomain: ElementType[];
  /**
   * How the resulting changelog entry is categorized for attribution.
   * Maps 1:1 to the existing `SignalType` enum used on
   * `changelog_entries.signal_type`. The Accept path at
   * `src/app/(shell)/recommendations/actions.ts:mapRecToChangelogShape`
   * currently computes signal type from the action category
   * ("page" | "technical" | "content") — Phase 6A.1.12 will replace that
   * computation with `ACTION_TYPE_REGISTRY[actionType].signalType`.
   */
  signalType: SignalType;
  /**
   * Whether the generator must produce `current_text` on the
   * `recommended_edits` row (i.e. the element already exists and we're
   * rewriting it). `false` when the edit is additive (new H2, new FAQ,
   * new schema, new page).
   */
  requiresCurrentText: boolean;
  /**
   * Whether the generator must produce `proposed_text`. `false` for
   * actions like `split_page`, `merge_pages`, `create_page`, and
   * `watch` — the body of the change is described in `why` /
   * `measurement_plan` rather than a single string.
   */
  requiresProposedText: boolean;
  /**
   * Default `asset_type` assigned to the changelog entry. The Accept
   * path can override based on the actual target page's
   * `ownership_tier` / cluster kind — this is a sensible fallback when
   * the page context isn't available.
   */
  changelogAssetType: AssetType;
  /** Operator-facing short label for UI badges + diagnostics. */
  operatorLabel: string;
  /**
   * Whether v1 deterministic generator is live for this type. Sprint
   * 6A.1 ships with exactly 3 active:
   *   - edit_title
   *   - add_h2_section
   *   - add_faq
   * Sprint 6A.2 will flip the rest to `true` (behind the LLM provider)
   * without touching any caller.
   */
  generatorActive: boolean;
};

// ── Registry ────────────────────────────────────────────────────────────────

export const ACTION_TYPE_REGISTRY: Record<ActionType, ActionTypeSpec> = {
  // ── On-page copy edits ───────────────────────────────────────────────────
  edit_title: {
    actionType: "edit_title",
    elementTypeDomain: ["title"],
    signalType: "content",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Edit title tag",
    generatorActive: true,
  },
  edit_meta: {
    actionType: "edit_meta",
    elementTypeDomain: ["meta"],
    signalType: "content",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Edit meta description",
    // Slice 4.5.B.α (2026-05-19) — paired with missing-meta +
    // duplicate-meta deterministic trigger predicates.
    generatorActive: true,
  },
  change_h1: {
    actionType: "change_h1",
    elementTypeDomain: ["h1"],
    signalType: "content",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Change H1",
    // Slice 4.5.B.α₁ (2026-05-19) — paired with missing-h1 +
    // weak-h1 + title-h1-mismatch deterministic trigger
    // predicates.
    generatorActive: true,
  },
  add_h2_section: {
    actionType: "add_h2_section",
    elementTypeDomain: ["h2"],
    signalType: "content",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add H2 section",
    generatorActive: true,
  },
  rewrite_h2: {
    actionType: "rewrite_h2",
    elementTypeDomain: ["h2"],
    signalType: "content",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Rewrite H2",
    generatorActive: false,
  },
  add_faq: {
    actionType: "add_faq",
    elementTypeDomain: ["faq_question", "faq_answer"],
    signalType: "faq",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add FAQ",
    generatorActive: true,
  },
  rewrite_faq: {
    actionType: "rewrite_faq",
    elementTypeDomain: ["faq_question", "faq_answer"],
    signalType: "faq",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Rewrite FAQ",
    generatorActive: false,
  },
  add_table: {
    actionType: "add_table",
    elementTypeDomain: ["table"],
    signalType: "content",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add comparison table",
    generatorActive: false,
  },
  edit_table_row: {
    actionType: "edit_table_row",
    elementTypeDomain: ["table_row"],
    signalType: "content",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Edit table row",
    generatorActive: false,
  },
  add_answer_block: {
    actionType: "add_answer_block",
    elementTypeDomain: ["answer_block"],
    signalType: "content",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add answer block",
    generatorActive: false,
  },
  add_proof_section: {
    actionType: "add_proof_section",
    elementTypeDomain: ["proof"],
    signalType: "content",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add proof section",
    generatorActive: false,
  },
  add_comparison_section: {
    actionType: "add_comparison_section",
    elementTypeDomain: ["comparison_block"],
    signalType: "content",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add comparison section",
    generatorActive: false,
  },
  add_cost_section: {
    actionType: "add_cost_section",
    elementTypeDomain: ["cost_section"],
    signalType: "content",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add cost section",
    generatorActive: false,
  },
  add_timeline_section: {
    actionType: "add_timeline_section",
    elementTypeDomain: ["timeline_section"],
    signalType: "content",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add timeline section",
    generatorActive: false,
  },
  // ── Technical / structural ───────────────────────────────────────────────
  add_internal_link: {
    actionType: "add_internal_link",
    elementTypeDomain: ["internal_link"],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add internal link",
    generatorActive: false,
  },
  add_schema: {
    actionType: "add_schema",
    elementTypeDomain: ["schema_type", "schema_property"],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add schema",
    generatorActive: false,
  },
  fix_schema: {
    actionType: "fix_schema",
    elementTypeDomain: ["schema_type", "schema_property"],
    signalType: "technical",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Fix schema",
    generatorActive: false,
  },
  reorder_sections: {
    actionType: "reorder_sections",
    elementTypeDomain: ["h2", "h3"],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Reorder page sections",
    generatorActive: false,
  },
  // ── Page-level lifecycle ─────────────────────────────────────────────────
  split_page: {
    actionType: "split_page",
    elementTypeDomain: [],
    signalType: "page",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Split page",
    generatorActive: false,
  },
  merge_pages: {
    actionType: "merge_pages",
    elementTypeDomain: [],
    signalType: "page",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Merge pages",
    generatorActive: false,
  },
  create_page: {
    actionType: "create_page",
    elementTypeDomain: [],
    signalType: "page",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Create new page",
    generatorActive: false,
  },
  // ── Passive ──────────────────────────────────────────────────────────────
  watch: {
    actionType: "watch",
    elementTypeDomain: [],
    signalType: "page",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Watch — track without editing",
    generatorActive: false,
  },

  // ── Slice 4.5.B.α additions (2026-05-19, inactive) ───────────────────────
  // Registered so the LLM provider's enum-bound output schema knows
  // these targets exist. Activation deferred to slices 4.5.C+ when
  // paired deterministic trigger predicates land. `add_image_alt_text`
  // also requires a PageSnapshot extractor extension before any
  // predicate can fire.
  update_intro: {
    actionType: "update_intro",
    elementTypeDomain: [],
    signalType: "content",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Update intro answer",
    generatorActive: false,
  },
  add_h3_section: {
    actionType: "add_h3_section",
    elementTypeDomain: ["h3"],
    signalType: "content",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add H3 sub-section",
    generatorActive: false,
  },
  add_image_alt_text: {
    actionType: "add_image_alt_text",
    elementTypeDomain: [],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Add image alt text",
    generatorActive: false,
  },

  // ── Slice 4.5.C.α₀ — Indexability remediation registry foundation
  //    (2026-05-19) ───────────────────────────────────────────────────────────
  // Five new types covering the 10-verdict `owned_url_indexability`
  // enum from Section 4 / Phase A.3:
  //   • `fix_sitemap`     → not_in_sitemap
  //   • `fix_robots`      → blocked_by_robots_for_googlebot / _for_ai
  //   • `fix_noindex`     → noindex_meta
  //   • `fix_status_code` → bad_status_code
  //   • `fix_canonical`   → canonical_elsewhere
  // (`not_indexed_in_gsc` / `indexed_but_not_cited` / `ok` / `unknown`
  // verdicts don't map to a fix recommendation in α₀; they remain
  // diagnostics-only or feed retrieval/citation families in later
  // slices.)
  //
  // Locked shape for all five (O4 + 4.5.C plan):
  //   • signalType: "technical" → groups with other indexability /
  //     structural fixes; priority-score weight = INDEX_BLOCKER (25)
  //     per architecture invariant 13 (indexability outranks content).
  //   • elementTypeDomain: [] → targets a configuration surface
  //     (sitemap.xml, robots.txt, HTTP response, meta tag, canonical
  //     header), not a specific on-page element_type.
  //   • requiresCurrentText: false AND requiresProposedText: false →
  //     these flow as `task_instructions`-bearing human-task rows
  //     when the predicates land in α₁/α₂. No LLM drafts a robots.txt
  //     rule or a sitemap entry. Act 4 Suggested Copy stays
  //     suppressed via the existing `review_decision` row-type
  //     mapping (see recommendation-action-rows.ts).
  //   • changelogAssetType: "service_page" → matches the on-page
  //     fallback used by every other technical entry today.
  //   • generatorActive: false → α₀ ships the registry foundation
  //     only; α₁/α₂ flip these on paired with deterministic
  //     predicates over Section 4's indexability verdict.
  fix_sitemap: {
    actionType: "fix_sitemap",
    elementTypeDomain: [],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Add this URL to your sitemap",
    // Slice 4.5.C.α₁ (2026-05-20) — flipped paired with the
    // `sitemap-missing` deterministic trigger predicate over the
    // `not_in_sitemap` indexability verdict.
    generatorActive: true,
  },
  fix_robots: {
    actionType: "fix_robots",
    elementTypeDomain: [],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Unblock this URL in robots.txt",
    // Slice 4.5.C.α₁ (2026-05-20) — flipped paired with the
    // `robots-blocks-googlebot` predicate over the
    // `blocked_by_robots_for_googlebot` verdict. Slice 4.5.C.α₂
    // will add a paired AI-bot variant (Google-Extended / GPTBot
    // / PerplexityBot / ClaudeBot) that ALSO emits `fix_robots`.
    generatorActive: true,
  },
  fix_noindex: {
    actionType: "fix_noindex",
    elementTypeDomain: [],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Remove the noindex tag from this page",
    // Slice 4.5.C.α₂ (2026-05-20) — Tier-2 sensitive. Flipped
    // paired with the `noindex-on-indexable-page` predicate
    // which emits at `confidence: "low"` so candidates route to
    // `diagnostic_only` via `applyQueueRules` (NOT the customer
    // queue). Three safety guards on the predicate: (1) page-type
    // allowlist (homepage / city / service / project only),
    // (2) skip extraction_certainty="uncertain", (3) skip when
    // has_canonical_mismatch=true (paginated/duplicate signature).
    generatorActive: true,
  },
  fix_status_code: {
    actionType: "fix_status_code",
    elementTypeDomain: [],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Restore a clean 200 response for this URL",
    // Slice 4.5.C.α₁ (2026-05-20) — flipped paired with the
    // `bad-http-status` predicate over the `bad_status_code`
    // verdict (covers 4xx/5xx + 301/302/307/308).
    generatorActive: true,
  },
  fix_canonical: {
    actionType: "fix_canonical",
    elementTypeDomain: [],
    signalType: "technical",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "service_page",
    operatorLabel: "Update the canonical tag on this page",
    // Slice 4.5.C.α₁ (2026-05-20) — flipped paired with the
    // `canonical-mismatch` predicate over the
    // `canonical_elsewhere` verdict (detail pages only —
    // homepage / city / service / project).
    generatorActive: true,
  },

  // ── Off-site authority (Section 7 C7b — 2026-05-16) ────────────────────────
  // Locked invariants:
  //   • read-only/manual: Beacon RECOMMENDS, never PERFORMS
  //   • generatorActive: false → LLM never asked to produce these
  //   • requiresCurrentText / requiresProposedText: false → no
  //     publishable text (Act 4 Suggested Copy stays suppressed via
  //     existing review_decision row-type mapping)
  //   • elementTypeDomain: [] → no on-page element target
  //   • signalType: "off_page_seo" → existing constant
  //   • changelogAssetType: "directory_profile" → existing constant
  //   • operatorLabel: customer-safe full-form copy (no standalone
  //     "GBP", no "missing", no causal/revenue language)
  //
  // Detection lives on /diagnostics/off-site-authority (C7a).
  // Recommendation generation + customer surfaces defer to
  // C7c / C7d / C7e behind the multi-tenant prerequisite.
  claim_gbp: {
    actionType: "claim_gbp",
    elementTypeDomain: [],
    signalType: "off_page_seo",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "directory_profile",
    operatorLabel: "Claim your Google Business Profile",
    generatorActive: false,
  },
  optimize_gbp_profile: {
    actionType: "optimize_gbp_profile",
    elementTypeDomain: [],
    signalType: "off_page_seo",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "directory_profile",
    operatorLabel: "Optimize your Google Business Profile",
    generatorActive: false,
  },
  request_gbp_reviews: {
    actionType: "request_gbp_reviews",
    elementTypeDomain: [],
    signalType: "off_page_seo",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "directory_profile",
    operatorLabel: "Encourage new Google reviews",
    generatorActive: false,
  },
  claim_or_optimize_houzz: {
    actionType: "claim_or_optimize_houzz",
    elementTypeDomain: [],
    signalType: "off_page_seo",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "directory_profile",
    operatorLabel: "Claim or improve your Houzz profile",
    generatorActive: false,
  },
  claim_or_optimize_yelp: {
    actionType: "claim_or_optimize_yelp",
    elementTypeDomain: [],
    signalType: "off_page_seo",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "directory_profile",
    operatorLabel: "Claim or improve your Yelp profile",
    generatorActive: false,
  },
  submit_to_industry_directory: {
    actionType: "submit_to_industry_directory",
    elementTypeDomain: [],
    signalType: "off_page_seo",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "directory_profile",
    operatorLabel: "Submit to an industry directory",
    generatorActive: false,
  },
  pursue_local_pr: {
    actionType: "pursue_local_pr",
    elementTypeDomain: [],
    signalType: "off_page_seo",
    requiresCurrentText: false,
    requiresProposedText: false,
    changelogAssetType: "directory_profile",
    operatorLabel: "Pursue local press coverage",
    generatorActive: false,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns the spec for an action type. Panics (throws) on unknown input
 *  because the type system should prevent reaching here with a bad
 *  value — an `ActionType` is statically constrained. */
export function getActionTypeSpec(actionType: ActionType): ActionTypeSpec {
  const spec = ACTION_TYPE_REGISTRY[actionType];
  if (!spec) {
    throw new Error(
      `ACTION_TYPE_REGISTRY is missing a spec for "${actionType}" — registry/enum drift`,
    );
  }
  return spec;
}

/** Returns the subset of action types whose deterministic generator is
 *  live in v1. Sprint 6A.1 ships with exactly 3: edit_title,
 *  add_h2_section, add_faq. */
export function listActiveActionTypes(): ActionType[] {
  return ACTION_TYPES.filter(
    (t) => ACTION_TYPE_REGISTRY[t].generatorActive,
  );
}

/** Type guard — safely narrow an unknown string to ActionType. Useful
 *  at the provider-output validation boundary (6A.1.10) where LLM output
 *  arrives as unvalidated JSON. */
export function isValidActionType(s: unknown): s is ActionType {
  return (
    typeof s === "string" &&
    (ACTION_TYPES as readonly string[]).includes(s)
  );
}
