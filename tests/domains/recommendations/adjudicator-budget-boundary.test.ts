/**
 * wave-10 (2026-06-14) — adjudicator budget boundary is fail-closed AT the cap.
 *
 * Pre-fix `checkBudget` used only `spendUsd + projected > capUsd`. With the
 * default `projected = 0` (adjudicate.ts calls checkBudget without a projected
 * cost), a call made at spend EXACTLY == cap slipped through (`cap + 0 > cap`
 * is false), letting the adjudicator exceed its monthly cap by one call —
 * inconsistent with the native-polling path which blocks at `spent >= cap`.
 * `isOverAdjudicatorBudget` now blocks at-or-over the cap while still allowing
 * a KNOWN-cost call to land exactly on the cap from below.
 */
import { describe, expect, it } from "vitest";

import { isOverAdjudicatorBudget } from "@/domains/recommendations/adjudicator-budget";

describe("isOverAdjudicatorBudget — fail-closed at the cap", () => {
  it("allows spend below the cap (projected unknown / 0)", () => {
    expect(isOverAdjudicatorBudget(5, 0, 10)).toBe(false);
  });

  it("BLOCKS when spend is already EXACTLY at the cap (the wave-10 fix; projected=0)", () => {
    // Pre-fix: 10 + 0 > 10 === false -> wrongly ALLOWED. Now blocked.
    expect(isOverAdjudicatorBudget(10, 0, 10)).toBe(true);
  });

  it("blocks when spend is over the cap", () => {
    expect(isOverAdjudicatorBudget(12, 0, 10)).toBe(true);
  });

  it("still allows a known-cost call that lands EXACTLY on the cap from below", () => {
    // 5 + 5 = 10 == cap; not over -> allowed (not over-strict).
    expect(isOverAdjudicatorBudget(5, 5, 10)).toBe(false);
  });

  it("blocks a known-cost call that would push total OVER the cap", () => {
    expect(isOverAdjudicatorBudget(5, 6, 10)).toBe(true);
  });
});
