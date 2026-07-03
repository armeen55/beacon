/**
 * beacon-learned-summary.test.ts (R23 P15) - pins the ONE honest sentence:
 * decided-only, self-hiding below the floor, Beacon voice (first person, a number
 * in every clause, no lab words, no dashes), and the win/laggard math.
 */
import { describe, expect, it } from "vitest";

import type { SettledOutcome } from "@/domains/learning/experiment-prior";
import {
  buildBeaconLearnedSummary,
  MIN_DECIDED_FOR_SUMMARY,
} from "./beacon-learned-summary";

const BANNED_DASH = /[\u2012\u2013\u2014\u2015]/;
const LAB_WORDS = /\b(prior|multiplier|bucket|control|baseline|treatment|experiment)\b/i;

function outcome(verdict: string, actionType: string, override?: string | null): SettledOutcome {
  return {
    verdict,
    operatorVerdictOverride: override ?? null,
    dims: { actionType },
  };
}

describe("self-hide contract", () => {
  it("returns a null sentence with fewer than the floor of decided outcomes", () => {
    const s = buildBeaconLearnedSummary([outcome("won", "answer_block"), outcome("won", "answer_block")]);
    expect(s.sentence).toBeNull();
    expect(s.decidedTotal).toBe(2);
  });

  it("ignores measuring / operator-excluded when counting decided", () => {
    const s = buildBeaconLearnedSummary([
      outcome("won", "answer_block"),
      outcome("measuring", "answer_block"),
      outcome("lost", "answer_block", "inconclusive"),
    ]);
    expect(s.decidedTotal).toBe(1); // only the one real won
    expect(s.sentence).toBeNull();
  });

  it("MIN_DECIDED_FOR_SUMMARY is 3", () => {
    expect(MIN_DECIDED_FOR_SUMMARY).toBe(3);
  });
});

describe("the sentence", () => {
  it("names a clear WINNER with concrete counts, first person", () => {
    // answer_block: 4 won, 1 lost → 80% over 5 decided
    const outcomes: SettledOutcome[] = [
      ...Array.from({ length: 4 }, () => outcome("won", "answer_block")),
      outcome("lost", "answer_block"),
    ];
    const s = buildBeaconLearnedSummary(outcomes);
    expect(s.sentence).toContain("I've learned your answer-block changes win most often (4 of 5 measured)");
    expect(s.sentence).toContain("putting them higher");
    expect(s.winner?.kind).toBe("answer_block");
  });

  it("owns a LAGGARD plainly alongside the winner", () => {
    const outcomes: SettledOutcome[] = [
      ...Array.from({ length: 4 }, () => outcome("won", "answer_block")),
      outcome("lost", "answer_block"),
      // edit_page: 0 won, 3 lost → 0%
      ...Array.from({ length: 3 }, () => outcome("lost", "edit_page")),
    ];
    const s = buildBeaconLearnedSummary(outcomes);
    expect(s.sentence).toContain("have not moved the needle (0 of 3)");
    expect(s.sentence).toContain("easing off them");
    expect(s.laggard?.kind).toBe("edit_page");
  });

  it("stays hidden when every decided kind is a coin-flip (no honest claim)", () => {
    // one kind, 3 decided, 50/50-ish (not >= 0.6, not <= 0.4 after rounding)
    const outcomes: SettledOutcome[] = [
      outcome("won", "answer_block"),
      outcome("won", "answer_block"),
      outcome("lost", "answer_block"),
      outcome("lost", "answer_block"),
    ]; // 2/4 = 0.5 exactly
    const s = buildBeaconLearnedSummary(outcomes);
    expect(s.decidedTotal).toBe(4);
    expect(s.sentence).toBeNull();
  });

  it("Beacon voice: no lab words, no dashes", () => {
    const outcomes: SettledOutcome[] = [
      ...Array.from({ length: 4 }, () => outcome("won", "answer_block")),
      outcome("lost", "answer_block"),
      ...Array.from({ length: 3 }, () => outcome("lost", "edit_page")),
    ];
    const s = buildBeaconLearnedSummary(outcomes);
    expect(s.sentence).not.toMatch(BANNED_DASH);
    expect(s.sentence).not.toMatch(LAB_WORDS);
  });
});
