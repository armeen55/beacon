/**
 * 2026-05-20 — Slice 4.5.D.α₀a — promotion-eligibility table tests.
 *
 * Verifies the locked (trigger_signal, action_type) → tier
 * mapping. Pinning of the canonical table shape is in
 * `tests/architecture/recommendation-intelligence-promotion-
 * eligibility-pin.test.ts`.
 */

import { describe, it, expect } from "vitest";

import {
  eligibilityForTrigger,
  listCustomerQueueReadyPairs,
  PROMOTION_ELIGIBILITY_TABLE,
  type EligibilityTier,
} from "@/domains/recommendation-intelligence/promotion-eligibility";

describe("promotion-eligibility / eligibilityForTrigger", () => {
  // ── customer-queue-ready ────────────────────────────────────
  it.each([
    ["missing_title", "edit_title"],
    ["missing_meta", "edit_meta"],
    ["missing_h1", "change_h1"],
    ["sitemap_missing", "fix_sitemap"],
    ["robots_blocks_googlebot", "fix_robots"],
    ["bad_http_status", "fix_status_code"],
  ] as const)(
    "returns customer-queue-ready for %s::%s",
    (signal, actionType) => {
      expect(eligibilityForTrigger(signal, actionType)).toBe(
        "customer-queue-ready" as EligibilityTier,
      );
    },
  );

  // ── operator-review-only ────────────────────────────────────
  it.each([
    ["duplicate_title", "edit_title"],
    ["duplicate_meta", "edit_meta"],
    ["canonical_mismatch", "fix_canonical"],
    ["orphan_page", "add_internal_link"],
    ["title_h1_mismatch", "edit_title"],
    ["title_h1_mismatch", "change_h1"],
    ["weak_h1", "change_h1"],
  ] as const)(
    "returns operator-review-only for %s::%s",
    (signal, actionType) => {
      expect(eligibilityForTrigger(signal, actionType)).toBe(
        "operator-review-only" as EligibilityTier,
      );
    },
  );

  // ── diagnostic-only ─────────────────────────────────────────
  it.each([
    ["missing_schema", "add_schema"],
    ["noindex_on_indexable_page", "fix_noindex"],
    // Operator correction (2026-05-20): robots_blocks_ai_bots
    // remediation is a robots.txt edit, so action_type is
    // fix_robots (NOT fix_noindex).
    ["robots_blocks_ai_bots", "fix_robots"],
  ] as const)("returns diagnostic-only for %s::%s", (signal, actionType) => {
    expect(eligibilityForTrigger(signal, actionType)).toBe(
      "diagnostic-only" as EligibilityTier,
    );
  });

  // ── blocked: unknown pairs ──────────────────────────────────
  it("returns blocked for an unknown trigger_signal", () => {
    expect(eligibilityForTrigger("unknown_signal_xyz", "edit_title")).toBe(
      "blocked",
    );
  });

  it("returns blocked for a known signal paired with the wrong action_type", () => {
    // missing_title → edit_title is the locked pair. Pairing
    // missing_title with change_h1 is blocked.
    expect(eligibilityForTrigger("missing_title", "change_h1")).toBe("blocked");
  });

  // ── blocked: off-site action types ──────────────────────────
  it.each([
    "claim_gbp",
    "optimize_gbp_profile",
    "request_gbp_reviews",
    "claim_or_optimize_houzz",
    "claim_or_optimize_yelp",
    "submit_to_industry_directory",
    "pursue_local_pr",
  ] as const)("returns blocked for off-site action type %s", (actionType) => {
    // Even paired with a hypothetical signal, off-site is blocked.
    expect(eligibilityForTrigger("missing_title", actionType)).toBe("blocked");
  });

  // ── robots_blocks_ai_bots correction (CRITICAL) ─────────────
  it("robots_blocks_ai_bots must NOT map to fix_noindex (operator correction)", () => {
    expect(eligibilityForTrigger("robots_blocks_ai_bots", "fix_noindex")).toBe(
      "blocked",
    );
  });

  it("robots_blocks_ai_bots maps to fix_robots in diagnostic-only", () => {
    expect(eligibilityForTrigger("robots_blocks_ai_bots", "fix_robots")).toBe(
      "diagnostic-only",
    );
  });
});

describe("promotion-eligibility / listCustomerQueueReadyPairs", () => {
  it("returns exactly the 6 customer-queue-ready pairs in stable order", () => {
    const pairs = listCustomerQueueReadyPairs();
    expect(pairs).toEqual([
      "missing_title::edit_title",
      "missing_meta::edit_meta",
      "missing_h1::change_h1",
      "sitemap_missing::fix_sitemap",
      "robots_blocks_googlebot::fix_robots",
      "bad_http_status::fix_status_code",
    ]);
  });
});

describe("promotion-eligibility / table snapshot", () => {
  it("table size matches the locked entry count (16)", () => {
    // 6 customer-queue-ready + 7 operator-review-only + 3 diagnostic-only = 16
    expect(PROMOTION_ELIGIBILITY_TABLE.size).toBe(16);
  });
});
