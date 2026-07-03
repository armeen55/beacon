import { describe, it, expect } from "vitest";

import { runAblation, ABLATABLE_SIGNALS } from "./ablation";
import { goldCaseCount } from "./gold-library";

describe("runAblation - which signals actually carry the correct decisions", () => {
  const report = runAblation();

  it("the full scorer gets every gold case right at baseline", () => {
    expect(report.baselineCorrect).toBe(goldCaseCount());
    expect(report.casesTotal).toBe(goldCaseCount());
  });

  it("reports a contribution for every ablatable signal", () => {
    const signals = report.contributions.map((c) => c.signal).sort();
    expect(signals).toEqual([...ABLATABLE_SIGNALS].sort());
  });

  it("GSC demand is the most load-bearing signal (drops the most cases)", () => {
    // GSC demand feeds the demand floor: remove it and several pages fall below
    // the floor and mis-classify as low_demand. It should top the ranking.
    expect(report.contributions[0]!.signal).toBe("gsc_demand");
    expect(report.contributions[0]!.casesDropped).toBe(4);
    expect(report.contributions[0]!.sentence).toBe("Removing GSC demand drops 4 gold cases.");
  });

  it("AI and competitor evidence is load-bearing for the answer-block decision", () => {
    const aic = report.contributions.find((c) => c.signal === "ai_and_competitor")!;
    expect(aic.casesDropped).toBe(1);
    expect(aic.droppedCases[0]!.case).toBe("answer-block-uncited");
  });

  it("Clarity friction is load-bearing for the fix-experience decision", () => {
    const friction = report.contributions.find((c) => c.signal === "clarity_friction")!;
    expect(friction.casesDropped).toBe(1);
    expect(friction.droppedCases[0]!.case).toBe("fix-experience-friction");
  });

  it("no sentence carries a banned dash", () => {
    for (const c of report.contributions) expect(c.sentence).not.toMatch(/[‒–—―]/);
  });

  it("is deterministic", () => {
    expect(runAblation()).toEqual(report);
  });
});
