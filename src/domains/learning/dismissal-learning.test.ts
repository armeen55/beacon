/**
 * dismissal-learning.test.ts (R23 P15) - pins the two skip-learning jobs and, hard,
 * the ZERO-RISK contract: a fresh tenant (no dismissals, no shipped/rejected keys)
 * gets its moves back BYTE-IDENTICAL (same reference, same order, same scores).
 */
import { describe, expect, it } from "vitest";

import type { MoveCandidate } from "@/domains/demand-graph/build-graph";
import {
  MIN_DISMISSALS_TO_DEMOTE,
  MIN_DEMOTION_MULTIPLIER,
  moveRepeatKey,
  normalizePageKey,
  buildDoNotRepeatRegistry,
  suppressDoNotRepeat,
  computeKindDemotions,
  applyKindDemotionsToMoves,
  applyDismissalLearning,
  type DecidedMoveRef,
  type DismissalObservation,
} from "./dismissal-learning";

function move(partial: Partial<MoveCandidate> & { demandKey: string; gap: MoveCandidate["gap"]; score: number }): MoveCandidate {
  return {
    label: partial.label ?? partial.demandKey,
    ownedUrl: partial.ownedUrl ?? null,
    components: { demand: 100, winnability: 0.5, dollarValue: 0, visibilityGap: 0.5, friction: 0 },
    confidence: "medium",
    signals: [],
    competitorUrls: [],
    fanoutSeeds: [],
    rationale: "",
    ...partial,
  } as MoveCandidate;
}

describe("key normalization", () => {
  it("strips host, query, trailing slash, case", () => {
    expect(normalizePageKey("https://iranopedia.com/Iran-Flags/?x=1")).toBe("/iran-flags");
    expect(normalizePageKey("/iran-flags/")).toBe("/iran-flags");
    expect(normalizePageKey("")).toBe("");
  });
  it("canonicalizes the move kind so a gap and an action_type collapse", () => {
    // both mean "answer block"
    expect(moveRepeatKey("answer_block", "/x")).toBe(moveRepeatKey("add_answer_block", "/x"));
  });
});

describe("do-not-repeat - suppresses an exact rejected/shipped item, passes a fresh one", () => {
  const moves = [
    move({ demandKey: "a", gap: "answer_block", ownedUrl: "https://s.com/flags", score: 900, label: "flags" }),
    move({ demandKey: "b", gap: "edit_page", ownedUrl: "https://s.com/food", score: 800, label: "food" }),
  ];

  it("removes a move whose (kind, page) matches a REJECTED key", () => {
    const refs: DecidedMoveRef[] = [{ moveType: "answer_block", page: "/flags", reason: "rejected" }];
    const registry = buildDoNotRepeatRegistry(refs);
    const { moves: out, suppressed } = suppressDoNotRepeat(moves, registry);
    expect(out.map((m) => m.demandKey)).toEqual(["b"]);
    expect(suppressed).toEqual([{ key: moveRepeatKey("answer_block", "/flags"), label: "flags" }]);
  });

  it("removes a move already SHIPPED (never re-suggest a change already made)", () => {
    const refs: DecidedMoveRef[] = [{ moveType: "edit_title", page: "https://s.com/food", reason: "shipped" }];
    const { moves: out } = suppressDoNotRepeat(moves, buildDoNotRepeatRegistry(refs));
    expect(out.map((m) => m.demandKey)).toEqual(["a"]); // food (edit_page ~ edit_title) suppressed
  });

  it("passes a FRESH move whose key is not in the registry", () => {
    const refs: DecidedMoveRef[] = [{ moveType: "answer_block", page: "/some-other-page", reason: "rejected" }];
    const { moves: out, suppressed } = suppressDoNotRepeat(moves, buildDoNotRepeatRegistry(refs));
    expect(out).toBe(moves); // no match → same reference (byte-identical)
    expect(suppressed).toEqual([]);
  });

  it("an EMPTY registry is a byte-identical no-op (same reference)", () => {
    const { moves: out } = suppressDoNotRepeat(moves, new Set());
    expect(out).toBe(moves);
  });
});

