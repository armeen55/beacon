import { describe, it, expect } from "vitest";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import {
  computeDimPriors,
  resolvePrior,
  applyExperimentPriorToMoves,
  MIN_DECIDED,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  type SettledOutcome,
  type PriorDimension,
} from "./experiment-prior";

function outcome(verdict: string, dims: Partial<Record<PriorDimension, string>>, override?: string | null): SettledOutcome {
  return { verdict, dims, operatorVerdictOverride: override ?? null };
}
const won = (dims: Partial<Record<PriorDimension, string>>) => outcome("won", dims);
const lost = (dims: Partial<Record<PriorDimension, string>>) => outcome("lost", dims);

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

describe("computeDimPriors", () => {
  it("a won action_type earns a multiplier > 1 (boost)", () => {
    const t = computeDimPriors([won({ actionType: "add_answer_block" }), won({ actionType: "add_answer_block" }), won({ actionType: "add_answer_block" })]);
    const p = t.get("actionType:add_answer_block")!;
    expect(p.multiplier).toBeGreaterThan(1);
    expect(p.won).toBe(3);
    expect(p.winRate).toBe(1);
  });
  it("a lost action_type earns a multiplier < 1 (demote)", () => {
    const t = computeDimPriors([lost({ actionType: "edit_title" }), lost({ actionType: "edit_title" }), lost({ actionType: "edit_title" })]);
    expect(t.get("actionType:edit_title")!.multiplier).toBeLessThan(1);
  });
  it("INCONCLUSIVE / measuring results never create a prior", () => {
    const t = computeDimPriors([
      outcome("inconclusive", { actionType: "x" }),
      outcome("measuring", { actionType: "x" }),
      outcome("insufficient_data", { actionType: "x" }),
    ]);
    expect(t.size).toBe(0);
  });
  it("excludes operator-pinned (inconclusive override) outcomes from learning", () => {
    const t = computeDimPriors([won({ actionType: "x" }), won({ actionType: "x" }), outcome("won", { actionType: "x" }, "inconclusive")]);
    // only 2 decided wins remain → below MIN_DECIDED → no prior
    expect(t.has("actionType:x")).toBe(false);
  });
  it("needs >= MIN_DECIDED decided outcomes (one early result cannot bias)", () => {
    expect(MIN_DECIDED).toBeGreaterThanOrEqual(3);
    const t = computeDimPriors([won({ actionType: "y" }), won({ actionType: "y" })]); // 2 < MIN_DECIDED
    expect(t.has("actionType:y")).toBe(false);
  });
  it("is BOUNDED: an all-win streak is capped at MAX_MULTIPLIER", () => {
    const t = computeDimPriors(Array.from({ length: 10 }, () => won({ actionType: "z" })));
    expect(t.get("actionType:z")!.multiplier).toBe(MAX_MULTIPLIER);
  });
  it("is deterministic", () => {
    const ins = [won({ actionType: "a" }), won({ actionType: "a" }), lost({ actionType: "a" })];
    expect(computeDimPriors(ins).get("actionType:a")).toEqual(computeDimPriors(ins).get("actionType:a"));
  });
});

describe("resolvePrior — backoff ladder", () => {
  it("prefers the MOST specific proven dimension (queryCluster over actionType)", () => {
    const table = computeDimPriors([
      ...Array.from({ length: 3 }, () => lost({ actionType: "add_answer_block", queryCluster: "iran flag" })),
      ...Array.from({ length: 3 }, () => won({ actionType: "add_answer_block" })),
    ]);
    // queryCluster bucket (lost) is more specific than actionType (won) → demote wins
    const p = resolvePrior({ queryCluster: "iran flag", actionType: "add_answer_block" }, table);
    expect(p.basis).toBe("queryCluster:iran flag");
    expect(p.multiplier).toBeLessThan(1);
  });
  it("backs off to actionType when the specific bucket is unproven", () => {
    const table = computeDimPriors(Array.from({ length: 3 }, () => won({ actionType: "add_answer_block" })));
    const p = resolvePrior({ queryCluster: "novel topic", actionType: "add_answer_block" }, table);
    expect(p.basis).toBe("actionType:add_answer_block");
    expect(p.tag).toContain("ranked higher");
  });
  it("NO EVIDENCE → neutral (no fake learning)", () => {
    const p = resolvePrior({ actionType: "anything" }, new Map());
    expect(p.multiplier).toBe(1);
    expect(p.basis).toBeNull();
    expect(p.tag).toBeNull();
  });
});

describe("applyExperimentPriorToMoves", () => {
  const resolveDims = (m: MoveCandidate) => ({ actionType: m.gap, queryCluster: m.label });

  it("with NO outcomes leaves scores + order byte-identical (zero-risk rollout)", () => {
    const moves = [move({ demandKey: "a", score: 900 }), move({ demandKey: "b", score: 1000 })];
    const out = applyExperimentPriorToMoves(moves, [], resolveDims);
    expect(out.map((m) => [m.demandKey, m.score])).toEqual([["b", 1000], ["a", 900]]);
    expect(out.every((m) => m.learnedPrior?.multiplier === 1)).toBe(true);
  });

  it("boosts a won pattern, demotes a lost one, and re-sorts — components untouched", () => {
    const outcomes = [
      ...Array.from({ length: 3 }, () => won({ actionType: "answer_block" })),
      ...Array.from({ length: 3 }, () => lost({ actionType: "edit_page" })),
    ];
    const moves = [
      move({ demandKey: "won-move", gap: "answer_block", score: 1000, components: { demand: 1000, winnability: 0.8, dollarValue: 0, visibilityGap: 0.5, friction: 0 } }),
      move({ demandKey: "lost-move", gap: "edit_page", score: 1010 }),
    ];
    const out = applyExperimentPriorToMoves(moves, outcomes, (m) => ({ actionType: m.gap }));
    const wonM = out.find((m) => m.demandKey === "won-move")!;
    const lostM = out.find((m) => m.demandKey === "lost-move")!;
    expect(wonM.score).toBeGreaterThan(1000); // boosted
    expect(lostM.score).toBeLessThan(1010); // demoted
    // raw components are the lie detector — never mutated
    expect(wonM.components.demand).toBe(1000);
    // the boosted won-move now outranks the (higher-raw) lost-move
    expect(out[0]!.demandKey).toBe("won-move");
  });

  it("respects the bound: even a strong prior shifts score by <= 15%", () => {
    const outcomes = Array.from({ length: 8 }, () => won({ actionType: "answer_block" }));
    const out = applyExperimentPriorToMoves([move({ gap: "answer_block", score: 1000 })], outcomes, (m) => ({ actionType: m.gap }));
    expect(out[0]!.score).toBeLessThanOrEqual(Math.round(1000 * MAX_MULTIPLIER));
    expect(out[0]!.score).toBeGreaterThanOrEqual(Math.round(1000 * MIN_MULTIPLIER));
  });
});
