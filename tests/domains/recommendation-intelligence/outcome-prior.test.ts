/**
 * #10 learning loop (2026-06-22) — proof-ledger verdicts → per-action_type
 * priority prior, and the bounded priority-score term that consumes it.
 */
import { describe, it, expect } from "vitest";

import {
  computeOutcomePriors,
  MIN_OUTCOME_SAMPLES,
} from "@/domains/recommendation-intelligence/outcome-prior";
import {
  outcomePriorBonus,
  MAX_OUTCOME_PRIOR_BONUS,
} from "@/domains/recommendation-intelligence/priority-score";

const rec = (actionType: string, verdict: string) => ({ actionType, verdict });

describe("computeOutcomePriors — win rate → [-1,+1]", () => {
  it("all won → +1, all lost → -1, 50/50 → 0", () => {
    expect(
      computeOutcomePriors(Array.from({ length: 3 }, () => rec("edit_title", "won"))).get(
        "edit_title",
      ),
    ).toBe(1);
    expect(
      computeOutcomePriors(Array.from({ length: 3 }, () => rec("edit_title", "lost"))).get(
        "edit_title",
      ),
    ).toBe(-1);
    expect(
      computeOutcomePriors([
        rec("edit_title", "won"),
        rec("edit_title", "won"),
        rec("edit_title", "lost"),
        rec("edit_title", "lost"),
      ]).get("edit_title"),
    ).toBe(0);
  });

  it("stays neutral (absent) below MIN_OUTCOME_SAMPLES settled outcomes", () => {
    expect(MIN_OUTCOME_SAMPLES).toBe(3);
    const thin = computeOutcomePriors([rec("edit_meta", "won"), rec("edit_meta", "won")]); // n=2
    expect(thin.has("edit_meta")).toBe(false);
  });

  it("ignores measuring / inconclusive verdicts (only won+lost settle)", () => {
    const m = computeOutcomePriors([
      rec("section_add", "won"),
      rec("section_add", "won"),
      rec("section_add", "won"),
      rec("section_add", "measuring"),
      rec("section_add", "inconclusive"),
    ]);
    expect(m.get("section_add")).toBe(1); // 3 won / 0 lost
  });
});

describe("outcomePriorBonus — bounded, symmetric, priority-only", () => {
  it("scales [-1,+1] to ±MAX and is neutral on absent/NaN", () => {
    expect(outcomePriorBonus(1)).toBe(MAX_OUTCOME_PRIOR_BONUS);
    expect(outcomePriorBonus(-1)).toBe(-MAX_OUTCOME_PRIOR_BONUS);
    expect(outcomePriorBonus(0)).toBe(0);
    expect(outcomePriorBonus(undefined)).toBe(0);
    expect(outcomePriorBonus(Number.NaN)).toBe(0);
  });

  it("clamps out-of-range priors", () => {
    expect(outcomePriorBonus(5)).toBe(MAX_OUTCOME_PRIOR_BONUS);
    expect(outcomePriorBonus(-5)).toBe(-MAX_OUTCOME_PRIOR_BONUS);
  });
});
