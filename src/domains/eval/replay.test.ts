import { describe, it, expect } from "vitest";

import { replayDecisions, replayGoldBaseline, goldCapturedDecisions, type CapturedDecision } from "./replay";
import { goldCases } from "./gold-library";

describe("replayGoldBaseline - current logic reproduces every captured decision", () => {
  it("has zero divergences on the gold-derived baseline (a clean, non-diverging change)", () => {
    const report = replayGoldBaseline();
    expect(report.divergences).toEqual([]);
    expect(report.matched).toBe(report.total);
    expect(report.total).toBe(goldCases().length);
  });

  it("is deterministic", () => {
    expect(replayGoldBaseline()).toEqual(replayGoldBaseline());
  });
});

describe("replayDecisions - the divergence detector", () => {
  it("flags a decision the current logic would now decide differently", () => {
    // Take a real captured decision and corrupt its recorded action so the
    // current scorer disagrees - the replay must catch the flip.
    const captured = goldCapturedDecisions();
    const answerBlockCase = captured.find((c) => c.id === "answer-block-uncited")!;
    const tampered: CapturedDecision = { ...answerBlockCase, decidedAction: "create_page" };
    const report = replayDecisions([tampered]);
    expect(report.divergences.length).toBe(1);
    expect(report.divergences[0]).toEqual({
      case: "answer-block-uncited",
      priorAction: "create_page",
      currentAction: "answer_block",
    });
    expect(report.matched).toBe(0);
  });

  it("an empty captured set replays clean", () => {
    expect(replayDecisions([])).toEqual({ matched: 0, total: 0, divergences: [] });
  });
});
