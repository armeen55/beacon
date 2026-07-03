import { describe, it, expect } from "vitest";

import { proofBadgeLabel, proofBadgeLabelFromVerdict, proofBadgeMaturesOn } from "./proof-badge";
import { plainSearchHeadline } from "./proof-plain-search-line";
import { searchAndTrafficDisagree, reconciliationSentence } from "./proof-reconciliation";
import { buildZeroMatureLeadSentence } from "./proof-summary-section";
import type { MeasurementPresentation } from "@/domains/proof-gsc/measurement-maturity";

/**
 * Operator-experience fix batch C - pins the plain-language vocabulary
 * introduced to replace the 15-way uncertainty thesaurus (C2), the buried
 * zero-mature lead (C1), the row-one contradiction (C3), and the statistics-
 * as-headline primary line (C4). Every function here is presentation-only:
 * none of them write to or reinterpret the measurement-maturity domain enum.
 */

function pres(overrides: Partial<MeasurementPresentation>): MeasurementPresentation {
  return {
    maturity: "collecting",
    direction: "unknown",
    verdict: null,
    confidence: "low",
    headline: "",
    explanation: "",
    nextCheckpoint: null,
    requiredDataThrough: null,
    availableDataThrough: null,
    evidenceStrength: "tracking",
    attributionQuality: "clean",
    learningEligibility: false,
    basisDay: null,
    tone: "waiting",
    weatherCaveat: null,
    weatherQuarantined: false,
    weakComparisonCaveat: null,
    weakComparisonFlagged: false,
    seasonalInflectionCaveat: null,
    seasonalInflectionFlagged: false,
    recrawlPending: false,
    recrawlPendingCaveat: null,
    controlContaminationFlagged: false,
    controlContaminationCaveat: null,
    controlPoolHealthLine: null,
    ...overrides,
  };
}

describe("proofBadgeLabel - collapses the maturity vocabulary to six words (C2)", () => {
  it("scheduled/collecting/blocked_data all read as Waiting", () => {
    expect(proofBadgeLabel(pres({ maturity: "scheduled" }))).toBe("Waiting");
    expect(proofBadgeLabel(pres({ maturity: "collecting" }))).toBe("Waiting");
    expect(proofBadgeLabel(pres({ maturity: "blocked_data" }))).toBe("Waiting");
  });

  it("early/interim checkpoints lean, never claim a final verdict", () => {
    expect(proofBadgeLabel(pres({ maturity: "early_checkpoint", direction: "positive" }))).toBe("Leaning good");
    expect(proofBadgeLabel(pres({ maturity: "early_checkpoint", direction: "negative" }))).toBe("Leaning bad");
    expect(proofBadgeLabel(pres({ maturity: "early_checkpoint", direction: "neutral" }))).toBe("Waiting");
    expect(proofBadgeLabel(pres({ maturity: "interim_checkpoint", direction: "positive" }))).toBe("Leaning good");
    expect(proofBadgeLabel(pres({ maturity: "interim_checkpoint", direction: "negative" }))).toBe("Leaning bad");
  });

  it("attribution_limited leans on direction like an early read", () => {
    expect(proofBadgeLabel(pres({ maturity: "attribution_limited", direction: "positive" }))).toBe("Leaning good");
    expect(proofBadgeLabel(pres({ maturity: "attribution_limited", direction: "negative" }))).toBe("Leaning bad");
  });

  it("mature_result reads as exactly one of the three final words", () => {
    expect(proofBadgeLabel(pres({ maturity: "mature_result", verdict: "helped" }))).toBe("Helped");
    expect(proofBadgeLabel(pres({ maturity: "mature_result", verdict: "did_not_help" }))).toBe("Did not help");
    expect(proofBadgeLabel(pres({ maturity: "mature_result", verdict: "no_lift" }))).toBe("No clear change");
  });

  it("inconclusive (mature window, insufficient evidence) reads as No clear change", () => {
    expect(proofBadgeLabel(pres({ maturity: "inconclusive" }))).toBe("No clear change");
  });
});

describe("proofBadgeMaturesOn - secondary date text (C2)", () => {
  it("names the next checkpoint date before a verdict exists", () => {
    expect(proofBadgeMaturesOn(pres({ maturity: "collecting", nextCheckpoint: "2026-07-10" }))).toBe(
      "matures 2026-07-10",
    );
  });
  it("is null once a final verdict exists", () => {
    expect(proofBadgeMaturesOn(pres({ maturity: "mature_result", nextCheckpoint: null }))).toBeNull();
    expect(proofBadgeMaturesOn(pres({ maturity: "inconclusive", nextCheckpoint: "2026-07-10" }))).toBeNull();
  });
});

