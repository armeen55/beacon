import { describe, expect, it } from "vitest";
import {
  addDays, bandOf, evaluateChange, evaluateWindows, learningVerdictOf, metricFor, rankingPriors,
  readLedger, toKernelInput, verdictPhrase, type KernelInput, type LedgerRecordLike,
} from "@/domains/measurement/proof-gsc/kernel";
import { bundleReads, learningShape, overlapClosures } from "@/domains/measurement/proof-gsc/read-honesty";
import { day56Followup, isDueForMeasure } from "@/domains/measurement/proof-gsc/measure-lifecycle";
import { verdictSchedule, type VerdictScheduleRow } from "@/domains/measurement/proof-gsc/verdict-schedule";
import type { ShippedChangeRecord } from "@/domains/measurement/proof-gsc/shipped-change-store";
import type { ProofWindowDay, ProofWindowResult } from "@/domains/measurement/proof-gsc/types";
/** Outcome-level contract tests for the measurement kernel. These pin CUSTOMER TRUTH, not implementation: every historical shipment maps to exactly one read (nothing
 *  disappears); the 7/14/28 windows respect Google's reporting lag; overlapping changes on one page read as confounded; only cleanly-settled reads feed ranking; no
 *  operator string claims cause. */
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
    const overlaps = overlapClosures([
      { id: "a", path: "/x", anchoredAt: "2026-05-01" }, { id: "b", path: "/x", anchoredAt: "2026-05-10" }, { id: "c", path: "/y", anchoredAt: "2026-05-05" },
    ]);
    expect(overlaps.get("a")!.ids).toContain("b");
    expect(overlaps.get("b")!.ids).toContain("a");
    expect(overlaps.get("c")!.ids).toEqual([]);
  });
  it("does NOT flag same-page changes more than 28 days apart", () => {
    const overlaps = overlapClosures([{ id: "a", path: "/x", anchoredAt: "2026-05-01" }, { id: "b", path: "/x", anchoredAt: "2026-07-01" }]);
    expect(overlaps.get("a")!.ids).toEqual([]);
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
/** PHASE 7: the windows count from the stamp, a later change on the same page closes the earlier one's clean window instead of being silently measured as if it were
 *  clean, the day-56 read runs only when the day-28 read did not settle, and every settled read carries the learning shape. Fixtures only. */
const ledgerRow = (over: Partial<LedgerRecordLike> = {}): LedgerRecordLike => ({
  id: "a", page: "https://site.com/x", path: "/x", actionType: "content", shippedAt: "2026-05-01",
  baseline: { impressions: 5000, clicks: 400 },
  windows: [
    { day: 7, ran: true, adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 },
    { day: 14, ran: true, adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 },
    { day: 28, ran: true, adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 },
  ],
  ...over,
});
const LATE = new Date("2026-07-15T00:00:00Z");
describe("checkpoints count from the stamp", () => {
  it("counts every checkpoint from implementedAt when the row carries the stamp", () => {
    const read = readLedger([ledgerRow({ implementedAt: "2026-05-10T09:30:00.000Z" })], LATE, "2026-07-01")[0];
    expect(read.windows.map((w) => w.closesOn)).toEqual(["2026-05-17", "2026-05-24", "2026-06-07"]);
  });
  it("falls back to the ship date on a row written before there was a stamp", () => {
    const read = readLedger([ledgerRow()], LATE, "2026-07-01")[0];
    expect(read.windows.find((w) => w.day === 7)!.closesOn).toBe("2026-05-08");
  });
});
describe("overlap honesty: a later change closes the earlier one's clean window", () => {
  const twoChanges = (secondStamp: string) => readLedger([
    ledgerRow({ id: "first", implementedAt: "2026-05-01T00:00:00.000Z" }),
    ledgerRow({ id: "second", shippedAt: secondStamp, implementedAt: secondStamp }),
  ], LATE, "2026-07-01");
  it("keeps the reads that closed before the second change and confounds the ones after it", () => {
    const [first] = twoChanges("2026-05-12T00:00:00.000Z");
    expect(first.cleanUntil).toBe("2026-05-12");
    // The 7-day window closed 2026-05-08, before the page was touched again: it still stands.
    expect(first.windows.find((w) => w.day === 7)!.confounded).toBeUndefined();
    expect(first.windows.filter((w) => w.confounded === "overlapping_change").map((w) => w.day)).toEqual([14, 28]);
    expect(first.basisDay).toBe(7);
    expect(["directional_improvement", "stronger_improvement"]).toContain(first.verdict);
    // The operator reads a date, never a stamp.
    expect(first.caveats.join(" ")).toContain("changed the page again on May 12");
    expect(first.caveats.join(" ")).not.toMatch(/[—–]/);
  });
  it("confounds the read outright when the second change landed before any window closed", () => {
    const [first] = twoChanges("2026-05-03T00:00:00.000Z");
    expect(first.verdict).toBe("confounded");
    expect(first.headline).toContain("I changed the same page again on May 3");
    expect(first.rankingSignal).toBe(0);
  });
  it("leaves the LATER change confounded, because the earlier one is still in flight under it", () => {
    const second = twoChanges("2026-05-12T00:00:00.000Z")[1];
    expect([second.verdict, second.cleanUntil]).toEqual(["confounded", null]);
    expect(second.headline).toContain("other change");
  });
  it("reads a bundle applied together as ONE treatment, never one read per component", () => {
    const reads = readLedger([ledgerRow({
      componentsApplied: [{ kind: "title" }, { kind: "opening_answer" }, { kind: "internal_link_add" }],
    })], LATE, "2026-07-01");
    expect(reads).toHaveLength(1);
    expect([reads[0].overlappingIds, reads[0].cleanUntil]).toEqual([[], null]);
    expect(reads[0].verdict).toBe("directional_improvement");
  });
});
/** A reading that RAN is a reading the operator has already been shown. Moving the clock under it (a stamp that lands after the ship date, a second press that moves the
 *  ship date) may never un-decide it, and the promised dates on Today move with the stamp, never with the press. */
describe("a settled reading survives the clock moving under it", () => {
  const SETTLED = new Date("2026-06-10T00:00:00Z"), WATERMARK = "2026-06-05";
  // Shipped 2026-05-01 and read at 28 days on 2026-05-29. The stamp arrives 19 days after the ship date, so a recomputed 28-day window would not close until 2026-06-17.
  const stamped = ledgerRow({
    implementedAt: "2026-05-20T00:00:00.000Z",
    windows: [{ day: 28, ran: true, checkOn: "2026-05-29", adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 }],
  });
  it("keeps a decided row decided, on the dates the reading was actually taken", () => {
    const read = readLedger([stamped], SETTLED, WATERMARK)[0];
    expect(read.basisDay).toBe(28);
    expect(read.windows.find((w) => w.day === 28)).toMatchObject({ closesOn: "2026-05-29", state: "closed" });
    expect([read.verdict, bandOf(read)]).toEqual(["directional_improvement", "won"]);
  });
  it("still lets the live schedule govern every window that has NOT run", () => {
    const read = readLedger([stamped], SETTLED, WATERMARK)[0];
    // 7 and 14 carry no stored reading, so they count from the stamp like any open window.
    expect(read.windows.filter((w) => w.day !== 28).map((w) => w.closesOn)).toEqual(["2026-05-27", "2026-06-03"]);
  });
});
describe("the dates Beacon promises count from the stamp", () => {
  const NOW_S = new Date("2026-05-25T00:00:00Z");
  const scheduleRow = (over: Partial<VerdictScheduleRow> = {}): VerdictScheduleRow => ({
    id: "s1", path: "/x", shippedAt: "2026-05-01T00:00:00.000Z", verdict: "measuring",
    windows: [], baseline: { impressions: 5000, clicks: 400 }, ...over,
  });
  it("moves the promised dates onto the stamp when the row carries one", () => {
    expect(verdictSchedule([scheduleRow()], NOW_S)).toMatchObject({ firstReadOn: "2026-05-29", finalVerdictOn: "2026-05-29" });
    expect(verdictSchedule([scheduleRow({ implementedAt: "2026-05-20T00:00:00.000Z" })], NOW_S))
      .toMatchObject({ firstReadOn: "2026-05-27", finalVerdictOn: "2026-06-17" });
  });
  it("never moves a promised date because the change was pressed a second time", () => {
    // A re-press moves the ship date and never the stamp, so the operator's dates hold.
    expect(verdictSchedule([scheduleRow({
      implementedAt: "2026-05-20T00:00:00.000Z", shippedAt: "2026-05-24T00:00:00.000Z",
    })], NOW_S)).toMatchObject({ firstReadOn: "2026-05-27", finalVerdictOn: "2026-06-17" });
  });
});
describe("the learning shape every read carries", () => {
  it("names the family from the components the operator applied, biggest thing first", () => {
    const read = readLedger([ledgerRow({
      componentsApplied: [{ kind: "title" }, { kind: "section_add" }],
      diagnosisCause: "the page never answers the question in the first screen",
      evidenceItemCount: 6,
    })], LATE, "2026-07-01")[0];
    expect(read.learning).toEqual({
      actionFamily: "section-family",
      diagnosisCause: "the page never answers the question in the first screen",
      evidenceCompleteness: 6,
      outcomeDirection: "up",
    });
  });
  it("decodes a legacy row with no components, and never guesses what it does not hold", () => {
    const read = readLedger([ledgerRow({ actionType: "edit_title" })], LATE, "2026-07-01")[0];
    expect(read.learning.actionFamily).toBe("title-family");
    expect([read.learning.diagnosisCause, read.learning.evidenceCompleteness]).toEqual([null, null]);
    expect(learningShape({ componentKinds: [], actionType: "keep", diagnosisCause: null, evidenceItemCount: null, direction: "flat" }).actionFamily).toBe("unclassified");
  });
  it("records the direction of the outcome, unclear while nothing has settled", () => {
    const down = readLedger([ledgerRow({ windows: [{ day: 28, ran: true, adjustedLift: -80, controlsUsed: 3, treatedPostImpressions: 5000 }] })], LATE, "2026-07-01")[0];
    const waiting = readLedger([ledgerRow({ windows: [] })], LATE, "2026-07-01")[0];
    expect([down.learning.outcomeDirection, waiting.learning.outcomeDirection]).toEqual(["down", "unclear"]);
    expect(waiting.verdict).toBe("waiting");
    expect(waiting.headline).toContain("still measuring");
  });
});
/** Product Truth: 7, 14 and 28 always; 56 ONLY when the 28-day read was confounded, insufficient or unclear, or the change was a dangerous one. A clean 28 closes it. */
describe("the conditional day-56 read", () => {
  const STAMP = "2026-05-01T00:00:00.000Z";
  const pw = (day: ProofWindowDay, ran: boolean): ProofWindowResult => ({
    day, checkOn: addDays(STAMP, day), ran, treatedDelta: 0, controlDelta: 0, adjustedLift: 0,
    treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0,
    controlPosDelta: 0, adjustedPosLift: 0, controlsUsed: 3, treatedPostImpressions: 5000,
  });
  const shipped = (over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord => ({
    id: "s1", page: "https://site.com/x", path: "/x", actionType: "title-family", before: null, after: null,
    shippedAt: STAMP, baseline: { clicks: 400, impressions: 5000, ctr: 0.08, position: 8, windowDays: 28 },
    targetQueries: [], controlPages: [], windows: [pw(7, true), pw(14, true), pw(28, true)],
    verdict: "won", confidence: "medium", measuredAt: null, notes: null, verifiedLive: false,
    liveSourceUrl: null, recrawlRequestedAt: null, operatorVerdictOverride: null, proposalId: "p1",
    proposalVersion: "v1", basis: null, caseId: null, bundleHypothesis: null,
    componentsApplied: [{ kind: "title", label: "Page title" }], implementedAt: STAMP,
    preChangeContentHash: null, shipmentBaseline: null,
    verification: { status: "verified", checkedAt: "2026-05-02T00:00:00.000Z", components: [] },
    operatorNote: null, createdAt: STAMP, updatedAt: STAMP, ...over,
  });
  // Day 56 lands 2026-06-26; Google has finalized well past it.
  const AFTER_56 = new Date("2026-07-10T00:00:00Z"), FINAL = "2026-07-05";
  it("omits the fourth read entirely when the 28-day read settled cleanly", () => {
    for (const verdict of ["won", "lost"] as const) {
      const record = shipped({ verdict });
      expect(day56Followup(record, FINAL, AFTER_56)).toMatchObject({ runs: false, due: false, reason: null });
      expect(isDueForMeasure(record, FINAL, AFTER_56)).toBe(false);
    }
  });
  it("runs it when the 28-day read was confounded, insufficient or unclear", () => {
    for (const verdict of ["measuring", "insufficient_data", "inconclusive"] as const) {
      const record = shipped({ verdict });
      const followUp = day56Followup(record, FINAL, AFTER_56);
      expect([followUp.runs, followUp.due, followUp.checkOn]).toEqual([true, true, "2026-06-26"]);
      expect(isDueForMeasure(record, FINAL, AFTER_56)).toBe(true);
    }
    expect(day56Followup(shipped({ verdict: "insufficient_data" }), FINAL, AFTER_56).reason).toBe("insufficient_28");
    expect(day56Followup(shipped({ verdict: "inconclusive" }), FINAL, AFTER_56).reason).toBe("unclear_28");
    // The record can prove the 28-day read did not settle; it cannot prove WHY, so it does not say.
    expect(day56Followup(shipped({ verdict: "measuring" }), FINAL, AFTER_56).reason).toBe("measuring_28");
  });
  it("runs it for a change that moved or hid the page, even on a clean 28-day read", () => {
    const record = shipped({ componentsApplied: [{ kind: "redirect", label: "Redirect" }] });
    expect(day56Followup(record, FINAL, AFTER_56)).toMatchObject({ runs: true, due: true, reason: "dangerous_change" });
    expect(isDueForMeasure(record, FINAL, AFTER_56)).toBe(true);
  });
  it("runs it for a component the proposal GRADED dangerous, whatever its kind", () => {
    const graded = shipped({ componentsApplied: [{ kind: "title", label: "Page title", risk: "dangerous" }] });
    expect(day56Followup(graded, FINAL, AFTER_56)).toMatchObject({ runs: true, due: true, reason: "dangerous_change" });
    // A component graded safe on an ordinary kind still closes at 28 days.
    expect(day56Followup(shipped({ componentsApplied: [{ kind: "title", label: "Page title", risk: "safe" }] }), FINAL, AFTER_56).runs).toBe(false);
  });
  it("waits for Google, and never asks twice", () => {
    const unsettled = shipped({ verdict: "inconclusive" });
    // Earned, but Google has not finalized the days that read needs yet.
    expect(day56Followup(unsettled, "2026-06-01", AFTER_56)).toMatchObject({ runs: true, due: false });
    // Earned and already taken.
    const taken = shipped({ verdict: "inconclusive", windows: [pw(7, true), pw(14, true), pw(28, true), pw(56, true)] });
    expect(day56Followup(taken, FINAL, AFTER_56).runs).toBe(false);
    // The 28-day read has not run at all, so there is nothing to gate the fourth one on.
    expect(day56Followup(shipped({ verdict: "measuring", windows: [pw(7, true)] }), FINAL, AFTER_56).runs).toBe(false);
  });
  it("shows the fourth checkpoint on the read, and treats it as a mature basis", () => {
    const read = readLedger([ledgerRow({
      implementedAt: STAMP,
      windows: [
        { day: 28, ran: true, adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 },
        { day: 56, ran: true, adjustedLift: 90, controlsUsed: 3, treatedPostImpressions: 5000 },
      ],
    })], AFTER_56, FINAL)[0];
    expect(read.windows.map((w) => w.day)).toEqual([7, 14, 28, 56]);
    expect(read.basisDay).toBe(56);
    expect(read.headline).toContain("56-day window");
    expect(read.headline).not.toContain("I will call it when the 28-day window closes");
  });
  it("names BOTH reads when the fourth checkpoint changes the answer", () => {
    const read = readLedger([ledgerRow({
      implementedAt: STAMP,
      windows: [
        { day: 28, ran: true, adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 },
        { day: 56, ran: true, adjustedLift: 0, controlsUsed: 3, treatedPostImpressions: 5000 },
      ],
    })], AFTER_56, FINAL)[0];
    expect([read.basisDay, bandOf(read)]).toEqual([56, "learned"]);
    expect(read.headline).toContain(
      "The 28 day read looked like a win; the full 56 day read shows no clear change, and the longer window wins.",
    );
  });
  it("says nothing about a flip when the fourth read agrees with the 28-day read", () => {
    const read = readLedger([ledgerRow({
      implementedAt: STAMP,
      windows: [
        { day: 28, ran: true, adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 },
        { day: 56, ran: true, adjustedLift: 200, controlsUsed: 3, treatedPostImpressions: 5000 },
      ],
    })], AFTER_56, FINAL)[0];
    expect(read.headline).not.toContain("The 28 day read looked like");
  });
});
describe("no causal overclaim on any read", () => {
  const readFor = (windows: LedgerRecordLike["windows"]) => readLedger([ledgerRow({ windows })], LATE, "2026-07-01")[0];
  it("never says a change caused anything, and never sells a loss as a win", () => {
    const down = readFor([{ day: 28, ran: true, adjustedLift: -80, controlsUsed: 3, treatedPostImpressions: 5000 }]);
    expect(down.headline).toContain("moved down after the change");
    expect(bandOf(down)).toBe("learned");
    expect(down.rankingSignal).toBeLessThan(0);
    for (const read of [down, readFor([{ day: 28, ran: true, adjustedLift: 90, controlsUsed: 3, treatedPostImpressions: 5000 }]), readFor([])]) {
      expect(read.headline.toLowerCase()).not.toMatch(/caused|thanks to|because of the change|proof that/);
      expect([read.headline, ...read.caveats].join(" ")).not.toMatch(/[—–]/);
    }
  });
  it("holds a still-measuring change out of the won band and out of learning", () => {
    const early = readFor([{ day: 7, ran: true, adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 }]);
    expect([bandOf(early), learningVerdictOf(early)]).toEqual(["promising", "measuring"]);
    expect(early.headline).toContain("I will call it when the 28-day window closes");
  });
  it("says WHAT confounded a read, never just that it is confounded", () => {
    const [first] = readLedger([
      ledgerRow({ id: "first", implementedAt: "2026-05-01T00:00:00.000Z" }),
      ledgerRow({ id: "second", shippedAt: "2026-05-03", implementedAt: "2026-05-03T00:00:00.000Z" }),
    ], LATE, "2026-07-01");
    expect(first.verdict).toBe("confounded");
    expect(first.headline).toMatch(/changed the same page again on [A-Z][a-z]{2} \d{1,2}\b/);
    expect(first.headline).not.toMatch(/\d{4}-\d{2}-\d{2}/); // never a raw date stamp in operator copy
    expect(learningVerdictOf(first)).toBe("measuring");
  });
});
describe("overlap closure math", () => {
  it("names the day a later same-page change closed the clean window, and leaves other pages alone", () => {
    const closures = overlapClosures([
      { id: "a", path: "/x", anchoredAt: "2026-05-01" },
      { id: "b", path: "/x", anchoredAt: "2026-05-12" },
      { id: "c", path: "/y", anchoredAt: "2026-05-05" },
    ]);
    expect(closures.get("a")).toEqual({ ids: ["b"], cleanUntil: "2026-05-12" });
    expect(closures.get("b")).toEqual({ ids: ["a"], cleanUntil: null });
    expect(closures.get("c")).toEqual({ ids: [], cleanUntil: null });
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
