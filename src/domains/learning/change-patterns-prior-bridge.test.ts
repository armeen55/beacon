/**
 * RANK-1 (2026-07-06): change-patterns.ts feeds the ONE outcome prior.
 *
 * These pin the bridge that reduces the dormant per-(signal x asset) success-rate
 * patterns into the SAME dimension-keyed SettledOutcome[] the win-rate prior
 * consumes, so change-patterns strengthens that ONE bounded multiplier instead of
 * being a second, parallel prior:
 *   - a pattern below its own >= MIN_DECIDED sample floor contributes NOTHING
 *     (neutral by absence) → an undecided tenant stays byte-identical;
 *   - a qualifying pattern flows through computeDimPriors' identical win-rate math
 *     and [0.85, 1.15] clamp, and CAN move ranking when its own bucket clears the
 *     floor;
 *   - the input patterns are never mutated (no history rewrite).
 */

import { describe, it, expect } from "vitest";
import type { ChangePattern } from "./change-patterns";
import { changePatternsToOutcomes } from "./change-patterns";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import {
  computeDimPriors,
  applyExperimentPriorToMoves,
  MIN_DECIDED,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
} from "./experiment-prior";

function pattern(over: Partial<ChangePattern> = {}): ChangePattern {
  return {
    id: "faq::city_page",
    signal_type: "faq",
    asset_type: "city_page",
    sample_count: 5,
    success_count: 5,
    success_rate: 1,
    avg_citation_delta: 0,
    avg_mention_delta: 0,
    avg_days_to_signal: 0,
    platform_response: {},
    engine_timing: [],
    confidence: "high",
    computed_at: "2026-07-06T00:00:00.000Z",
    ...over,
  };
}

function move(over: Partial<MoveCandidate> = {}): MoveCandidate {
  return {
    demandKey: "k",
    label: "iran flag",
    gap: "answer_block",
    score: 1000,
    components: { demand: 1000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
    confidence: "medium",
    signals: ["GSC"],
    ownedUrl: "https://iranopedia.com/iran-flags",
    competitorUrls: [],
    fanoutSeeds: [],
    rationale: "",
    ...over,
  };
}

describe("changePatternsToOutcomes — the bridge into the ONE prior", () => {
  it("empty patterns → [] (a fresh tenant adds nothing to the prior)", () => {
    expect(changePatternsToOutcomes([])).toEqual([]);
  });

  it("a pattern BELOW the sample floor contributes NOTHING (byte-identical prior)", () => {
    // 2 samples < MIN_DECIDED (3) → omitted.
    const out = changePatternsToOutcomes([pattern({ sample_count: 2, success_count: 2 })]);
    expect(out).toEqual([]);
  });

  it("expands a qualifying pattern into won + lost synthetic decided outcomes on actionType", () => {
    // 5 samples, 4 successes → 4 won + 1 lost, all keyed on canonical actionType.
    const out = changePatternsToOutcomes([pattern({ sample_count: 5, success_count: 4 })]);
    expect(out).toHaveLength(5);
    expect(out.filter((o) => o.verdict === "won")).toHaveLength(4);
    expect(out.filter((o) => o.verdict === "lost")).toHaveLength(1);
    // faq canonicalizes to the answer_block move kind (question-shaped content).
    expect(out.every((o) => o.dims.actionType === "answer_block")).toBe(true);
  });

  it("guards malformed rows: success_count can never exceed sample_count", () => {
    const out = changePatternsToOutcomes([pattern({ sample_count: 3, success_count: 99 })]);
    expect(out.filter((o) => o.verdict === "won")).toHaveLength(3);
    expect(out.filter((o) => o.verdict === "lost")).toHaveLength(0);
  });

  it("NEVER mutates the input patterns (no history rewrite)", () => {
    const p = pattern({ sample_count: 5, success_count: 4 });
    const before = JSON.stringify(p);
    changePatternsToOutcomes([p]);
    expect(JSON.stringify(p)).toBe(before);
  });

  it("feeds the SAME computeDimPriors math (a winning pattern earns a >1, bounded multiplier)", () => {
    const out = changePatternsToOutcomes([pattern({ sample_count: 5, success_count: 5 })]);
    const table = computeDimPriors(out);
    const prior = table.get("actionType:answer_block")!;
    expect(prior.won).toBe(5);
    expect(prior.decided).toBe(5);
    expect(prior.multiplier).toBeGreaterThan(1);
    expect(prior.multiplier).toBeLessThanOrEqual(MAX_MULTIPLIER);
  });

  it("a losing pattern earns a <1 multiplier, still inside the bounded band", () => {
    const out = changePatternsToOutcomes([pattern({ sample_count: 4, success_count: 0 })]);
    const prior = computeDimPriors(out).get("actionType:answer_block")!;
    expect(prior.multiplier).toBeLessThan(1);
    expect(prior.multiplier).toBeGreaterThanOrEqual(MIN_MULTIPLIER);
  });
});

describe("change-patterns feeding the prior end-to-end (concatenated with ledger outcomes)", () => {
  const resolveDims = (m: MoveCandidate) => ({ actionType: m.gap });

  it("with ONLY thin patterns, ranking stays byte-identical (undecided tenant pin)", () => {
    const patternOutcomes = changePatternsToOutcomes([pattern({ sample_count: 2, success_count: 2 })]);
    const moves = [move({ demandKey: "a", score: 900, gap: "answer_block" }), move({ demandKey: "b", score: 1000, gap: "answer_block" })];
    const out = applyExperimentPriorToMoves(moves, patternOutcomes, resolveDims);
    expect(out.map((m) => [m.demandKey, m.score])).toEqual([["b", 1000], ["a", 900]]);
    expect(out.every((m) => m.learnedPrior?.multiplier === 1)).toBe(true);
  });

  it("a qualifying WIN pattern boosts a matching move (change-patterns actually moves rank)", () => {
    const patternOutcomes = changePatternsToOutcomes([pattern({ signal_type: "faq", sample_count: 6, success_count: 6 })]);
    const out = applyExperimentPriorToMoves([move({ gap: "answer_block", score: 1000 })], patternOutcomes, resolveDims);
    expect(out[0]!.score).toBeGreaterThan(1000);
    expect(out[0]!.score).toBeLessThanOrEqual(Math.round(1000 * MAX_MULTIPLIER));
    // raw components stay the lie detector — never mutated
    expect(out[0]!.components.demand).toBe(1000);
    // and the visible line is present + honest
    expect(out[0]!.learnedPrior?.tag).toContain("I moved this up");
  });

  it("change-patterns and the ledger MERGE in one bucket (same dimension space, one prior)", () => {
    // 2 ledger wons (thin alone) + a 1-sample pattern won → still thin (3 total but
    // MIN_DECIDED is inclusive) so prove the merge by pushing to 3 decided total.
    const ledger = [
      { verdict: "won", dims: { actionType: "answer_block" }, operatorVerdictOverride: null },
      { verdict: "won", dims: { actionType: "answer_block" }, operatorVerdictOverride: null },
    ];
    const patternOutcomes = changePatternsToOutcomes([pattern({ signal_type: "faq", sample_count: 3, success_count: 3 })]);
    // Neither source alone would necessarily clear the floor for the merged story,
    // but concatenated they compute ONE bucket via ONE computeDimPriors.
    const table = computeDimPriors([...ledger, ...patternOutcomes]);
    const prior = table.get("actionType:answer_block")!;
    expect(prior.decided).toBe(2 + 3); // ledger + pattern share the bucket
    expect(prior.won).toBe(5);
    expect(MIN_DECIDED).toBeLessThanOrEqual(prior.decided);
  });
});
