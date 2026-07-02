import { describe, it, expect } from "vitest";
import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import {
  computeDimPriors,
  resolvePrior,
  applyExperimentPriorToMoves,
  lookupGlobalCell,
  MIN_DECIDED,
  MAX_MULTIPLIER,
  MIN_MULTIPLIER,
  GLOBAL_MIN_MULTIPLIER,
  GLOBAL_MAX_MULTIPLIER,
  MIN_DISTINCT_TENANTS_FOR_GLOBAL,
  type SettledOutcome,
  type PriorDimension,
  type GlobalCell,
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

// ---------------------------------------------------------------------------
// Cross-tenant global backoff (BEACON_500 item 66)
// ---------------------------------------------------------------------------

function globalCell(over: Partial<GlobalCell> = {}): GlobalCell {
  return { n: 12, distinctTenants: 5, winRate: 0.75, liftLow: 5, liftHigh: 30, ...over };
}

describe("lookupGlobalCell — distinct-tenant floor", () => {
  it("returns null when no cell exists for the dimension/value", () => {
    expect(lookupGlobalCell("actionType", "answer_block", () => undefined)).toBeNull();
  });
  it("returns null (suppressed) when distinctTenants is below the floor", () => {
    expect(MIN_DISTINCT_TENANTS_FOR_GLOBAL).toBe(3);
    const cell = globalCell({ distinctTenants: 2 });
    expect(lookupGlobalCell("actionType", "answer_block", () => cell)).toBeNull();
  });
  it("returns null at distinctTenants=1 (the honest single-tenant-today state)", () => {
    const cell = globalCell({ distinctTenants: 1 });
    expect(lookupGlobalCell("actionType", "answer_block", () => cell)).toBeNull();
  });
  it("returns the cell once distinctTenants meets the floor", () => {
    const cell = globalCell({ distinctTenants: 3 });
    expect(lookupGlobalCell("actionType", "answer_block", () => cell)).toEqual(cell);
  });
});

describe("resolvePrior — global backoff (opt-in, tenant ladder exhausted only)", () => {
  it("is BYTE-IDENTICAL to pre-item-66 behavior when no globalLookup is passed", () => {
    const table = computeDimPriors([won({ actionType: "answer_block" }), won({ actionType: "answer_block" }), won({ actionType: "answer_block" })]);
    const withoutArg = resolvePrior({ actionType: "unrelated_type" }, table);
    expect(withoutArg).toEqual({ multiplier: 1, decidedSample: 0, basis: null, tag: null });
  });

  it("is IDENTITY when the global table is empty (globalLookup always returns undefined)", () => {
    const p = resolvePrior({ actionType: "answer_block" }, new Map(), () => undefined);
    expect(p).toEqual({ multiplier: 1, decidedSample: 0, basis: null, tag: null });
  });

  it("never consults the global table when the TENANT'S OWN cell is already proven", () => {
    const table = computeDimPriors([won({ actionType: "answer_block" }), won({ actionType: "answer_block" }), won({ actionType: "answer_block" })]);
    let globalLookupCalled = false;
    const p = resolvePrior({ actionType: "answer_block" }, table, () => {
      globalLookupCalled = true;
      return globalCell();
    });
    expect(globalLookupCalled).toBe(false);
    expect(p.basis).toBe("actionType:answer_block");
  });

  it("backs off to the global cell when the tenant cell is thin (< MIN_DECIDED)", () => {
    // Only 2 decided outcomes for this tenant — below MIN_DECIDED (3) — table omits it.
    const table = computeDimPriors([won({ actionType: "edit_page" }), won({ actionType: "edit_page" })]);
    const p = resolvePrior({ actionType: "edit_page" }, table, (dim, value) =>
      dim === "actionType" && value === "edit_page" ? globalCell({ winRate: 0.8, distinctTenants: 4 }) : undefined,
    );
    expect(p.basis).toBe("global:actionType:edit_page");
    expect(p.multiplier).toBeGreaterThan(1);
  });

  it("suppresses the global backoff below the distinct-tenant floor (honest single-tenant silence)", () => {
    const p = resolvePrior({ actionType: "edit_page" }, new Map(), () => globalCell({ distinctTenants: 1 }));
    expect(p).toEqual({ multiplier: 1, decidedSample: 0, basis: null, tag: null });
  });

  it("clamps the global multiplier to the TIGHTER [0.9, 1.15] band, distinct from the tenant band", () => {
    expect(GLOBAL_MIN_MULTIPLIER).toBeGreaterThan(MIN_MULTIPLIER);
    expect(GLOBAL_MAX_MULTIPLIER).toBe(MAX_MULTIPLIER);
    const p = resolvePrior({ actionType: "answer_block" }, new Map(), () =>
      globalCell({ winRate: 1, n: 100, distinctTenants: 20 }),
    );
    expect(p.multiplier).toBeLessThanOrEqual(GLOBAL_MAX_MULTIPLIER);
    expect(p.multiplier).toBeGreaterThanOrEqual(GLOBAL_MIN_MULTIPLIER);
  });

  it("a strongly LOSING global cell still respects the tighter floor (never below 0.9)", () => {
    const p = resolvePrior({ actionType: "answer_block" }, new Map(), () =>
      globalCell({ winRate: 0, n: 100, distinctTenants: 20 }),
    );
    expect(p.multiplier).toBe(GLOBAL_MIN_MULTIPLIER);
  });

  it("the tag names a clicks-per-month band when the cell carries a lift range", () => {
    const p = resolvePrior({ actionType: "edit_page" }, new Map(), () =>
      globalCell({ liftLow: 5, liftHigh: 30, distinctTenants: 4 }),
    );
    expect(p.tag).toContain("5 to 30 clicks a month");
    expect(p.tag).toContain("Across sites Beacon runs");
  });

  it("the tag falls back to a win-rate sentence when no lift range is known", () => {
    const p = resolvePrior({ actionType: "edit_page" }, new Map(), () =>
      globalCell({ liftLow: null, liftHigh: null, winRate: 0.5, n: 8, distinctTenants: 4 }),
    );
    expect(p.tag).not.toBeNull();
    expect(p.tag).not.toContain("clicks a month");
  });

  it("respects the backoff ladder ORDER against the global table too (queryCluster before actionType)", () => {
    const p = resolvePrior({ queryCluster: "iran flag", actionType: "edit_page" }, new Map(), (dim) =>
      dim === "queryCluster" ? globalCell({ winRate: 0.9, distinctTenants: 5 }) : globalCell({ winRate: 0.1, distinctTenants: 5 }),
    );
    expect(p.basis).toBe("global:queryCluster:iran flag");
    expect(p.multiplier).toBeGreaterThan(1);
  });

  it("no em or en dashes in any generated global tag (hard rule)", () => {
    const cells = [
      globalCell({ liftLow: 5, liftHigh: 30, distinctTenants: 4 }),
      globalCell({ liftLow: null, liftHigh: null, winRate: 0.62, distinctTenants: 4 }),
      globalCell({ liftLow: null, liftHigh: null, winRate: 0.2, distinctTenants: 4 }),
    ];
    for (const cell of cells) {
      const p = resolvePrior({ actionType: "edit_page" }, new Map(), () => cell);
      expect(p.tag ?? "").not.toMatch(/[–—]/);
    }
  });
});

describe("applyExperimentPriorToMoves — global backoff passthrough", () => {
  it("with no globalLookup arg, behavior is unchanged (existing call sites stay byte-identical)", () => {
    const moves = [move({ demandKey: "a", score: 1000, gap: "answer_block" })];
    const out = applyExperimentPriorToMoves(moves, [], (m) => ({ actionType: m.gap }));
    expect(out[0]!.learnedPrior).toEqual({ multiplier: 1, decidedSample: 0, basis: null, tag: null });
  });

  it("applies the global backoff when supplied and the tenant table is thin", () => {
    const moves = [move({ demandKey: "a", score: 1000, gap: "edit_page" })];
    const out = applyExperimentPriorToMoves(
      moves,
      [],
      (m) => ({ actionType: m.gap }),
      () => globalCell({ winRate: 0.8, distinctTenants: 5 }),
    );
    expect(out[0]!.learnedPrior?.basis).toBe("global:actionType:edit_page");
    expect(out[0]!.score).toBeGreaterThan(1000);
  });
});
