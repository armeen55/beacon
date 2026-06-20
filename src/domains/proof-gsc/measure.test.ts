import { describe, expect, it } from "vitest";
import {
  addDays,
  computeWindowLift,
  proofCheckDates,
  proofOutcomeSentence,
  summarizeVerdict,
  type ProofWindowResult,
} from "./measure";

describe("date math", () => {
  it("addDays handles plain dates + ISO timestamps (UTC)", () => {
    expect(addDays("2026-06-01", 7)).toBe("2026-06-08");
    expect(addDays("2026-06-01T12:34:56Z", 28)).toBe("2026-06-29");
    expect(addDays("2026-06-30", 1)).toBe("2026-07-01");
  });
  it("proofCheckDates returns the 7/14/28-day closes", () => {
    expect(proofCheckDates("2026-06-01T00:00:00Z")).toEqual({
      7: "2026-06-08",
      14: "2026-06-15",
      28: "2026-06-29",
    });
  });
});

describe("computeWindowLift — observational diff-in-diff", () => {
  it("adjustedLift = treatedDelta − mean(controlDelta)", () => {
    const w = computeWindowLift({
      day: 28,
      checkOn: "2026-06-29",
      ran: true,
      treatedPreClicks: 100,
      treatedPostClicks: 130, // +30
      controls: [
        { preClicks: 50, postClicks: 55 }, // +5
        { preClicks: 80, postClicks: 78 }, // −2
      ],
    });
    expect(w.treatedDelta).toBe(30);
    expect(w.controlDelta).toBe(1.5); // mean(5, −2)
    expect(w.adjustedLift).toBe(28.5);
    expect(w.controlsUsed).toBe(2);
  });
  it("no controls ⇒ controlDelta 0 (raw treated delta, controlsUsed 0)", () => {
    const w = computeWindowLift({
      day: 7,
      checkOn: "x",
      ran: true,
      treatedPreClicks: 10,
      treatedPostClicks: 4,
      controls: [],
    });
    expect(w.controlDelta).toBe(0);
    expect(w.adjustedLift).toBe(-6);
    expect(w.controlsUsed).toBe(0);
  });
});

function win(over: Partial<ProofWindowResult>): ProofWindowResult {
  return {
    day: 28,
    checkOn: "2026-06-29",
    ran: true,
    treatedDelta: 0,
    controlDelta: 0,
    adjustedLift: 0,
    controlsUsed: 3,
    ...over,
  };
}

describe("summarizeVerdict — thresholds + confidence", () => {
  it("won when adjusted lift clears the floor", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 60, controlsUsed: 3 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("won");
    expect(r.confidence).toBe("high"); // 3 controls + ≥3000 impr
  });
  it("lost when adjusted lift is strongly negative", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: -60 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("lost");
  });
  it("inconclusive when movement is within the noise floor", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 5 })], // floor = max(3, 0.1*200)=20
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("inconclusive");
  });
  it("measuring when no window has run yet", () => {
    const r = summarizeVerdict({
      windows: [win({ ran: false }), win({ day: 14, ran: false })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("measuring");
    expect(r.basis).toBeNull();
  });
  it("insufficient_data when baseline impressions are too thin", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 99 })],
      baselineImpressions: 50,
      baselineClicks: 5,
    });
    expect(r.verdict).toBe("insufficient_data");
  });
  it("insufficient_data when the basis window has no controls", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 99, controlsUsed: 0 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("insufficient_data");
  });
  it("insufficient_data with only ONE usable control (needs >=2 for a verdict)", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 99, controlsUsed: 1 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("insufficient_data"); // not "won", despite clearing the lift floor
  });
  it("uses the LONGEST window that ran as the basis", () => {
    const r = summarizeVerdict({
      windows: [
        win({ day: 7, adjustedLift: 100, ran: true }),
        win({ day: 28, adjustedLift: 5, ran: true }),
      ],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.basis?.day).toBe(28);
    expect(r.verdict).toBe("inconclusive"); // 28d lift (5) < floor, not the 7d (100)
  });
  it("medium confidence at 2 controls + moderate volume; insufficient_data below that", () => {
    expect(
      summarizeVerdict({
        windows: [win({ adjustedLift: 40, controlsUsed: 2 })],
        baselineImpressions: 1000,
        baselineClicks: 100,
      }).confidence,
    ).toBe("medium");
    expect(
      summarizeVerdict({
        windows: [win({ adjustedLift: 40, controlsUsed: 1 })],
        baselineImpressions: 1000,
        baselineClicks: 100,
      }).verdict,
    ).toBe("insufficient_data");
  });
});

describe("proofOutcomeSentence — honest, observational copy", () => {
  it("won copy names the lift + flags observational", () => {
    const s = proofOutcomeSentence({
      verdict: "won",
      confidence: "high",
      basis: win({ adjustedLift: 28, day: 28 }),
    });
    expect(s).toContain("helping");
    expect(s).toContain("observational");
  });
  it("measuring + insufficient copy never claim an effect", () => {
    expect(proofOutcomeSentence({ verdict: "measuring", confidence: "low", basis: null })).toContain(
      "Measuring",
    );
    expect(
      proofOutcomeSentence({ verdict: "insufficient_data", confidence: "low", basis: null }),
    ).toContain("Not enough");
  });
});
