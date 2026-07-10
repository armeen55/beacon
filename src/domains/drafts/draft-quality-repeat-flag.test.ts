import { describe, it, expect } from "vitest";
import { evaluatePreparedPackQuality } from "./draft-quality";

/**
 * R16 (P6 LLM engine pack): the de-templating guard's "reads like a repeat"
 * flag demotes a ready draft to needs-review at the quality gate. Additive -
 * every verdict without the flag stays byte-identical (pinned by the main
 * draft-quality suite).
 *
 * W5 (2026-07-09, J-69/J-71) re-pin: the fixture is lengthened to the 80-150
 * word answer-block band and carries a qualifying source so the baseline
 * stays "ready", a bare word-band/source-gate re-pin, not a weakened
 * assertion (the repeat-flag demotion behavior under test is unchanged).
 */

const READY_ANSWER_PACK = {
  structuredDraft: {
    kind: "answer_block",
    value: {
      answer:
        "Chaharshanbe Suri 2026 falls on Tuesday, March 17, the eve of the last Wednesday before Nowruz. Iranian families gather after sunset to jump over small bonfires, share ajil, and recite the traditional zardi-ye man az to verse to leave the old year's troubles behind. Neighbors light several small fires in a row along streets and courtyards, and children often join in with sparklers and small firecrackers under adult supervision. Musicians sometimes play drums nearby while groups pass from one small fire to the next well into the evening. Many families finish the night with a shared meal indoors once the fires have burned down safely.",
      evidenceRefs: [{ source: "gsc", detail: "194 impressions on the 2026 date query" }],
      sources: [
        {
          domain: "britannica.com",
          claim: "Chaharshanbe Suri falls on the eve of the last Wednesday before Nowruz and involves jumping over bonfires",
          // W5 P0-1: a qualifying source is generation-time verified.
          verified: true,
          // trust-230 (Codex P1): the coverage check needs the source's fetched
          // passage to entail every protected claim in the answer, so this
          // excerpt is the passage the answer was written from.
          supportingExcerpt:
            "Chaharshanbe Suri 2026 falls on Tuesday, March 17, the eve of the last Wednesday before Nowruz. Iranian families gather after sunset to jump over small bonfires, share ajil, and recite the traditional zardi-ye man az to verse to leave the old year's troubles behind. Neighbors light several small fires in a row along streets and courtyards, and children often join in with sparklers and small firecrackers under adult supervision. Musicians sometimes play drums nearby while groups pass from one small fire to the next well into the evening. Many families finish the night with a shared meal indoors once the fires have burned down safely.",
        },
      ],
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
