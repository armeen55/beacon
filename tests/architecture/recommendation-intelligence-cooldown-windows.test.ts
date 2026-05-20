/**
 * Architecture invariant — Slice 4.5.D.α₀a.2 — cooldown-window
 * table pin (Section 4.5.O6 + α₀a.2 operator decision 2026-05-20).
 *
 * Pins the operator-locked window (in days) per
 * `ImplementationStatus` + the `no_prior` sentinel:
 *
 *   dismissed                 → 90
 *   accepted                  → 30
 *   verified_live             → 180
 *   verified_live_modified    → 180
 *   wrong_page                → 14
 *   partially_implemented     → 60
 *   needs_review              → 14
 *   recommended               → 0
 *   not_found_after_7d        → 0  (operator decision Q1)
 *   no_prior                  → 0  (sentinel)
 *
 * `verified_live_decay_refire` is NOT a real status today and
 * MUST NOT appear in the table — operator decision Q2.
 *
 * Drift requires explicit operator approval.
 */

import { describe, it, expect } from "vitest";

import {
  COOLDOWN_WINDOW_DAYS,
  getCooldownWindowForStatus,
} from "@/domains/recommendation-intelligence/dedupe-cooldown";

const LOCKED_WINDOWS = {
  dismissed: 90,
  accepted: 30,
  verified_live: 180,
  verified_live_modified: 180,
  wrong_page: 14,
  partially_implemented: 60,
  needs_review: 14,
  recommended: 0,
  not_found_after_7d: 0,
  no_prior: 0,
} as const;

describe("recommendation-intelligence-cooldown-windows", () => {
  it.each(Object.entries(LOCKED_WINDOWS))(
    "%s → %i days (locked)",
    (status, expected) => {
      expect(getCooldownWindowForStatus(status as never)).toBe(expected);
      expect(COOLDOWN_WINDOW_DAYS[status as keyof typeof LOCKED_WINDOWS]).toBe(
        expected,
      );
    },
  );

  it("table contains exactly the locked key set (no extras, no missing)", () => {
    const tableKeys = Object.keys(COOLDOWN_WINDOW_DAYS).sort();
    const lockedKeys = Object.keys(LOCKED_WINDOWS).sort();
    expect(tableKeys).toEqual(lockedKeys);
  });

  it("does NOT contain verified_live_decay_refire (Q2: not a real status today)", () => {
    expect(COOLDOWN_WINDOW_DAYS).not.toHaveProperty("verified_live_decay_refire");
  });

  it("not_found_after_7d is locked at 0 days (Q1: system verification state, not user rejection)", () => {
    expect(getCooldownWindowForStatus("not_found_after_7d")).toBe(0);
  });
});
