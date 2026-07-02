import { describe, it, expect } from "vitest";
import {
  deriveMeasurementMaturity,
  buildMeasurementPresentation,
  basisDayOf,
  directionOf,
  isMatureOutcome,
  isInFlight,
  detectMeasurementOverlaps,
  measurementWindowOf,
  weakComparisonSentence,
  type MaturityInput,
} from "./measurement-maturity";

const NOW = new Date("2026-06-30T12:00:00Z");

function win(ran7: boolean, ran14: boolean, ran28: boolean) {
  return [
    { day: 7, ran: ran7 },
    { day: 14, ran: ran14 },
    { day: 28, ran: ran28 },
  ];
}

function input(over: Partial<MaturityInput>): MaturityInput {
  return {
    shippedAt: "2026-06-20",
    now: NOW,
    latestGscDate: "2026-06-27",
    windows: win(false, false, false),
    verdict: "measuring",
    controlsUsed: 4,
    baselineImpressions: 5000,
    overlap: null,
    live: true,
    ...over,
  };
}

describe("basisDayOf + directionOf", () => {
  it("basisDay is the longest CLOSED window", () => {
    expect(basisDayOf(win(false, false, false))).toBe(null);
    expect(basisDayOf(win(true, false, false))).toBe(7);
    expect(basisDayOf(win(true, true, false))).toBe(14);
    expect(basisDayOf(win(true, true, true))).toBe(28);
  });
  it("direction follows verdict, not maturity", () => {
    expect(directionOf("won")).toBe("positive");
    expect(directionOf("lost")).toBe("negative");
    expect(directionOf("inconclusive")).toBe("neutral");
    expect(directionOf("insufficient_data")).toBe("neutral");
    expect(directionOf("measuring")).toBe("unknown");
  });
});

describe("deriveMeasurementMaturity — maturity is from the CLOSED window, never the verdict", () => {
  it("not live / not shipped ⇒ scheduled", () => {
    expect(deriveMeasurementMaturity(input({ live: false }))).toBe("scheduled");
    expect(deriveMeasurementMaturity(input({ shippedAt: null }))).toBe("scheduled");
  });
  it("no window closed, checkpoint in the future ⇒ collecting", () => {
    // shipped 06-28, 7d checkOn 07-05 (future vs now 06-30) ⇒ collecting
    expect(deriveMeasurementMaturity(input({ shippedAt: "2026-06-28", windows: win(false, false, false) }))).toBe("collecting");
  });
  it("checkpoint DATE passed but GSC data not in ⇒ blocked_data (not a failure)", () => {
    // shipped 06-20, 7d checkOn 06-27 needs data through 06-26; Google only has 06-24
    expect(
      deriveMeasurementMaturity(input({ shippedAt: "2026-06-20", windows: win(false, false, false), latestGscDate: "2026-06-24" })),
    ).toBe("blocked_data");
  });
  it("7-day window closed ⇒ early_checkpoint (even if verdict says lost/won)", () => {
    expect(deriveMeasurementMaturity(input({ windows: win(true, false, false), verdict: "lost" }))).toBe("early_checkpoint");
    expect(deriveMeasurementMaturity(input({ windows: win(true, false, false), verdict: "won" }))).toBe("early_checkpoint");
  });
  it("14-day window closed ⇒ interim_checkpoint", () => {
    expect(deriveMeasurementMaturity(input({ windows: win(true, true, false), verdict: "won" }))).toBe("interim_checkpoint");
  });
  it("28-day window closed + sufficient + decided ⇒ mature_result", () => {
    expect(deriveMeasurementMaturity(input({ windows: win(true, true, true), verdict: "won", controlsUsed: 3, baselineImpressions: 5000 }))).toBe("mature_result");
  });
  it("28-day closed but insufficient controls/baseline ⇒ inconclusive (honest, not an error)", () => {
    expect(deriveMeasurementMaturity(input({ windows: win(true, true, true), verdict: "lost", controlsUsed: 1 }))).toBe("inconclusive");
    expect(deriveMeasurementMaturity(input({ windows: win(true, true, true), verdict: "inconclusive", controlsUsed: 4 }))).toBe("inconclusive");
  });
  it("accidental overlap dominates ⇒ attribution_limited (even with a closed window)", () => {
    expect(
      deriveMeasurementMaturity(input({ windows: win(true, true, true), verdict: "won", overlap: { kind: "overlap", otherChangeCount: 1 } })),
    ).toBe("attribution_limited");
  });
  it("intentional compound package does NOT force attribution_limited", () => {
    expect(
      deriveMeasurementMaturity(input({ windows: win(true, true, true), verdict: "won", controlsUsed: 3, baselineImpressions: 5000, overlap: { kind: "compound", otherChangeCount: 2 } })),
    ).toBe("mature_result");
  });
});

