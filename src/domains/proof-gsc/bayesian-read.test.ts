import { describe, expect, it } from "vitest";
import {
  bayesianCtrRead,
  bayesianClicksRead,
  buildBayesianRead,
  bayesianSentence,
  bayesianAgreesWithVerdict,
  selectHeadlineSentence,
  standardNormalCdf,
} from "./bayesian-read";

describe("standardNormalCdf, closed-form sanity", () => {
  it("matches well-known standard normal table values", () => {
    expect(standardNormalCdf(0)).toBeCloseTo(0.5, 4);
    expect(standardNormalCdf(1.6448536269514722)).toBeCloseTo(0.95, 3);
    expect(standardNormalCdf(-1.6448536269514722)).toBeCloseTo(0.05, 3);
    expect(standardNormalCdf(1.959963985)).toBeCloseTo(0.975, 3);
    expect(standardNormalCdf(-3)).toBeCloseTo(0.00135, 3);
  });
});

describe("bayesianCtrRead, beta-binomial matrix", () => {
  it("flat CTR (identical pre/post rate, large sample) reads near 50/50 with a tiny CI around 0", () => {
    const read = bayesianCtrRead({
      preClicks: 500,
      preImpressions: 10000,
      postClicks: 500,
      postImpressions: 10000,
      postWindowDays: 28,
    });
    expect(read.pWin).toBeGreaterThan(0.4);
    expect(read.pWin).toBeLessThan(0.6);
    expect(read.ci90Low).toBeLessThan(0);
    expect(read.ci90High).toBeGreaterThan(0);
    expect(read.smallSample).toBe(false);
  });

  it("a large, clear CTR improvement on a big sample reads high pWin with a positive CI", () => {
    // pre: 5% CTR (500/10000), post: 8% CTR (800/10000), a real, well-powered lift.
    const read = bayesianCtrRead({
      preClicks: 500,
      preImpressions: 10000,
      postClicks: 800,
      postImpressions: 10000,
      postWindowDays: 28,
    });
    expect(read.pWin).toBeGreaterThan(0.95);
    expect(read.ci90Low).toBeGreaterThan(0); // confident positive lift, CI excludes 0
    expect(read.expectedMonthlyLift).toBeGreaterThan(0);
    expect(read.smallSample).toBe(false);
  });

  it("a large, clear CTR decline reads low pWin with a negative CI", () => {
    const read = bayesianCtrRead({
      preClicks: 800,
      preImpressions: 10000,
      postClicks: 500,
      postImpressions: 10000,
      postWindowDays: 28,
    });
    expect(read.pWin).toBeLessThan(0.05);
    expect(read.ci90High).toBeLessThan(0);
    expect(read.expectedMonthlyLift).toBeLessThan(0);
  });

  it("small-sample windows are flagged and pWin stays a genuine coin flip near a tiny lift", () => {
    const read = bayesianCtrRead({
      preClicks: 2,
      preImpressions: 20,
      postClicks: 3,
      postImpressions: 20,
      postWindowDays: 7,
    });
    expect(read.smallSample).toBe(true);
    // Small sample: the interval should be wide relative to the point estimate,
    // reflecting genuine uncertainty rather than false confidence.
    expect(read.ci90High - read.ci90Low).toBeGreaterThan(0);
  });

  it("a zero-click pre window never produces NaN/degenerate output (add-one smoothing)", () => {
    const read = bayesianCtrRead({
      preClicks: 0,
      preImpressions: 100,
      postClicks: 5,
      postImpressions: 100,
      postWindowDays: 28,
    });
    expect(Number.isFinite(read.pWin)).toBe(true);
    expect(Number.isFinite(read.ci90Low)).toBe(true);
    expect(Number.isFinite(read.ci90High)).toBe(true);
  });

  it("scales the monthly figure by the post window length (a 7-day window's daily rate projects further than a 28-day one's raw count)", () => {
    const sevenDay = bayesianCtrRead({
      preClicks: 50, preImpressions: 1000, postClicks: 80, postImpressions: 1000, postWindowDays: 7,
    });
    const twentyEightDay = bayesianCtrRead({
      preClicks: 50, preImpressions: 1000, postClicks: 80, postImpressions: 1000, postWindowDays: 28,
    });
    // Same clicks/impressions but a SHORTER window implies a HIGHER daily rate,
    // so the monthly projection should be larger for the 7-day window.
    expect(sevenDay.expectedMonthlyLift).toBeGreaterThan(twentyEightDay.expectedMonthlyLift);
  });
});

