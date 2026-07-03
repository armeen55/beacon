import { describe, it, expect } from "vitest";
import { evaluatePreparedPackQuality } from "./draft-quality";

/**
 * R16 (P6 LLM engine pack): the de-templating guard's "reads like a repeat"
 * flag demotes a ready draft to needs-review at the quality gate. Additive -
 * every verdict without the flag stays byte-identical (pinned by the main
 * draft-quality suite).
 */

const READY_ANSWER_PACK = {
  structuredDraft: {
    kind: "answer_block",
    value: {
      answer:
        "Chaharshanbe Suri 2026 falls on Tuesday, March 17, the eve of the last Wednesday before Nowruz. Iranian families gather after sunset to jump over small bonfires, share ajil, and recite the traditional zardi-ye man az to verse to leave the old year's troubles behind.",
      evidenceRefs: [{ source: "gsc", detail: "194 impressions on the 2026 date query" }],
    },
  },
  preparedStatus: "ready_to_review",
  moveType: "answer_block",
} as const;

describe("R16 - repeat-flag demotion at the draft-quality gate", () => {
  it("baseline: the fixture is READY without the flag", () => {
    const r = evaluatePreparedPackQuality({ ...READY_ANSWER_PACK });
    expect(r.status).toBe("ready");
  });

  it("repeatFlagged demotes ready -> useful_but_needs_review with plain-English reason", () => {
    const r = evaluatePreparedPackQuality({ ...READY_ANSWER_PACK, repeatFlagged: true });
    expect(r.status).toBe("useful_but_needs_review");
    expect(r.reasons[0]).toBe("Reads like a repeat of recent drafts. Give it a quick look before shipping.");
    expect(r.reasons[0]).not.toMatch(/[–—]/);
    expect(r.copyAllowed).toBe(true); // repetition is a review concern, not a trust breach
    expect(r.canRegenerate).toBe(true);
    expect(r.confidence).toBe("medium");
  });

  it("does NOT rescue or alter a non-ready verdict (demotion only)", () => {
    const thin = evaluatePreparedPackQuality({ structuredDraft: null, repeatFlagged: true });
    expect(thin.status).toBe("too_thin");
    const same = evaluatePreparedPackQuality({ structuredDraft: null });
    expect(thin.reasons).toEqual(same.reasons);
  });

  it("omitting the field leaves the verdict byte-identical", () => {
    const a = evaluatePreparedPackQuality({ ...READY_ANSWER_PACK });
    const b = evaluatePreparedPackQuality({ ...READY_ANSWER_PACK, repeatFlagged: false });
    expect(b).toEqual(a);
  });
});