describe("THE live /cities case — 7-day lost/high must NOT read as a final loss", () => {
  // Exactly the prod row: shipped 06-20, only day-7 ran, stored verdict lost, 4 controls, big baseline.
  const p = buildMeasurementPresentation(
    input({ windows: win(true, false, false), verdict: "lost", controlsUsed: 4, baselineImpressions: 5000 }),
  );
  it("maturity is early_checkpoint, not mature", () => expect(p.maturity).toBe("early_checkpoint"));
  it("no FINAL verdict is emitted", () => expect(p.verdict).toBe(null));
  it("confidence is capped low (never mature-high off 7 days)", () => expect(p.confidence).toBe("low"));
  it("headline is an early signal, not 'Did not help' / 'Likely hurting'", () => {
    expect(p.headline).toBe("Early negative signal");
    expect(p.headline).not.toMatch(/did not help|likely hurt|lost/i);
  });
  it("evidence strength is directional, tone is not a red 'negative'", () => {
    expect(p.evidenceStrength).toBe("directional");
    expect(p.tone).not.toBe("negative");
  });
  it("is NOT learning-eligible and NOT a mature outcome", () => {
    expect(p.learningEligibility).toBe(false);
    expect(isMatureOutcome(p.maturity)).toBe(false);
    expect(isInFlight(p.maturity)).toBe(true);
  });
  it("points at the final checkpoint date", () => {
    expect(p.explanation).toContain("2026-07-18"); // 06-20 + 28d
  });
});

describe("mature presentation language + confidence", () => {
  it("mature won + strong sufficiency ⇒ 'Helped' / high / strong / learning-eligible", () => {
    const p = buildMeasurementPresentation(input({ windows: win(true, true, true), verdict: "won", controlsUsed: 3, baselineImpressions: 5000 }));
    expect(p.maturity).toBe("mature_result");
    expect(p.verdict).toBe("helped");
    expect(p.headline).toBe("Helped");
    expect(p.confidence).toBe("high");
    expect(p.evidenceStrength).toBe("strong");
    expect(p.learningEligibility).toBe(true);
    expect(isMatureOutcome(p.maturity)).toBe(true);
  });
  it("mature won but only medium sufficiency ⇒ 'Likely helped'", () => {
    const p = buildMeasurementPresentation(input({ windows: win(true, true, true), verdict: "won", controlsUsed: 2, baselineImpressions: 1000 }));
    expect(p.headline).toBe("Likely helped");
    expect(p.confidence).toBe("medium");
  });
  it("mature lost ⇒ 'Did not help' and learning-eligible", () => {
    const p = buildMeasurementPresentation(input({ windows: win(true, true, true), verdict: "lost", controlsUsed: 3, baselineImpressions: 5000 }));
    expect(p.verdict).toBe("did_not_help");
    expect(p.headline).toBe("Did not help");
    expect(p.learningEligibility).toBe(true);
  });
});

describe("blocked_data + collecting language never imply failure", () => {
  it("blocked_data explains it is waiting, not stalled", () => {
    const p = buildMeasurementPresentation(input({ shippedAt: "2026-06-20", windows: win(false, false, false), latestGscDate: "2026-06-24" }));
    expect(p.maturity).toBe("blocked_data");
    expect(p.verdict).toBe(null);
    expect(p.explanation).toMatch(/not stalled/i);
    expect(p.tone).toBe("waiting");
  });
  it("collecting announces the first checkpoint date", () => {
    const p = buildMeasurementPresentation(input({ shippedAt: "2026-06-28", windows: win(false, false, false), latestGscDate: "2026-06-27" }));
    expect(p.maturity).toBe("collecting");
    expect(p.nextCheckpoint).toBe("2026-07-05");
    expect(p.explanation).toContain("2026-07-05");
  });
});

