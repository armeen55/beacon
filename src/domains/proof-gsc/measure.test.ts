import { describe, expect, it } from "vitest";
import {
  addDays,
  computeWindowLift,
  pickProofMetric,
  proofCheckDates,
  proofOutcomeSentence,
  summarizeVerdict,
  type GscWindowMetrics,
  type ProofWindowResult,
} from "./measure";

const m = (clicks: number, impressions: number, ctr: number, position: number): GscWindowMetrics => ({
  clicks,
  impressions,
  ctr,
  position,
});

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

describe("pickProofMetric", () => {
  it("maps each action type to the metric that actually measures it", () => {
    expect(pickProofMetric("meta")).toBe("ctr");
    expect(pickProofMetric("edit_meta")).toBe("ctr");
    expect(pickProofMetric("edit_title")).toBe("ctr");
    expect(pickProofMetric("schema")).toBe("ctr");
    expect(pickProofMetric("intro_answer_block")).toBe("ctr");
    expect(pickProofMetric("section_add")).toBe("position");
    expect(pickProofMetric("add_internal_link")).toBe("position");
    expect(pickProofMetric("create_new_page")).toBe("position");
    expect(pickProofMetric("keep_current")).toBe("clicks");
    expect(pickProofMetric("")).toBe("clicks");
  });
});

describe("computeWindowLift — observational diff-in-diff", () => {
  it("clicks: adjustedLift = treatedDelta − mean(controlDelta)", () => {
    const w = computeWindowLift({
      day: 28,
      checkOn: "2026-06-29",
      ran: true,
      treatedPre: m(100, 5000, 0.02, 5),
      treatedPost: m(130, 5200, 0.025, 4), // +30 clicks
      controls: [
        { pre: m(50, 3000, 0.0167, 6), post: m(55, 3100, 0.0177, 6) }, // +5
        { pre: m(80, 4000, 0.02, 7), post: m(78, 3900, 0.02, 7) }, // −2
      ],
    });
    expect(w.treatedDelta).toBe(30);
    expect(w.controlDelta).toBe(1.5); // mean(5, −2)
    expect(w.adjustedLift).toBe(28.5);
    expect(w.controlsUsed).toBe(2);
  });

  it("CTR + position: guarded diff-in-diff", () => {
    const w = computeWindowLift({
      day: 28,
      checkOn: "x",
      ran: true,
      // treated: CTR 2% → 3% (+1pp); position 8 → 5 (moved up 3)
      treatedPre: m(100, 5000, 0.02, 8),
      treatedPost: m(150, 5000, 0.03, 5),
      controls: [
        // control: CTR 2% → 2.2% (+0.2pp); position 8 → 7.5 (up 0.5)
        { pre: m(40, 2000, 0.02, 8), post: m(44, 2000, 0.022, 7.5) },
      ],
    });
    expect(w.treatedCtrDelta).toBeCloseTo(0.01, 5);
    expect(w.adjustedCtrLift).toBeCloseTo(0.008, 4); // 0.01 − 0.002
    expect(w.treatedPosDelta).toBe(3); // 8 − 5
    expect(w.adjustedPosLift).toBe(2.5); // 3 − 0.5
  });

  it("zeroes CTR/position deltas when a window has no impressions/rank (no fake swing)", () => {
    const w = computeWindowLift({
      day: 7,
      checkOn: "x",
      ran: true,
      treatedPre: m(10, 1000, 0.01, 9),
      treatedPost: m(0, 0, 0, 0), // no post data at all
      controls: [],
    });
    expect(w.treatedCtrDelta).toBe(0);
    expect(w.treatedPosDelta).toBe(0);
    expect(w.treatedDelta).toBe(-10); // clicks still computed (0 is valid)
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
    treatedCtrDelta: 0,
    controlCtrDelta: 0,
    adjustedCtrLift: 0,
    treatedPosDelta: 0,
    controlPosDelta: 0,
    adjustedPosLift: 0,
    controlsUsed: 3,
    ...over,
  };
}

describe("summarizeVerdict — clicks (default metric)", () => {
  it("won when adjusted lift clears the floor", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 60, controlsUsed: 3 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("won");
    expect(r.confidence).toBe("high");
    expect(r.metric).toBe("clicks");
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
  it("insufficient_data with only ONE usable control (needs >=2)", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 99, controlsUsed: 1 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("insufficient_data");
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
    expect(r.verdict).toBe("inconclusive");
  });
  it("medium confidence at 2 controls + moderate volume; insufficient below", () => {
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

describe("summarizeVerdict — metric-aware (CTR / position)", () => {
  it("judges a meta/title test on CTR lift, even when clicks are flat", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 0, adjustedCtrLift: 0.008, controlsUsed: 3 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "ctr",
    });
    expect(r.verdict).toBe("won"); // 0.8pp clears the 0.3pp CTR floor
    expect(r.metric).toBe("ctr");
    expect(r.lift).toBeCloseTo(0.008, 4);
  });
  it("CTR within the floor ⇒ inconclusive", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedCtrLift: 0.001, controlsUsed: 3 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "ctr",
    });
    expect(r.verdict).toBe("inconclusive");
  });
  it("judges a content test on position improvement (won)", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedPosLift: 1.2, controlsUsed: 3 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "position",
    });
    expect(r.verdict).toBe("won");
    expect(r.lift).toBe(1.2);
  });
  it("position slip ⇒ lost", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedPosLift: -1.0, controlsUsed: 3 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "position",
    });
    expect(r.verdict).toBe("lost");
  });
});

describe("proofOutcomeSentence — honest, observational, metric-aware copy", () => {
  it("clicks won copy names the lift + flags observational", () => {
    const s = proofOutcomeSentence({
      verdict: "won",
      confidence: "high",
      basis: win({ adjustedLift: 28, day: 28 }),
    });
    expect(s).toContain("helping");
    expect(s).toContain("clicks");
    expect(s).toContain("observational");
  });
  it("CTR won copy reads in percentage points", () => {
    const s = proofOutcomeSentence({
      verdict: "won",
      confidence: "high",
      basis: win({ adjustedCtrLift: 0.008 }),
      metric: "ctr",
      lift: 0.008,
    });
    expect(s).toContain("pp CTR");
    expect(s).toContain("helping");
  });
  it("position won copy reads in ranks + moved up", () => {
    const s = proofOutcomeSentence({
      verdict: "won",
      confidence: "medium",
      basis: win({ adjustedPosLift: 1.2 }),
      metric: "position",
      lift: 1.2,
    });
    expect(s).toContain("ranks");
    expect(s).toContain("moved up");
  });
  it("measuring + insufficient copy never claim an effect", () => {
    expect(
      proofOutcomeSentence({ verdict: "measuring", confidence: "low", basis: null }),
    ).toContain("Measuring");
    expect(
      proofOutcomeSentence({ verdict: "insufficient_data", confidence: "low", basis: null }),
    ).toContain("Not enough");
  });
});