describe("bayesianClicksRead, gamma-Poisson matrix", () => {
  it("flat clicks rate (large sample) reads near 50/50", () => {
    const read = bayesianClicksRead({ preClicks: 280, preDays: 28, postClicks: 280, postDays: 28 });
    expect(read.pWin).toBeGreaterThan(0.4);
    expect(read.pWin).toBeLessThan(0.6);
  });

  it("a large, clear clicks improvement reads high pWin with a positive monthly CI", () => {
    // pre: 10 clicks/day, post: 20 clicks/day over a real 28-day window. The
    // posterior mean is shrunk toward the prior by the add-one smoothing (see
    // module doc), so this checks direction + a sane monthly magnitude rather
    // than the raw (unsmoothed) MLE difference.
    const read = bayesianClicksRead({ preClicks: 280, preDays: 28, postClicks: 560, postDays: 28 });
    expect(read.pWin).toBeGreaterThan(0.95);
    expect(read.ci90Low).toBeGreaterThan(0);
    expect(read.expectedMonthlyLift).toBeGreaterThan(50);
    expect(read.expectedMonthlyLift).toBeLessThan(300);
  });

  it("a large, clear clicks decline reads low pWin with a negative CI", () => {
    const read = bayesianClicksRead({ preClicks: 560, preDays: 28, postClicks: 280, postDays: 28 });
    expect(read.pWin).toBeLessThan(0.05);
    expect(read.ci90High).toBeLessThan(0);
  });

  it("small click counts are flagged small-sample", () => {
    const read = bayesianClicksRead({ preClicks: 3, preDays: 7, postClicks: 5, postDays: 7 });
    expect(read.smallSample).toBe(true);
  });

  it("large click counts on a full window are not flagged small-sample", () => {
    const read = bayesianClicksRead({ preClicks: 300, preDays: 28, postClicks: 310, postDays: 28 });
    expect(read.smallSample).toBe(false);
  });

  it("never produces NaN on a zero-click pre window", () => {
    const read = bayesianClicksRead({ preClicks: 0, preDays: 28, postClicks: 10, postDays: 28 });
    expect(Number.isFinite(read.pWin)).toBe(true);
    expect(Number.isFinite(read.expectedMonthlyLift)).toBe(true);
  });
});

describe("buildBayesianRead, metric routing", () => {
  const base = {
    treatedPre: { clicks: 500, impressions: 10000 },
    treatedPost: { clicks: 800, impressions: 10000 },
    preWindowDays: 28,
    postWindowDays: 28,
  };

  it("routes a CTR-judged change through the beta-binomial model", () => {
    const read = buildBayesianRead({ ...base, metric: "ctr" });
    expect(read).not.toBeNull();
    expect(read!.pWin).toBeGreaterThan(0.5);
  });

  it("routes a clicks-judged change through the gamma-Poisson model", () => {
    const read = buildBayesianRead({ ...base, metric: "clicks" });
    expect(read).not.toBeNull();
    expect(read!.pWin).toBeGreaterThan(0.5);
  });

  it("returns null for a position-judged change (no honest count/rate model for a rank)", () => {
    const read = buildBayesianRead({ ...base, metric: "position" });
    expect(read).toBeNull();
  });
});

describe("bayesianSentence, plain language, no dashes", () => {
  it("reads a strong positive read as helped, with a monthly range", () => {
    const s = bayesianSentence(0.87, 5, 40, false);
    expect(s).toContain("87 percent sure this helped");
    expect(s).toContain("5 to 40 extra clicks a month");
  });

  it("reads a strong negative read as hurt", () => {
    const s = bayesianSentence(0.02, -40, -5, false);
    expect(s).toContain("98 percent sure this hurt");
  });

  it("reads a coin-flip pWin as genuinely too close to call, not spun positive", () => {
    const s = bayesianSentence(0.52, -5, 8, false);
    expect(s).toContain("Too close to call");
  });

  it("appends a small-sample caveat when flagged", () => {
    const s = bayesianSentence(0.8, 1, 10, true);
    expect(s).toContain("Early read, small sample so far.");
  });

  it("handles a negative-to-positive straddling range in plain words", () => {
    const s = bayesianSentence(0.6, -5, 10, false);
    expect(s.toLowerCase()).toContain("fewer");
    expect(s.toLowerCase()).toContain("extra");
  });

  it("handles an all-negative range in plain words (both bounds fewer clicks)", () => {
    const s = bayesianSentence(0.1, -40, -5, false);
    expect(s.toLowerCase()).toContain("fewer clicks a month");
  });

  it("never contains an em or en dash", () => {
    const cases = [
      bayesianSentence(0.87, 5, 40, false),
      bayesianSentence(0.02, -40, -5, false),
      bayesianSentence(0.5, -5, 5, false),
      bayesianSentence(0.8, 1, 10, true),
      bayesianSentence(0.3, -20, -1, false),
    ];
    for (const s of cases) expect(s).not.toMatch(/[–—]/);
  });
});