describe("detectMeasurementOverlaps — same page within 28 days only", () => {
  it("flags two edits on the SAME page within 28 days", () => {
    const m = detectMeasurementOverlaps([
      { id: "a", path: "/cities", shippedAt: "2026-06-20" },
      { id: "b", path: "/cities", shippedAt: "2026-06-25" },
    ]);
    expect(m.get("a")?.kind).toBe("overlap");
    expect(m.get("b")?.kind).toBe("overlap");
  });
  it("does NOT flag different pages, or the same page >28 days apart", () => {
    const m = detectMeasurementOverlaps([
      { id: "a", path: "/cities", shippedAt: "2026-06-20" },
      { id: "b", path: "/finglish", shippedAt: "2026-06-21" }, // different page
      { id: "c", path: "/cities", shippedAt: "2026-08-01" }, // >28d later
    ]);
    expect(m.get("a")).toBeUndefined();
    expect(m.get("b")).toBeUndefined();
    expect(m.get("c")).toBeUndefined();
  });
  it("normalizes host + trailing slash when matching paths", () => {
    const m = detectMeasurementOverlaps([
      { id: "a", path: "https://iranopedia.com/cities/", shippedAt: "2026-06-20" },
      { id: "b", path: "/cities", shippedAt: "2026-06-22" },
    ]);
    expect(m.get("a")?.kind).toBe("overlap");
  });
});

describe("attribution_limited", () => {
  it("is directional, not learning-eligible, and explains the overlap", () => {
    const p = buildMeasurementPresentation(input({ windows: win(true, true, true), verdict: "won", overlap: { kind: "overlap", otherChangeCount: 1 } }));
    expect(p.maturity).toBe("attribution_limited");
    expect(p.verdict).toBe(null);
    expect(p.learningEligibility).toBe(false);
    expect(p.attributionQuality).toBe("limited");
    expect(p.explanation).toMatch(/overlap/i);
  });
});

describe("measurementWindowOf", () => {
  it("uses the basis (closed) window's check-on date as the window end", () => {
    expect(measurementWindowOf("2026-06-20", win(true, false, false))).toEqual({ start: "2026-06-20", end: "2026-06-27" });
    expect(measurementWindowOf("2026-06-20", win(true, true, true))).toEqual({ start: "2026-06-20", end: "2026-07-18" });
  });
  it("falls back to the soonest un-run checkpoint when nothing has closed yet", () => {
    expect(measurementWindowOf("2026-06-20", win(false, false, false))).toEqual({ start: "2026-06-20", end: "2026-06-27" });
  });
  it("returns null with no ship date", () => {
    expect(measurementWindowOf(null, win(false, false, false))).toBeNull();
  });
});

describe("algorithm-weather guard (master plan item 32) — additive, computed at read time", () => {
  it("a record with no shockWindows behaves exactly as before this field existed", () => {
    const p = buildMeasurementPresentation(input({ windows: win(true, true, true), verdict: "won", controlsUsed: 3, baselineImpressions: 5000 }));
    expect(p.weatherCaveat).toBeNull();
    expect(p.weatherQuarantined).toBe(false);
    expect(p.learningEligibility).toBe(true);
  });
  it("a mature win whose window overlaps a confirmed shock gets a caveat and loses learning eligibility", () => {
    const p = buildMeasurementPresentation(
      input({
        shippedAt: "2026-06-20",
        windows: win(true, true, true),
        verdict: "won",
        controlsUsed: 3,
        baselineImpressions: 5000,
        shockWindows: [{ id: "confirmed:x", start: "2026-07-08", end: "2026-07-22", kind: "confirmed", label: "the July update" }],
      }),
    );
    // Maturity/verdict/tone are UNCHANGED (additive, never rewrites the headline call).
    expect(p.maturity).toBe("mature_result");
    expect(p.verdict).toBe("helped");
    expect(p.headline).toBe("Helped");
    // But the caveat is visible and learning is revoked.
    expect(p.weatherQuarantined).toBe(true);
    expect(p.weatherCaveat).toMatch(/Google shifted the whole playing field/);
    expect(p.weatherCaveat).toMatch(/reading this result cautiously/);
    expect(p.learningEligibility).toBe(false);
  });
  it("a shock window that does NOT overlap the measurement window has no effect", () => {
    const p = buildMeasurementPresentation(
      input({
        shippedAt: "2026-06-20",
        windows: win(true, true, true),
        verdict: "won",
        controlsUsed: 3,
        baselineImpressions: 5000,
        shockWindows: [{ id: "confirmed:x", start: "2020-01-01", end: "2020-01-14", kind: "confirmed", label: "an old update" }],
      }),
    );
    expect(p.weatherQuarantined).toBe(false);
    expect(p.weatherCaveat).toBeNull();
    expect(p.learningEligibility).toBe(true);
  });
  it("an in-flight (early_checkpoint) record can also carry the caveat, still non-learning either way", () => {
    const p = buildMeasurementPresentation(
      input({
        shippedAt: "2026-06-20",
        windows: win(true, false, false),
        verdict: "won",
        shockWindows: [{ id: "confirmed:x", start: "2026-06-25", end: "2026-07-02", kind: "confirmed", label: "the June update" }],
      }),
    );
    expect(p.maturity).toBe("early_checkpoint");
    expect(p.weatherQuarantined).toBe(true);
    expect(p.learningEligibility).toBe(false); // already false pre-maturity; guard does not flip it true
  });
  it("emits no em or en dashes in the caveat sentence", () => {
    const p = buildMeasurementPresentation(
      input({
        shippedAt: "2026-06-20",
        windows: win(true, true, true),
        verdict: "won",
        controlsUsed: 3,
        baselineImpressions: 5000,
        shockWindows: [{ id: "confirmed:x", start: "2026-07-08", end: "2026-07-22", kind: "confirmed", label: "the July update" }],
      }),
    );
    expect(p.weatherCaveat).not.toMatch(/[–—]/);
  });
});

