import { describe, expect, it } from "vitest";

import { hurtingTrendSuffix } from "./today-data-lite";

/**
 * T-WorseningSuffix (2026-05-08) — narrow regression test for the
 * `hurtingTrendSuffix` helper. Pre-T-WorseningSuffix, the hurting
 * action card on /today appended " · worsening" whenever
 * `transitions > 1`. That was direction-blind: the recorder
 * increments transitions on ANY material change including demotion
 * paths where the row is recovering toward zero. Calling that
 * "worsening" was fake certainty.
 *
 * Until verdict_history is persisted (recorder schema add, deferred),
 * the helper must return "" for every input — see `today-data.ts`
 * doc comment on `hurtingTrendSuffix`. This test enforces that
 * contract so a future regression that re-introduces the
 * direction-blind suffix fails CI.
 */
describe("hurtingTrendSuffix", () => {
  it("returns empty string for transitions = 0", () => {
    expect(hurtingTrendSuffix({ transitions: 0 })).toBe("");
  });

  it("returns empty string for transitions = 1", () => {
    expect(hurtingTrendSuffix({ transitions: 1 })).toBe("");
  });

  it("returns empty string for transitions = 2 (the pre-T-WorseningSuffix trip threshold)", () => {
    expect(hurtingTrendSuffix({ transitions: 2 })).toBe("");
  });

  it("returns empty string for high transitions counts", () => {
    expect(hurtingTrendSuffix({ transitions: 10 })).toBe("");
    expect(hurtingTrendSuffix({ transitions: 100 })).toBe("");
  });

  it("never returns the literal word 'worsening' (operator-locked: direction-blind suffix forbidden)", () => {
    for (const n of [0, 1, 2, 3, 5, 10, 50]) {
      expect(hurtingTrendSuffix({ transitions: n })).not.toContain("worsening");
    }
  });

  it("never returns the literal word 'improving' (the inverse error mode is also forbidden)", () => {
    for (const n of [0, 1, 2, 3, 5, 10, 50]) {
      expect(hurtingTrendSuffix({ transitions: n })).not.toContain("improving");
    }
  });
});
