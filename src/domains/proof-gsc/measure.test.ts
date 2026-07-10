import { describe, expect, it } from "vitest";
import {
  addDays,
  computeWindowLift,
  pickProofMetric,
  isSnippetCapturePlay,
  proofCheckDates,
  proofOutcomeSentence,
  summarizeVerdict,
  trafficTierOf,
  DEFAULT_MIN_LIFT_CLICKS,
  DEFAULT_MIN_LIFT_CTR,
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
    expect(pickProofMetric("add_internal_link")).toBe("position"); // rank play
    // Coverage / new-content plays grow CLICKS but dilute avg position, so they
    // are judged on clicks, NOT position.
    expect(pickProofMetric("section_add")).toBe("clicks");
    expect(pickProofMetric("create_new_page")).toBe("clicks");
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

  it("clicks: pro-rates a 28d pre window to a 7d post window (no false 'lost' on a flat page)", () => {
    // Steady 10 clicks/day: pre(28d)=280, post(7d)=70. Without pro-rating,
    // treatedDelta would be 70−280 = −210 (a flat page reported as crashing).
    const w = computeWindowLift({
      day: 7,
      checkOn: "x",
      ran: true,
      treatedPre: m(280, 14000, 0.02, 5),
      treatedPost: m(70, 3500, 0.02, 5),
      controls: [
        { pre: m(140, 7000, 0.02, 6), post: m(35, 1750, 0.02, 6) }, // steady 5/day
        { pre: m(280, 14000, 0.02, 7), post: m(70, 3500, 0.02, 7) }, // steady 10/day
      ],
      preWindowDays: 28,
    });
    expect(w.treatedDelta).toBe(0); // 70 − 280·(7/28)
    expect(w.controlDelta).toBe(0);
    expect(w.adjustedLift).toBe(0);
  });

  it("summarizeVerdict: a flat page on the 7d window is inconclusive, not lost (floor scales to the window)", () => {
    const flat7d = computeWindowLift({
      day: 7,
      checkOn: "x",
      ran: true,
      treatedPre: m(280, 14000, 0.02, 5),
      treatedPost: m(70, 3500, 0.02, 5),
      controls: [
        { pre: m(140, 7000, 0.02, 6), post: m(35, 1750, 0.02, 6) },
        { pre: m(280, 14000, 0.02, 7), post: m(70, 3500, 0.02, 7) },
      ],
      preWindowDays: 28,
    });
    const v = summarizeVerdict({
      windows: [flat7d],
      baselineImpressions: 14000,
      baselineClicks: 280,
      metric: "clicks",
    });
    expect(v.verdict).toBe("inconclusive");
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

  it("a window that has NOT run stores a fully-neutral result (no pre-minus-zero artifact)", () => {
    const w = computeWindowLift({
      day: 28,
      checkOn: "2026-07-19",
      ran: false,
      treatedPre: m(25, 5000, 0.005, 7), // would be a -25 treatedDelta if computed
      treatedPost: m(0, 0, 0, 0),
      controls: [{ pre: m(300, 9000, 0.033, 6), post: m(0, 0, 0, 0) }],
      preWindowDays: 28,
    });
    expect(w.ran).toBe(false);
    expect(w.treatedDelta).toBe(0);
    expect(w.controlDelta).toBe(0);
    expect(w.adjustedLift).toBe(0); // NOT a bogus +220 from (control pre − treated pre)
    expect(w.adjustedCtrLift).toBe(0);
    expect(w.adjustedPosLift).toBe(0);
    expect(w.controlsUsed).toBe(0);
    expect(w.treatedPostImpressions).toBe(0);
  });
});

describe("pickProofMetric — lever class names map to the right metric", () => {
  it("RANK-improvement levers (internal links, reorder) judge on position", () => {
    expect(pickProofMetric("internal_link")).toBe("position");
    expect(pickProofMetric("internal_links")).toBe("position"); // canonical plural
    expect(pickProofMetric("section_reorder")).toBe("position");
  });
  it("COVERAGE/new-content levers judge on CLICKS, not position (avg position is diluted by new long-tail)", () => {
    expect(pickProofMetric("section_add")).toBe("clicks");
    expect(pickProofMetric("section_added")).toBe("clicks"); // canonical past-tense
    expect(pickProofMetric("expand_content")).toBe("clicks");
    expect(pickProofMetric("page_created")).toBe("clicks");
  });
  it("title/meta/answer levers judge on CTR; unknown falls back to clicks", () => {
    expect(pickProofMetric("title")).toBe("ctr");
    expect(pickProofMetric("intro_answer_block")).toBe("ctr");
    expect(pickProofMetric("totally_unknown")).toBe("clicks");
  });
  it("isSnippetCapturePlay flags answer-block plays only", () => {
    expect(isSnippetCapturePlay("intro_answer_block")).toBe(true);
    expect(isSnippetCapturePlay("answer_block")).toBe(true);
    expect(isSnippetCapturePlay("title")).toBe(false);
    expect(isSnippetCapturePlay("meta")).toBe(false);
  });
});

describe("summarizeVerdict — answer-block snippet capture (CTR down but rank held)", () => {
  it("a CTR drop with rank HELD on a snippet play reads inconclusive, NOT lost", () => {
    const r = summarizeVerdict({
      windows: [
        win({ adjustedCtrLift: -0.02, adjustedPosLift: 0.2, controlsUsed: 3, treatedPostImpressions: 5000 }),
      ],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "ctr",
      snippetCapturePlay: true,
    });
    expect(r.verdict).toBe("inconclusive"); // likely a featured-snippet capture
  });
  it("the SAME drop with rank ALSO falling is still a real loss", () => {
    const r = summarizeVerdict({
      windows: [
        win({ adjustedCtrLift: -0.02, adjustedPosLift: -1.5, controlsUsed: 3, treatedPostImpressions: 5000 }),
      ],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "ctr",
      snippetCapturePlay: true,
    });
    expect(r.verdict).toBe("lost");
  });
  it("a non-snippet play (meta) still calls a CTR drop a loss even with rank held", () => {
    const r = summarizeVerdict({
      windows: [
        win({ adjustedCtrLift: -0.02, adjustedPosLift: 0.2, controlsUsed: 3, treatedPostImpressions: 5000 }),
      ],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "ctr",
    });
    expect(r.verdict).toBe("lost");
  });
});

describe("summarizeVerdict — treated page with no post-window Search data", () => {
  it("CTR test with zero treated post impressions reads insufficient_data, NOT lost", () => {
    // Surviving controls gained CTR (adjustedCtrLift negative) but the treated
    // page had no post impressions — that's missing data, not a real CTR drop.
    const r = summarizeVerdict({
      windows: [
        win({ adjustedCtrLift: -0.02, controlsUsed: 3, treatedPostImpressions: 0 }),
      ],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "ctr",
    });
    expect(r.verdict).toBe("insufficient_data");
  });
  it("CTR test still calls a real loss when the treated page HAD post impressions", () => {
    const r = summarizeVerdict({
      windows: [
        win({ adjustedCtrLift: -0.02, controlsUsed: 3, treatedPostImpressions: 4000 }),
      ],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "ctr",
    });
    expect(r.verdict).toBe("lost");
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

describe("impressions as a result (operator ask): visibility counts even when clicks/CTR are flat", () => {
  it("computeWindowLift computes an impressions diff-in-diff (visibility lift)", () => {
    const w = computeWindowLift({
      day: 28,
      checkOn: "2026-06-29",
      ran: true,
      treatedPre: m(100, 5000, 0.02, 5),
      treatedPost: m(100, 6200, 0.016, 5), // +1200 impressions, clicks flat
      controls: [{ pre: m(100, 5000, 0.02, 5), post: m(100, 5100, 0.02, 5) }], // controls barely moved (+100)
      preWindowDays: 28,
    });
    expect(w.treatedImpressionsDelta).toBe(1200);
    expect(w.adjustedImpressionsLift).toBe(1100); // 1200 treated − 100 control
  });

  it("a flat-clicks change with a real impressions gain is a WIN on visibility", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 5, adjustedImpressionsLift: 2000, treatedImpressionsDelta: 2000, controlsUsed: 3 })],
      baselineImpressions: 5000, // floor = max(50, 5000*1*0.2) = 1000
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("won");
    expect(r.wonOnImpressions).toBe(true);
    expect(r.impressionsLift).toBe(2000);
  });

  it("does NOT upgrade when the treated page did not actually gain impressions (controls just fell)", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 5, adjustedImpressionsLift: 2000, treatedImpressionsDelta: 0, controlsUsed: 3 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("inconclusive");
    expect(r.wonOnImpressions).toBe(false);
  });

  it("does NOT upgrade when the impressions gain is below the noise floor", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: 5, adjustedImpressionsLift: 200, treatedImpressionsDelta: 200, controlsUsed: 3 })],
      baselineImpressions: 5000, // floor 1000 > 200
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("inconclusive");
  });

  it("a real click LOSS stays lost even if impressions rose (a regression is not redeemed by visibility)", () => {
    const r = summarizeVerdict({
      windows: [win({ adjustedLift: -60, adjustedImpressionsLift: 3000, treatedImpressionsDelta: 3000, controlsUsed: 3 })],
      baselineImpressions: 5000,
      baselineClicks: 200,
    });
    expect(r.verdict).toBe("lost");
    expect(r.wonOnImpressions).toBe(false);
  });

  it("the outcome sentence credits visibility on a win-on-impressions and on an inconclusive-with-impressions", () => {
    const wonVis = proofOutcomeSentence({
      verdict: "won", confidence: "medium", metric: "clicks", lift: 0,
      basis: win({ adjustedLift: 0, adjustedImpressionsLift: 2000 }),
    });
    expect(wonVis).toContain("showing for more searches");
    expect(wonVis).toContain("2000 impressions");

    const inconcVis = proofOutcomeSentence({
      verdict: "inconclusive", confidence: "low", metric: "clicks", lift: 5,
      basis: win({ adjustedLift: 5, adjustedImpressionsLift: 800 }),
    });
    expect(inconcVis).toContain("showing for more searches");
  });
});

