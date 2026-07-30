import { describe, expect, it } from "vitest";
import {
  addDays, bundleReads, detectOverlaps, evaluateChange, evaluateWindows, metricFor, rankingPriors,
  readLedger, toKernelInput, verdictPhrase, type KernelInput, type LedgerRecordLike,
} from "@/domains/measurement/proof-gsc/kernel";
/**
 * Outcome-level contract tests for the measurement kernel. These pin CUSTOMER TRUTH, not
 * implementation: every historical shipment maps to exactly one read (nothing disappears);
 * the 7/14/28 windows respect Google's reporting lag; overlapping changes on one page read
 * as confounded; only cleanly-settled reads feed ranking; no operator string claims cause.
 */
const NOW = new Date("2026-06-01T00:00:00Z");
function win(day: 7 | 14 | 28, over: Partial<KernelInput["windows"][number]> = {}) {
  return {
    day, ran: true, adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedPosLift: 0,
    adjustedImpressionsLift: 0, controlsUsed: 3, treatedPostImpressions: 5000, ...over,
  };
}
function baseInput(over: Partial<KernelInput> = {}): KernelInput {
  return {
    id: "c1", page: "https://site.com/a", path: "/a", actionType: "edit_title", shippedAt: "2026-05-01",
    baselineImpressions: 5000, baselineClicks: 400, windows: [win(7), win(14), win(28)], ...over,
  };
}
const CLOSED_WINDOWS = evaluateWindows("2026-05-01", NOW, "2026-06-01");
describe("window evaluation and reporting lag", () => {
  it("marks a window waiting before its calendar close", () => { // shipped 2 days ago; no window has closed
    expect(evaluateWindows("2026-05-30", NOW, "2026-05-31").every((w) => w.state === "waiting")).toBe(true);
  });
  it("marks a closed calendar window pending_data until Google finalizes it", () => { // 7-day window closed 2026-05-08, finalized data only reaches 2026-05-05
    expect(evaluateWindows("2026-05-01", NOW, "2026-05-05").find((w) => w.day === 7)!.state).toBe("pending_data");
  });
  it("marks a window closed once finalized data passes its close date", () => {
    const w7 = CLOSED_WINDOWS.find((w) => w.day === 7)!;
    expect([w7.state, w7.closesOn]).toEqual(["closed", addDays("2026-05-01", 7)]);
  });
});
describe("individual directional reads", () => {
  it("reads a real click gain as an improvement, never as causal proof", () => {
    const read = evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: 40 })] }), CLOSED_WINDOWS, []);
    expect(["directional_improvement", "stronger_improvement"]).toContain(read.verdict);
    expect(read.rankingSignal).toBeGreaterThan(0);
    // Point 7: never claims causality.
    expect(read.headline.toLowerCase()).not.toContain("caused");
    expect(read.headline.toLowerCase()).toContain("similar pages");
  });
  it("owns a decline observationally, with no plus sign on a loss and no verdict while it is still measuring", () => {
    const read = evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: -40 })] }), CLOSED_WINDOWS, []);
    expect(read.verdict).toBe("directional_decline");
    expect(read.rankingSignal).toBeLessThan(0);
    expect(read.headline).toContain("moved down after the change");
    expect(read.headline).toContain("40 clicks behind similar pages");
    expect(read.headline).not.toMatch(/did not work|\+/); // a loss never renders a plus sign
    // The same loss read on the 7-day window is still measuring: no closing verdict.
    const early = evaluateChange(baseInput({ actionType: "content", windows: [win(7, { adjustedClicksLift: -40 })] }), evaluateWindows("2026-05-01", NOW, "2026-05-10"), []);
    expect(early.basisDay).toBe(7);
    expect(early.headline).toContain("Still measuring");
    expect(early.headline).not.toMatch(/did not work|try something else|different angle/);
  });
  it("stays waiting with no closed window and never reads a dead end", () => {
    const read = evaluateChange(baseInput({ windows: [win(7, { ran: false })] }), evaluateWindows("2026-05-30", NOW, "2026-05-31"), []);
    expect([read.verdict, read.rankingSignal]).toEqual(["waiting", 0]);
  });
  it("reads insufficient evidence on a thin baseline", () => {
    const read = evaluateChange(baseInput({ baselineImpressions: 50, windows: [win(28, { adjustedClicksLift: 40 })] }), CLOSED_WINDOWS, []);
    expect([read.verdict, read.rankingSignal]).toEqual(["insufficient_evidence", 0]);
    expect(read.confidenceReasons.join(" ")).toContain("50 impressions");
  });
  it("reads insufficient evidence with too few comparable pages", () => {
    const read = evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: 40, controlsUsed: 1 })] }), CLOSED_WINDOWS, []);
    expect(read.verdict).toBe("insufficient_evidence");
  });
});
describe("overlap and confounding honesty", () => {
  it("flags same-page overlapping windows", () => {
    const overlaps = detectOverlaps([
      { id: "a", path: "/x", shippedAt: "2026-05-01" }, { id: "b", path: "/x", shippedAt: "2026-05-10" }, { id: "c", path: "/y", shippedAt: "2026-05-05" },
    ]);
    expect(overlaps.get("a")).toContain("b");
    expect(overlaps.get("b")).toContain("a");
    expect(overlaps.get("c")).toEqual([]);
  });
  it("does NOT flag same-page changes more than 28 days apart", () => {
    const overlaps = detectOverlaps([{ id: "a", path: "/x", shippedAt: "2026-05-01" }, { id: "b", path: "/x", shippedAt: "2026-07-01" }]);
    expect(overlaps.get("a")).toEqual([]);
  });
  it("downgrades a directional read to confounded when changes overlap", () => {
    const read = evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: 40 })] }), CLOSED_WINDOWS, ["other-change"]);
    expect([read.verdict, read.rankingSignal]).toEqual(["confounded", 0]);
    expect(read.headline).toContain("cannot say which one");
  });
  it("produces a bundle group read for overlapping same-page changes", () => {
    const records: LedgerRecordLike[] = [
      { id: "a", page: "p", path: "/x", actionType: "content", shippedAt: "2026-05-01", baseline: { impressions: 5000, clicks: 400 }, windows: [{ day: 28, ran: true, adjustedLift: 90, controlsUsed: 3, treatedPostImpressions: 5000 }] },
      { id: "b", page: "p", path: "/x", actionType: "content", shippedAt: "2026-05-05", baseline: { impressions: 5000, clicks: 400 }, windows: [{ day: 28, ran: true, adjustedLift: 70, controlsUsed: 3, treatedPostImpressions: 5000 }] },
    ];
    const reads = readLedger(records, new Date("2026-07-15T00:00:00Z"), "2026-07-01");
    expect(reads.every((r) => r.verdict === "confounded")).toBe(true);
    const bundles = bundleReads(reads);
    expect(bundles).toHaveLength(1);
    expect([bundles[0].changeIds.sort(), bundles[0].verdict]).toEqual([["a", "b"], "directional_improvement"]);
    expect(bundles[0].headline).toContain("cannot split the credit");
  });
});
describe("historical records are preserved end to end", () => {
  it("maps every historical record to exactly one read", () => {
    const records: LedgerRecordLike[] = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`, page: `https://site.com/p${i}`, path: `/p${i}`, actionType: i % 2 === 0 ? "edit_title" : "content",
      shippedAt: "2026-05-01", baseline: { impressions: 4000, clicks: 300 },
      windows: [{ day: 28, ran: true, adjustedLift: 10, adjustedCtrLift: 0.01, controlsUsed: 3, treatedPostImpressions: 4000 }],
    }));
    const reads = readLedger(records, NOW, "2026-07-01");
    expect([reads.length, new Set(reads.map((r) => r.id)).size]).toEqual([12, 12]);
  });
  it("tolerates a legacy record with missing optional fields", () => {
    const input = toKernelInput({ id: "x", page: "p", path: "/p", actionType: "keep", shippedAt: "2026-05-01" });
    expect([input.baselineImpressions, input.windows]).toEqual([0, []]);
    expect(evaluateChange(input, CLOSED_WINDOWS, []).verdict).toBe("waiting");
  });
});
describe("ranking outcome signal", () => {
  it("earns a per-action-type prior only from settled reads at sample floor", () => {
    const priors = rankingPriors(Array.from({ length: 3 }, () => ({ actionType: "edit_title", read: { rankingSignal: 0.6 } })));
    expect(priors.get("edit_title")).toBeCloseTo(0.6, 5);
  });
  it("ignores zero-signal (waiting / confounded / insufficient) reads", () => {
    const priors = rankingPriors([{ actionType: "faq", read: { rankingSignal: 0 } }, { actionType: "faq", read: { rankingSignal: 0 } }, { actionType: "faq", read: { rankingSignal: 0 } }]);
    expect(priors.has("faq")).toBe(false);
  });
  it("stays neutral below the sample floor", () => {
    expect(rankingPriors([{ actionType: "meta", read: { rankingSignal: 0.6 } }]).has("meta")).toBe(false);
  });
});
describe("metric selection and vocabulary", () => {
  it("judges snippet plays on CTR, rank plays on position, else clicks", () => {
    expect([metricFor("edit_title"), metricFor("internal_link"), metricFor("content")]).toEqual(["ctr", "position", "clicks"]);
  });
  it("exposes a phrase for every verdict with no dashes", () => {
    for (const v of ["waiting", "insufficient_evidence", "directional_decline", "no_clear_movement", "directional_improvement", "stronger_improvement", "confounded"] as const) {
      const phrase = verdictPhrase(v);
      expect(phrase.length).toBeGreaterThan(0);
      expect(phrase).not.toMatch(/[—–]/);
    }
  });
});