describe("kind demotion - decided-only, bounded, byte-identical when thin", () => {
  const board = [
    move({ demandKey: "s1", gap: "edit_page", score: 500 }),
    move({ demandKey: "s2", gap: "edit_page", score: 480 }),
    move({ demandKey: "a1", gap: "answer_block", score: 470 }),
  ];

  it("does NOT demote a kind below the dismissal threshold (one/two skips is not a pattern)", () => {
    const dismissals: DismissalObservation[] = [{ moveType: "edit_title" }, { moveType: "edit_title" }]; // 2 < 3
    const table = computeKindDemotions(dismissals, board);
    expect(table.size).toBe(0);
    expect(applyKindDemotionsToMoves(board, table)).toBe(board); // byte-identical
  });

  it("demotes a repeatedly-skipped kind, bounded within [0.8, 1.0]", () => {
    // edit_title canonicalizes to the edit_page kind - the operator keeps skipping title tweaks
    const dismissals: DismissalObservation[] = Array.from({ length: 5 }, () => ({ moveType: "edit_title" }));
    const table = computeKindDemotions(dismissals, board);
    const d = table.get("edit_page");
    expect(d).toBeTruthy();
    expect(d!.dismissals).toBe(5);
    expect(d!.multiplier).toBeGreaterThanOrEqual(MIN_DEMOTION_MULTIPLIER);
    expect(d!.multiplier).toBeLessThan(1);
    // edit_page scores drop; answer_block untouched
    const out = applyKindDemotionsToMoves(board, table);
    const s1 = out.find((m) => m.demandKey === "s1")!;
    const a1 = out.find((m) => m.demandKey === "a1")!;
    expect(s1.score).toBeLessThan(500);
    expect(a1.score).toBe(470);
    // never below the floor
    expect(s1.score).toBeGreaterThanOrEqual(Math.round(500 * MIN_DEMOTION_MULTIPLIER));
  });

  it("does not demote a kind with dismissals but NO live move of that kind", () => {
    const dismissals: DismissalObservation[] = Array.from({ length: 4 }, () => ({ moveType: "create_page" }));
    const table = computeKindDemotions(dismissals, board); // board has no create_page
    expect(table.has("create_page")).toBe(false);
  });

  it("MIN_DISMISSALS_TO_DEMOTE is exactly 3 (decided-only floor)", () => {
    expect(MIN_DISMISSALS_TO_DEMOTE).toBe(3);
  });
});

describe("applyDismissalLearning - the combined pass", () => {
  const moves = [
    move({ demandKey: "a", gap: "answer_block", ownedUrl: "https://s.com/flags", score: 900, label: "flags" }),
    move({ demandKey: "b", gap: "edit_page", ownedUrl: "https://s.com/food", score: 800, label: "food" }),
    move({ demandKey: "c", gap: "edit_page", ownedUrl: "https://s.com/music", score: 700, label: "music" }),
  ];

  it("BYTE-IDENTICAL for a fresh/undecided tenant (no signals)", () => {
    const out = applyDismissalLearning(moves, { doNotRepeat: [], dismissals: [] });
    expect(out.moves).toBe(moves);
    expect(out.suppressed).toEqual([]);
    expect(out.demotions).toEqual([]);
  });

  it("ZERO-RISK stack pin: dismissal-learning composed with the outcome prior is identity on empty evidence", async () => {
    // The load-graph post-pass stacks the outcome prior (experiment-prior) and
    // this dismissal-learning pass. With no evidence in EITHER, the stack must be
    // byte-identical - same order, same scores - the pinned zero-risk contract.
    const { applyExperimentPriorToMoves } = await import("./experiment-prior");
    const afterPrior = applyExperimentPriorToMoves(moves, [], (m) => ({ actionType: m.gap }));
    const afterDismissal = applyDismissalLearning(afterPrior, { doNotRepeat: [], dismissals: [] });
    expect(afterDismissal.moves.map((m) => [m.demandKey, m.score])).toEqual(
      moves.map((m) => [m.demandKey, m.score]),
    );
  });

  it("suppresses a rejected exact item AND demotes a heavily-skipped kind together", () => {
    const out = applyDismissalLearning(moves, {
      doNotRepeat: [{ moveType: "answer_block", page: "/flags", reason: "rejected" }],
      dismissals: Array.from({ length: 4 }, () => ({ moveType: "edit_title" })),
    });
    // flags removed
    expect(out.moves.map((m) => m.demandKey)).not.toContain("a");
    expect(out.suppressed.map((s) => s.label)).toEqual(["flags"]);
    // edit_page kind demoted (both b and c present after suppression → demotion fires)
    expect(out.demotions.map((d) => d.kind)).toContain("edit_page");
    const b = out.moves.find((m) => m.demandKey === "b")!;
    expect(b.score).toBeLessThan(800);
  });
});