describe("summarizeVerdict — item 31 calibrated floors (VerdictFloors injection)", () => {
  const win28 = (adjustedLift: number, adjustedCtrLift: number = 0): ProofWindowResult =>
    ({
      day: 28, checkOn: "x", ran: true,
      treatedDelta: 0, controlDelta: 0, adjustedLift,
      treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift,
      treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0,
      controlsUsed: 3, treatedPostImpressions: 5000,
    }) as ProofWindowResult;

  // baselineClicks is kept tiny (10) so clicksFloorBaseline*MIN_LIFT_FRACTION
  // (10*0.1=1) never dominates Math.max(minLiftClicks, ...) - these tests are
  // about the minLiftClicks/minLiftCtr floor itself, not the fraction floor
  // (already covered by the pre-existing "flat page" tests above).
  it("with no `floors` argument, behavior is BYTE-IDENTICAL to the pre-calibration default (the pin)", () => {
    const withoutFloorsArg = summarizeVerdict({
      windows: [win28(DEFAULT_MIN_LIFT_CLICKS + 1)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
    });
    const withEmptyFloors = summarizeVerdict({
      windows: [win28(DEFAULT_MIN_LIFT_CLICKS + 1)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
      floors: {},
    });
    expect(withoutFloorsArg).toEqual(withEmptyFloors);
    expect(withoutFloorsArg.verdict).toBe("won");
  });

  it("an undefined floors object never changes the clicks or CTR verdict vs the DEFAULT_MIN_LIFT_* constants", () => {
    // Lift sits exactly on the documented default floors - proves the fallback
    // reads the real exported constants, not a second hardcoded copy.
    const clicksAtFloor = summarizeVerdict({
      windows: [win28(DEFAULT_MIN_LIFT_CLICKS)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
    });
    expect(clicksAtFloor.verdict).toBe("won");

    const ctrAtFloor = summarizeVerdict({
      windows: [win28(0, DEFAULT_MIN_LIFT_CTR)],
      baselineImpressions: 5000,
      baselineClicks: 200,
      metric: "ctr",
    });
    expect(ctrAtFloor.verdict).toBe("won");
  });

  it("a calibrated (stricter) floor can turn a would-have-been win into inconclusive", () => {
    const lift = DEFAULT_MIN_LIFT_CLICKS + 1; // clears the default floor
    const withDefault = summarizeVerdict({
      windows: [win28(lift)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
    });
    expect(withDefault.verdict).toBe("won");

    const withCalibratedFloor = summarizeVerdict({
      windows: [win28(lift)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
      floors: { minLiftClicks: lift + 10 }, // calibration derived a much stricter floor
    });
    expect(withCalibratedFloor.verdict).toBe("inconclusive");
  });

  it("a floors object with only minLiftCtr set leaves the clicks floor at the default", () => {
    const lift = DEFAULT_MIN_LIFT_CLICKS + 1;
    const r = summarizeVerdict({
      windows: [win28(lift)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
      floors: { minLiftCtr: 0.5 }, // unrelated to the clicks metric under test
    });
    expect(r.verdict).toBe("won");
  });
});

describe("summarizeVerdict - item 37 permutation gate on HIGH confidence (additive)", () => {
  // High-confidence-eligible on controls/impressions alone (mirrors the
  // existing HIGH-confidence fixture shape: 3 controls, 3000+ baseline impr).
  const win28High = (adjustedLift: number): ProofWindowResult =>
    ({
      day: 28, checkOn: "x", ran: true,
      treatedDelta: 0, controlDelta: 0, adjustedLift,
      treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0,
      treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0,
      controlsUsed: 3, treatedPostImpressions: 5000,
    }) as ProofWindowResult;

  it("with no `permutationP`, behavior is BYTE-IDENTICAL to the pre-item-37 default (the pin)", () => {
    const without = summarizeVerdict({
      windows: [win28High(DEFAULT_MIN_LIFT_CLICKS + 1)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
    });
    expect(without.confidence).toBe("high");
    expect(without.verdict).toBe("won");
  });

  it("a permutation p at or below the 0.05 bar keeps HIGH confidence", () => {
    const r = summarizeVerdict({
      windows: [win28High(DEFAULT_MIN_LIFT_CLICKS + 1)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
      permutationP: 0.05,
    });
    expect(r.confidence).toBe("high");
  });

  it("a permutation p above the bar demotes an otherwise-HIGH read to MEDIUM, never LOW or a changed verdict", () => {
    const withoutPermutation = summarizeVerdict({
      windows: [win28High(DEFAULT_MIN_LIFT_CLICKS + 1)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
    });
    const withWeakPermutation = summarizeVerdict({
      windows: [win28High(DEFAULT_MIN_LIFT_CLICKS + 1)],
      baselineImpressions: 5000,
      baselineClicks: 10,
      metric: "clicks",
      permutationP: 0.5, // half of untreated pages moved this much - unremarkable
    });
    expect(withoutPermutation.confidence).toBe("high");
    expect(withWeakPermutation.confidence).toBe("medium");
    expect(withWeakPermutation.verdict).toBe(withoutPermutation.verdict);
    expect(withWeakPermutation.lift).toBe(withoutPermutation.lift);
  });

  it("never upgrades confidence: a low-controls/low-impressions read with a great permutation p stays at its floor-derived tier", () => {
    const r = summarizeVerdict({
      windows: [
        {
          day: 28, checkOn: "x", ran: true,
          treatedDelta: 0, controlDelta: 0, adjustedLift: DEFAULT_MIN_LIFT_CLICKS + 1,
          treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0,
          treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0,
          controlsUsed: 1, treatedPostImpressions: 200,
        } as ProofWindowResult,
      ],
      baselineImpressions: 250, // below the medium/high impression floors
      baselineClicks: 10,
      metric: "clicks",
      permutationP: 0, // strongest possible permutation evidence
    });
    expect(r.confidence).toBe("low");
  });
});

describe("trafficTierOf — item 31 traffic-tier bucketing (pure)", () => {
  it("buckets by baseline impressions using the documented thresholds", () => {
    expect(trafficTierOf(199)).toBe("low");
    expect(trafficTierOf(200)).toBe("low");
    expect(trafficTierOf(799)).toBe("low");
    expect(trafficTierOf(800)).toBe("medium");
    expect(trafficTierOf(2999)).toBe("medium");
    expect(trafficTierOf(3000)).toBe("high");
    expect(trafficTierOf(50000)).toBe("high");
  });
});

describe("E-39 D3 — adaptive control pool maps count to confidence (2 = reduced, 3 = stronger, <2 = not computed)", () => {
  it("fewer than 2 defensible controls does NOT compute a verdict - it routes to insufficient_data/low (never a freeze error)", () => {
    const r = summarizeVerdict({ windows: [win({ adjustedLift: 99, controlsUsed: 1 })], baselineImpressions: 5000, baselineClicks: 200 });
    expect(r.verdict).toBe("insufficient_data");
    expect(r.confidence).toBe("low");
  });
  it("exactly 2 controls yields a computed verdict at REDUCED (medium) confidence, even on a high-traffic page", () => {
    const r = summarizeVerdict({ windows: [win({ adjustedLift: 60, controlsUsed: 2 })], baselineImpressions: 5000, baselineClicks: 200 });
    expect(r.verdict).toBe("won");
    expect(r.confidence).toBe("medium"); // two comparison pages never auto-yield HIGH
  });
  it("3 controls on a high-traffic page yields the STRONGER (high) confidence tier", () => {
    const r = summarizeVerdict({ windows: [win({ adjustedLift: 60, controlsUsed: 3 })], baselineImpressions: 5000, baselineClicks: 200 });
    expect(r.verdict).toBe("won");
    expect(r.confidence).toBe("high");
  });
  it("2 controls on a thin-traffic page reads LOW confidence (thin evidence honestly reduced)", () => {
    const r = summarizeVerdict({ windows: [win({ adjustedLift: 60, controlsUsed: 2 })], baselineImpressions: 400, baselineClicks: 40 });
    // baseline 400 >= MIN_BASELINE_IMPRESSIONS(200) so a verdict computes, but < 800 so confidence stays low.
    expect(r.verdict).toBe("won");
    expect(r.confidence).toBe("low");
  });
});
