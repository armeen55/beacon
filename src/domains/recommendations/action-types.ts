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
 * v1 policy: full 22-type universe registered; only 3 have
 * `generatorActive: true` (edit_title, add_h2_section, add_faq). The
 * rest ship as registered-but-inactive so the provider-adapter knows the
 * space of valid outputs from day one — the LLM path (6A.2) will flip
 * them on without changing any caller.
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
    generatorActive: false,
  },
  change_h1: {
    actionType: "change_h1",
    elementTypeDomain: ["h1"],
    signalType: "content",
    requiresCurrentText: true,
    requiresProposedText: true,
    changelogAssetType: "service_page",
    operatorLabel: "Change H1",
    generatorActive: false,
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
