/**
 * Phase A.1 Step 2 — citation-lifecycle eligibility predicate tests.
 *
 * Locked truth table per Section 2 Decision Lock (D1 / D2). Every
 * value of the 9-status enum is exercised, plus the cross-cuts of
 * `live_at` / `target_url` shapes.
 *
 * The predicate output is intentionally structural (not bare boolean)
 * so these tests can pin BOTH the eligibility decision AND the
 * disqualification reason. A future change that flips a reason
 * silently (eligible → eligible but with a different reason) will
 * trip these tests.
 */

import { describe, expect, it } from "vitest";

import {
  getTimeToCitationEligibility,
  isEligibleForTimeToCitation,
  type TimeToCitationEligibilityInput,
} from "@/domains/citation-lifecycle/eligibility";

const VALID_LIVE_AT = "2026-05-01T07:00:00.000Z";
const VALID_TARGET_URL = "https://ritzbuilders.com/services/whole-home-remodel";

function row(
  overrides: Partial<TimeToCitationEligibilityInput> = {},
): TimeToCitationEligibilityInput {
  return {
    implementation_status: "verified_live",
    live_at: VALID_LIVE_AT,
    target_url: VALID_TARGET_URL,
    ...overrides,
  };
}

describe("citation-lifecycle eligibility — locked truth table (Phase A.1 §2.1 / D1 / D2)", () => {
  // ─────────────────────────────────────────────────────────────────
  // Eligible cases
  // ─────────────────────────────────────────────────────────────────

  it("case 1: verified_live + live_at + valid target_url ⇒ eligible_verified_live", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "verified_live" }),
    );
    expect(verdict).toEqual({
      eligible: true,
      is_partial_live: false,
      reason: "eligible_verified_live",
    });
    expect(isEligibleForTimeToCitation(row({ implementation_status: "verified_live" }))).toBe(true);
  });

  it("case 2: verified_live_modified + live_at + valid target_url ⇒ eligible_verified_live_modified", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "verified_live_modified" }),
    );
    expect(verdict).toEqual({
      eligible: true,
      is_partial_live: false,
      reason: "eligible_verified_live_modified",
    });
  });

  it("case 3: partially_implemented + live_at + valid target_url ⇒ eligible_partial_live with is_partial_live: true (D1)", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "partially_implemented" }),
    );
    expect(verdict).toEqual({
      eligible: true,
      is_partial_live: true,
      reason: "eligible_partial_live",
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // wrong_page — short-circuits even with live_at (D2)
  // ─────────────────────────────────────────────────────────────────

  it("case 4: wrong_page is excluded even when live_at and target_url are present (D2)", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "wrong_page" }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "excluded_wrong_page",
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Non-eligible statuses (each from the locked enum)
  // ─────────────────────────────────────────────────────────────────

  it("case 5: recommended is excluded", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "recommended" }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "excluded_status",
    });
  });

  it("case 6: accepted is excluded", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "accepted" }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "excluded_status",
    });
  });

  it("case 7: needs_review is excluded", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "needs_review" }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "excluded_status",
    });
  });

  it("case 8: dismissed is excluded", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "dismissed" }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "excluded_status",
    });
  });

  it("case 9: not_found_after_7d is excluded", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "not_found_after_7d" }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "excluded_status",
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Missing required fields — even with an eligible status
  // ─────────────────────────────────────────────────────────────────

  it("case 10: verified_live with null live_at ⇒ missing_live_at", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "verified_live", live_at: null }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "missing_live_at",
    });
  });

  it("case 10b: verified_live with undefined live_at ⇒ missing_live_at", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "verified_live", live_at: undefined }),
    );
    expect(verdict.reason).toBe("missing_live_at");
    expect(verdict.eligible).toBe(false);
  });

  it("case 11: verified_live with null target_url ⇒ missing_target_url", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "verified_live", target_url: null }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "missing_target_url",
    });
  });

  it("case 12: verified_live with target_url = 'needs_new_page' ⇒ needs_new_page", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "verified_live", target_url: "needs_new_page" }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "needs_new_page",
    });
  });

  it("case 13: partially_implemented with null live_at ⇒ missing_live_at (D1 doesn't override the live_at gate)", () => {
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: "partially_implemented", live_at: null }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "missing_live_at",
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Fail-closed on undefined / unknown status
  // ─────────────────────────────────────────────────────────────────

  it("case 14: undefined implementation_status fails closed via editLifecycleStatus default (excluded_status)", () => {
    // Legacy-file rows lack `implementation_status`. The persistence
    // helper defaults them to `"recommended"` — which the predicate
    // excludes. Defensive: a missing status MUST NOT become eligible
    // even with otherwise-valid live_at + target_url.
    const verdict = getTimeToCitationEligibility(
      row({ implementation_status: undefined }),
    );
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "excluded_status",
    });
  });

  it("case 14b: structurally-unknown status string fails closed (excluded_status)", () => {
    // Cast through unknown to simulate a future schema addition that
    // hasn't been wired into the eligibility module yet. The predicate
    // must NOT silently accept it.
    const unknownStatusRow = row({
      implementation_status: "future_status_not_yet_defined" as never,
    });
    const verdict = getTimeToCitationEligibility(unknownStatusRow);
    expect(verdict).toEqual({
      eligible: false,
      is_partial_live: false,
      reason: "excluded_status",
    });
  });

  // ─────────────────────────────────────────────────────────────────
  // Boolean convenience wrapper
  // ─────────────────────────────────────────────────────────────────

  it("isEligibleForTimeToCitation tracks the .eligible field of the full record", () => {
    expect(
      isEligibleForTimeToCitation(
        row({ implementation_status: "verified_live_modified" }),
      ),
    ).toBe(true);
    expect(
      isEligibleForTimeToCitation(row({ implementation_status: "wrong_page" })),
    ).toBe(false);
    expect(
      isEligibleForTimeToCitation(
        row({ implementation_status: "verified_live", live_at: null }),
      ),
    ).toBe(false);
  });
});
