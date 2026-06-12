/**
 * Architecture invariant — Slice 4.5.D.α₀a — promotion-
 * eligibility table pin.
 *
 * The (trigger_signal, action_type) → eligibility tier table is
 * the SINGLE source of truth for which predicates may eventually
 * promote to the customer queue. Any drift requires an explicit
 * operator decision; this invariant pins the exact entries.
 *
 * Includes the critical α₃b operator correction:
 *   robots_blocks_ai_bots → fix_robots (NOT fix_noindex).
 */

import { describe, it, expect } from "vitest";

import {
  PROMOTION_ELIGIBILITY_TABLE,
  eligibilityForTrigger,
} from "@/domains/recommendation-intelligence/promotion-eligibility";

const LOCKED_TABLE: ReadonlyArray<readonly [string, string]> = [
  // customer-queue-ready (13)
  ["missing_title::edit_title", "customer-queue-ready"],
  ["missing_meta::edit_meta", "customer-queue-ready"],
  ["missing_h1::change_h1", "customer-queue-ready"],
  ["sitemap_missing::fix_sitemap", "customer-queue-ready"],
  ["robots_blocks_googlebot::fix_robots", "customer-queue-ready"],
  ["bad_http_status::fix_status_code", "customer-queue-ready"],
  // Content Schema Engine (2026-06-12): the content-page branch of
  // missing-schema. Distinct from the builder-tuned `missing_schema`
  // signal (still diagnostic-only below): no industry-tuned types
  // (Article has no required properties per Google's Article doc),
  // store pages guarded out via Product-schema detection, and the
  // deterministic JSON-LD draft is pinned against the scanner's own
  // validateSchema(). See promotion-eligibility.ts for rationale.
  ["missing_schema_content::add_schema", "customer-queue-ready"],
  // fix_schema slice (2026-06-12): repair candidates from the
  // scanner's own validator output — directive-draft family
  // (fix_canonical/fix_robots precedent).
  ["invalid_schema::fix_schema", "customer-queue-ready"],
  // Insight Graph slice 1 (2026-06-12): GSC low-CTR fused signal.
  ["gsc_low_ctr::edit_title", "customer-queue-ready"],
  ["semrush_striking_distance::edit_title", "customer-queue-ready"],
  ["missing_schema_store::add_schema", "customer-queue-ready"],
  ["gsc_striking_distance::edit_title", "customer-queue-ready"],
  ["gsc_decay::update_intro", "customer-queue-ready"],

  // operator-review-only (9)
  ["duplicate_title::edit_title", "operator-review-only"],
  ["duplicate_meta::edit_meta", "operator-review-only"],
  ["canonical_mismatch::fix_canonical", "operator-review-only"],
  ["orphan_page::add_internal_link", "operator-review-only"],
  ["title_h1_mismatch::edit_title", "operator-review-only"],
  ["title_h1_mismatch::change_h1", "operator-review-only"],
  ["weak_h1::change_h1", "operator-review-only"],
  ["semrush_cannibalization::add_internal_link", "operator-review-only"],
  ["semrush_keyword_gap::create_page", "operator-review-only"],

  // diagnostic-only (4)
  ["missing_schema::add_schema", "diagnostic-only"],
  ["noindex_on_indexable_page::fix_noindex", "diagnostic-only"],
  ["robots_blocks_ai_bots::fix_robots", "diagnostic-only"],
  // Slice 4.5.E.α₁a (2026-05-21) — first LLM-assisted pair.
  // Operator-locked to diagnostic-only; α₀ gateway drafts proposed
  // text via the α₁b env-gated server action; no customer-queue
  // path in α₁a.
  ["weak_h2::rewrite_h2", "diagnostic-only"],
] as const;

describe("recommendation-intelligence-promotion-eligibility-pin", () => {
  it("table size matches LOCKED entry count", () => {
    expect(PROMOTION_ELIGIBILITY_TABLE.size).toBe(LOCKED_TABLE.length);
  });

  it.each(LOCKED_TABLE)("entry %s → %s is pinned", (key, expectedTier) => {
    expect(PROMOTION_ELIGIBILITY_TABLE.get(key)).toBe(expectedTier);
  });

  it("contains no entries beyond the locked set", () => {
    const lockedKeys = new Set(LOCKED_TABLE.map(([k]) => k));
    const extras: string[] = [];
    for (const k of PROMOTION_ELIGIBILITY_TABLE.keys()) {
      if (!lockedKeys.has(k)) extras.push(k);
    }
    expect(
      extras,
      `Extras in PROMOTION_ELIGIBILITY_TABLE not present in LOCKED_TABLE: ${extras.join(", ")}`,
    ).toEqual([]);
  });

  it("robots_blocks_ai_bots maps to fix_robots, NOT fix_noindex (operator correction)", () => {
    expect(eligibilityForTrigger("robots_blocks_ai_bots", "fix_robots")).toBe(
      "diagnostic-only",
    );
    expect(eligibilityForTrigger("robots_blocks_ai_bots", "fix_noindex")).toBe(
      "blocked",
    );
  });
});