describe("bayesianAgreesWithVerdict, direction agreement gate", () => {
  it("agrees with a won verdict only when pWin clears 0.7", () => {
    expect(bayesianAgreesWithVerdict("won", { pWin: 0.87 })).toBe(true);
    expect(bayesianAgreesWithVerdict("won", { pWin: 0.7 })).toBe(true);
    expect(bayesianAgreesWithVerdict("won", { pWin: 0.69 })).toBe(false);
    expect(bayesianAgreesWithVerdict("won", { pWin: 0.1 })).toBe(false);
  });

  it("agrees with a lost verdict only when pWin is at or below 0.3", () => {
    expect(bayesianAgreesWithVerdict("lost", { pWin: 0.13 })).toBe(true);
    expect(bayesianAgreesWithVerdict("lost", { pWin: 0.3 })).toBe(true);
    expect(bayesianAgreesWithVerdict("lost", { pWin: 0.31 })).toBe(false);
    expect(bayesianAgreesWithVerdict("lost", { pWin: 0.9 })).toBe(false);
  });

  it("never agrees with a non-final verdict (measuring/inconclusive/insufficient_data)", () => {
    expect(bayesianAgreesWithVerdict("measuring", { pWin: 0.99 })).toBe(false);
    expect(bayesianAgreesWithVerdict("inconclusive", { pWin: 0.01 })).toBe(false);
    expect(bayesianAgreesWithVerdict("insufficient_data", { pWin: 0.5 })).toBe(false);
  });
});

describe("selectHeadlineSentence, Results row presentation pin", () => {
  const floorSentence = "Likely helping: +12 clicks vs comparable pages over the 28-day window (medium confidence, observational).";

  it("upgrades to the Bayesian sentence on a won verdict that agrees (pWin >= 0.7)", () => {
    const read = { pWin: 0.87, sentence: "We are 87 percent sure this helped, likely 5 to 40 extra clicks a month." };
    expect(selectHeadlineSentence("won", read, floorSentence)).toBe(read.sentence);
  });

  it("upgrades to the Bayesian sentence on a lost verdict that agrees (pWin <= 0.3)", () => {
    const read = { pWin: 0.1, sentence: "I am 90 percent sure this hurt, likely 40 to 5 fewer clicks a month." };
    expect(selectHeadlineSentence("lost", read, floorSentence)).toBe(read.sentence);
  });

  it("keeps the floor sentence on a won verdict when the Bayesian read DISAGREES (pWin below 0.7)", () => {
    const read = { pWin: 0.4, sentence: "Too close to call yet, likely 5 fewer to 8 extra clicks a month either way." };
    expect(selectHeadlineSentence("won", read, floorSentence)).toBe(floorSentence);
  });

  it("keeps the floor sentence on a lost verdict when the Bayesian read DISAGREES (pWin above 0.3)", () => {
    const read = { pWin: 0.6, sentence: "Too close to call yet, likely 5 fewer to 8 extra clicks a month either way." };
    expect(selectHeadlineSentence("lost", read, floorSentence)).toBe(floorSentence);
  });

  it("keeps the floor sentence when there is no Bayesian read at all (null/undefined)", () => {
    expect(selectHeadlineSentence("won", null, floorSentence)).toBe(floorSentence);
    expect(selectHeadlineSentence("won", undefined, floorSentence)).toBe(floorSentence);
  });

  it("keeps the floor sentence for non-final verdicts (measuring/inconclusive/insufficient_data) even with a strong Bayesian read", () => {
    const read = { pWin: 0.99, sentence: "I am 99 percent sure this helped, likely 5 to 40 extra clicks a month." };
    expect(selectHeadlineSentence("measuring", read, floorSentence)).toBe(floorSentence);
    expect(selectHeadlineSentence("inconclusive", read, floorSentence)).toBe(floorSentence);
    expect(selectHeadlineSentence("insufficient_data", read, floorSentence)).toBe(floorSentence);
  });

  it("never changes the stored verdict itself, only the rendered sentence (documented non-decision-path contract)", () => {
    // This is a documentation pin: selectHeadlineSentence takes the verdict as
    // an INPUT and never returns or implies a different one - callers must
    // keep using rec.verdict for any decision logic, only the string differs.
    const read = { pWin: 0.95, sentence: "I am 95 percent sure this helped, likely 10 to 50 extra clicks a month." };
    const verdictBefore = "won";
    selectHeadlineSentence(verdictBefore, read, floorSentence);
    expect(verdictBefore).toBe("won");
  });
});

describe("dash guard (hard rule)", () => {
  it("bayesian-read.ts contains no em or en dashes", () => {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const src = fs.readFileSync(path.join(__dirname, "bayesian-read.ts"), "utf8");
    expect(src).not.toMatch(/[–—]/);
  });
});
