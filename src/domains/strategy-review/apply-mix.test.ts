import { describe, expect, it } from "vitest";
import {
  clampStrategyMix,
  clampFocusFamilies,
  applyStrategyMix,
  MIN_WEIGHT,
  MAX_WEIGHT,
  type StrategyLeverWeightInput,
} from "./apply-mix";

const KNOWN = new Set(["answer", "title", "meta", "link"]);

describe("clampStrategyMix - the LLM proposes, this disposes", () => {
  it("clamps a weight above MAX_WEIGHT down to MAX_WEIGHT", () => {
    const out = clampStrategyMix([{ family: "answer", weight: 99, reason: "won a lot" }], KNOWN);
    expect(out.get("answer")?.weight).toBe(MAX_WEIGHT);
  });

  it("clamps a weight below MIN_WEIGHT up to MIN_WEIGHT", () => {
    const out = clampStrategyMix([{ family: "title", weight: 0.01, reason: "lost a lot" }], KNOWN);
    expect(out.get("title")?.weight).toBe(MIN_WEIGHT);
  });

  it("leaves an in-range weight untouched", () => {
    const out = clampStrategyMix([{ family: "meta", weight: 1.3, reason: "some wins" }], KNOWN);
    expect(out.get("meta")?.weight).toBe(1.3);
  });

  it("drops a family the model invented that is not in the known set", () => {
    const out = clampStrategyMix([{ family: "made_up_family", weight: 2, reason: "x" }], KNOWN);
    expect(out.size).toBe(0);
  });

  it("is case-insensitive on family matching", () => {
    const out = clampStrategyMix([{ family: "ANSWER", weight: 1.5, reason: "x" }], KNOWN);
    expect(out.get("answer")?.weight).toBe(1.5);
  });

  it("keeps only the FIRST occurrence of a duplicated family", () => {
    const out = clampStrategyMix(
      [
        { family: "link", weight: 1.2, reason: "first" },
        { family: "link", weight: 1.9, reason: "second" },
      ],
      KNOWN,
    );
    expect(out.get("link")?.weight).toBe(1.2);
    expect(out.get("link")?.reason).toBe("first");
  });

  it("dash-strips the reason", () => {
    const out = clampStrategyMix([{ family: "answer", weight: 1.1, reason: "won more — clearly" }], KNOWN);
    expect(out.get("answer")?.reason).not.toMatch(/[—–]/);
    expect(out.get("answer")?.reason).toBe("won more - clearly");
  });

  it("treats a non-finite weight as neutral (1)", () => {
    const out = clampStrategyMix([{ family: "answer", weight: Number.NaN, reason: "x" } as StrategyLeverWeightInput], KNOWN);
    expect(out.get("answer")?.weight).toBe(1);
  });

  it("an empty proposal yields an empty map", () => {
    expect(clampStrategyMix([], KNOWN).size).toBe(0);
  });
});

describe("clampFocusFamilies", () => {
  it("caps at 3 focus families even when more are proposed", () => {
    const out = clampFocusFamilies(
      [
        { family: "a", reason: "x" },
        { family: "b", reason: "x" },
        { family: "c", reason: "x" },
        { family: "d", reason: "x" },
      ],
      new Set(["a", "b", "c", "d"]),
    );
    expect(out).toHaveLength(3);
  });

  it("drops an unknown family", () => {
    const out = clampFocusFamilies([{ family: "not_known", reason: "x" }], new Set(["known"]));
    expect(out).toHaveLength(0);
  });

  it("dedupes a repeated family (case-insensitive)", () => {
    const out = clampFocusFamilies(
      [
        { family: "flags", reason: "first" },
        { family: "FLAGS", reason: "second" },
      ],
      new Set(["flags"]),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.reason).toBe("first");
  });

  it("dash-strips the reason", () => {
    const out = clampFocusFamilies([{ family: "flags", reason: "worth it – clearly" }], new Set(["flags"]));
    expect(out[0]!.reason).toBe("worth it - clearly");
  });
});

describe("applyStrategyMix - identity when absent", () => {
  it("returns byte-identical scores when mix is null", () => {
    const candidates = [{ actionFamily: "answer", score: 100 }];
    const out = applyStrategyMix(candidates, null);
    expect(out[0]!.score).toBe(100);
    expect(out[0]!.mixTag).toBeUndefined();
  });

  it("returns byte-identical scores when mix is an empty map", () => {
    const candidates = [{ actionFamily: "answer", score: 100 }];
    const out = applyStrategyMix(candidates, new Map());
    expect(out[0]!.score).toBe(100);
  });

  it("returns byte-identical scores when the candidate's family is absent from the mix", () => {
    const mix = clampStrategyMix([{ family: "title", weight: 1.5, reason: "x" }], KNOWN);
    const candidates = [{ actionFamily: "answer", score: 100 }];
    const out = applyStrategyMix(candidates, mix);
    expect(out[0]!.score).toBe(100);
    expect(out[0]!.mixTag).toBeUndefined();
  });

  it("multiplies score by the family's clamped weight and attaches mixTag", () => {
    const mix = clampStrategyMix([{ family: "answer", weight: 1.5, reason: "won 3 of 4" }], KNOWN);
    const candidates = [{ actionFamily: "answer", score: 100 }];
    const out = applyStrategyMix(candidates, mix);
    expect(out[0]!.score).toBe(150);
    expect(out[0]!.mixTag).toEqual({ family: "answer", weight: 1.5, reason: "won 3 of 4" });
  });

  it("a neutral weight of 1 leaves score identical but still tags the pick", () => {
    const mix = clampStrategyMix([{ family: "answer", weight: 1, reason: "mixed" }], KNOWN);
    const candidates = [{ actionFamily: "answer", score: 100 }];
    const out = applyStrategyMix(candidates, mix);
    expect(out[0]!.score).toBe(100);
    expect(out[0]!.mixTag).toBeUndefined();
  });

  it("never mutates the input array", () => {
    const candidates = [{ actionFamily: "answer", score: 100 }];
    const mix = clampStrategyMix([{ family: "answer", weight: 1.5, reason: "x" }], KNOWN);
    applyStrategyMix(candidates, mix);
    expect(candidates[0]!.score).toBe(100);
  });

  it("applies independently per candidate across a mixed batch", () => {
    const mix = clampStrategyMix(
      [
        { family: "answer", weight: 2, reason: "leaning in" },
        { family: "title", weight: 0.5, reason: "easing off" },
      ],
      KNOWN,
    );
    const candidates = [
      { actionFamily: "answer", score: 10 },
      { actionFamily: "title", score: 10 },
      { actionFamily: "link", score: 10 },
    ];
    const out = applyStrategyMix(candidates, mix);
    expect(out[0]!.score).toBe(20);
    expect(out[1]!.score).toBe(5);
    expect(out[2]!.score).toBe(10);
  });
});