describe("parallel-trends veto (master plan item 33) — additive, computed at read time", () => {
  it("a record with weakComparison unset (default) behaves exactly as before this field existed", () => {
    const p = buildMeasurementPresentation(input({ windows: win(true, true, true), verdict: "won", controlsUsed: 3, baselineImpressions: 5000 }));
    expect(p.weakComparisonCaveat).toBeNull();
    expect(p.weakComparisonFlagged).toBe(false);
    expect(p.learningEligibility).toBe(true);
  });
  it("a mature win flagged weakComparison gets the honest caveat and loses learning eligibility", () => {
    const p = buildMeasurementPresentation(
      input({
        windows: win(true, true, true),
        verdict: "won",
        controlsUsed: 3,
        baselineImpressions: 5000,
        weakComparison: true,
      }),
    );
    // Maturity/verdict/headline are UNCHANGED (additive, never rewrites the headline call).
    expect(p.maturity).toBe("mature_result");
    expect(p.verdict).toBe("helped");
    expect(p.headline).toBe("Helped");
    // But the caveat is visible and learning is revoked.
    expect(p.weakComparisonFlagged).toBe(true);
    expect(p.weakComparisonCaveat).toBe(weakComparisonSentence());
    expect(p.weakComparisonCaveat).toMatch(/comparison pages were not moving like this page/);
    expect(p.weakComparisonCaveat).toMatch(/reading this result cautiously/);
    expect(p.learningEligibility).toBe(false);
  });
  it("weakComparison=false explicitly reads the same as unset", () => {
    const p = buildMeasurementPresentation(
      input({ windows: win(true, true, true), verdict: "won", controlsUsed: 3, baselineImpressions: 5000, weakComparison: false }),
    );
    expect(p.weakComparisonFlagged).toBe(false);
    expect(p.weakComparisonCaveat).toBeNull();
    expect(p.learningEligibility).toBe(true);
  });
  it("an in-flight (early_checkpoint) record can also carry the flag, still non-learning either way", () => {
    const p = buildMeasurementPresentation(
      input({ shippedAt: "2026-06-20", windows: win(true, false, false), verdict: "won", weakComparison: true }),
    );
    expect(p.maturity).toBe("early_checkpoint");
    expect(p.weakComparisonFlagged).toBe(true);
    expect(p.learningEligibility).toBe(false); // already false pre-maturity; guard does not flip it true
  });
  it("composes with the weather guard - both can fire on the same record independently", () => {
    const p = buildMeasurementPresentation(
      input({
        windows: win(true, true, true),
        verdict: "won",
        controlsUsed: 3,
        baselineImpressions: 5000,
        weakComparison: true,
        shockWindows: [{ id: "confirmed:x", start: "2026-07-08", end: "2026-07-22", kind: "confirmed", label: "the July update" }],
      }),
    );
    expect(p.weakComparisonFlagged).toBe(true);
    expect(p.weatherQuarantined).toBe(true);
    expect(p.learningEligibility).toBe(false);
  });
  it("emits no em or en dashes in the caveat sentence", () => {
    expect(weakComparisonSentence()).not.toMatch(/[–—]/);
    const p = buildMeasurementPresentation(
      input({ windows: win(true, true, true), verdict: "won", controlsUsed: 3, baselineImpressions: 5000, weakComparison: true }),
    );
    expect(p.weakComparisonCaveat).not.toMatch(/[–—]/);
  });
});