describe("proofBadgeLabelFromVerdict - legacy fallback path collapse (C2)", () => {
  it("won/lost before day 28 lean; at day 28 they are final", () => {
    expect(proofBadgeLabelFromVerdict("won", 7)).toBe("Leaning good");
    expect(proofBadgeLabelFromVerdict("won", 28)).toBe("Helped");
    expect(proofBadgeLabelFromVerdict("lost", 14)).toBe("Leaning bad");
    expect(proofBadgeLabelFromVerdict("lost", 28)).toBe("Did not help");
  });
  it("everything else waits or reads no-clear-change", () => {
    expect(proofBadgeLabelFromVerdict("measuring", null)).toBe("Waiting");
    expect(proofBadgeLabelFromVerdict("insufficient_data", null)).toBe("Waiting");
    expect(proofBadgeLabelFromVerdict("inconclusive", 28)).toBe("No clear change");
  });
});

describe("plainSearchHeadline - plain primary line, stats moved to detail (C4)", () => {
  it("mature results read as a plain final call", () => {
    expect(plainSearchHeadline("positive", true)).toBe("This helped.");
    expect(plainSearchHeadline("negative", true)).toBe("This did not help.");
    expect(plainSearchHeadline("neutral", true)).toBe("No clear change.");
  });
  it("pre-mature reads as a lean, never a percent-sure headline", () => {
    expect(plainSearchHeadline("positive", false)).toBe("This is probably helping.");
    expect(plainSearchHeadline("negative", false)).toBe("This is probably hurting.");
    expect(plainSearchHeadline("unknown", false)).toBe("Not clear yet.");
  });
});

describe("searchAndTrafficDisagree / reconciliationSentence - row-one contradiction (C3)", () => {
  it("flags a clean positive-vs-negative disagreement", () => {
    expect(searchAndTrafficDisagree("negative", 0.27)).toBe(true);
    expect(searchAndTrafficDisagree("positive", -0.1)).toBe(true);
  });
  it("never flags when either side is neutral, unknown, or missing", () => {
    expect(searchAndTrafficDisagree("neutral", 0.27)).toBe(false);
    expect(searchAndTrafficDisagree("unknown", 0.27)).toBe(false);
    expect(searchAndTrafficDisagree("negative", null)).toBe(false);
    expect(searchAndTrafficDisagree("negative", undefined)).toBe(false);
    expect(searchAndTrafficDisagree("positive", 0.1)).toBe(false);
  });
  it("the sentence names the 28-day Google read as the deciding one, no dashes", () => {
    const s = reconciliationSentence();
    expect(s).toContain("28-day");
    expect(s).not.toMatch(/[–—]/);
  });
});

describe("buildZeroMatureLeadSentence - buried honest lead (C1)", () => {
  it("states the real count and the soonest due date when nothing has settled", () => {
    const s = buildZeroMatureLeadSentence({ totalTracked: 25, matureTotal: 0, soonestLabel: "Saturday" });
    expect(s).toBe(
      "None of your 25 changes has a final verdict yet. The first ones are due Saturday. Early signals below can still flip.",
    );
  });
  it("singular phrasing for exactly one tracked change", () => {
    const s = buildZeroMatureLeadSentence({ totalTracked: 1, matureTotal: 0, soonestLabel: "Monday" });
    expect(s).toBe("None of your 1 change has a final verdict yet. The first one is due Monday. Early signals below can still flip.");
  });
  it("handles an unknown soonest date honestly (no invented day)", () => {
    const s = buildZeroMatureLeadSentence({ totalTracked: 3, matureTotal: 0, soonestLabel: null });
    expect(s).toBe("None of your 3 changes has a final verdict yet. Early signals below can still flip.");
  });
  it("handles the any-day-now case", () => {
    const s = buildZeroMatureLeadSentence({ totalTracked: 4, matureTotal: 0, soonestLabel: "any day now" });
    expect(s).toContain("The first one is due any day now.");
  });
  it("returns null once at least one change has a mature result", () => {
    expect(buildZeroMatureLeadSentence({ totalTracked: 10, matureTotal: 2, soonestLabel: "Friday" })).toBeNull();
  });
  it("returns null with zero tracked changes (empty ledger has its own empty state)", () => {
    expect(buildZeroMatureLeadSentence({ totalTracked: 0, matureTotal: 0, soonestLabel: null })).toBeNull();
  });
  it("has no em or en dash", () => {
    const s = buildZeroMatureLeadSentence({ totalTracked: 25, matureTotal: 0, soonestLabel: "Saturday" })!;
    expect(s).not.toMatch(/[–—]/);
  });
});
