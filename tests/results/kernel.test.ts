import { describe, expect, it } from "vitest";
import {
  addDays, bandOf, evaluateChange, evaluateWindows, learningVerdictOf, metricFor, rankingPriors,
  readLedger, readRecordsForLearning, toKernelInput, verdictPhrase, type KernelInput, type LedgerRecordLike,
} from "@/domains/measurement/proof-gsc/kernel";
import { learningShape, overlapClosures } from "@/domains/measurement/proof-gsc/read-honesty";
import { day56Followup, isDueForMeasure } from "@/domains/measurement/proof-gsc/measure-lifecycle";
import { verdictSchedule, type VerdictScheduleRow } from "@/domains/measurement/proof-gsc/verdict-schedule";
import { applyPinnedRead, pinFor, withCorrection } from "@/domains/measurement/proof-gsc/pinned-read";
import { contaminationFor, selectMatchedControls } from "@/domains/measurement/proof-gsc/contamination";
import type { ShippedChangeRecord } from "@/domains/measurement/proof-gsc/shipped-change-store";
import type { ProofWindowDay, ProofWindowResult } from "@/domains/measurement/proof-gsc/types";
/** Outcome-level contract tests for the measurement kernel. These pin CUSTOMER TRUTH, not implementation: every historical shipment maps to exactly one read (nothing disappears); the 7/14/28 windows respect Google's reporting lag; overlapping changes on one page read as confounded; only cleanly-settled reads feed ranking; no operator string claims cause. */
const NOW = new Date("2026-06-01T00:00:00Z");
function win(day: 7 | 14 | 28, over: Partial<KernelInput["windows"][number]> = {}) {
  return { day, ran: true, adjustedClicksLift: 0, adjustedCtrLift: 0, adjustedPosLift: 0,
    adjustedImpressionsLift: 0, controlsUsed: 3, treatedPostImpressions: 5000, ...over,};}
function baseInput(over: Partial<KernelInput> = {}): KernelInput {
  return { id: "c1", page: "https://site.com/a", path: "/a", actionType: "edit_title", shippedAt: "2026-05-01",
    baselineImpressions: 5000, baselineClicks: 400, windows: [win(7), win(14), win(28)], ...over,};}
const CLOSED_WINDOWS = evaluateWindows("2026-05-01", NOW, "2026-06-01");
describe("window evaluation and reporting lag", () => {
  it("waits before a calendar close, waits on Google after it, and only then reads", () => {
    expect(evaluateWindows("2026-05-30", NOW, "2026-05-31").every((w) => w.state === "waiting")).toBe(true); // shipped 2 days ago
    expect(evaluateWindows("2026-05-01", NOW, "2026-05-05").find((w) => w.day === 7)!.state).toBe("pending_data"); const w7 = CLOSED_WINDOWS.find((w) => w.day === 7)!;
    expect([w7.state, w7.closesOn]).toEqual(["closed", addDays("2026-05-01", 7)]);});});
describe("individual directional reads", () => {
  it("reads a real click gain as an improvement, never as causal proof", () => {
    const read = evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: 40 })] }), CLOSED_WINDOWS, []); expect(["directional_improvement", "stronger_improvement"]).toContain(read.verdict);
    expect(read.rankingSignal).toBeGreaterThan(0); expect(read.headline.toLowerCase()).not.toContain("caused"); expect(read.headline.toLowerCase()).toContain("similar pages");});
  it("owns a decline observationally, with no plus sign on a loss and no verdict while it is still measuring", () => {
    const read = evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: -40 })] }), CLOSED_WINDOWS, []); expect(read.verdict).toBe("directional_decline");
    expect(read.rankingSignal).toBeLessThan(0); expect(read.headline).toContain("moved down after the change");
    expect(read.headline).toContain("40 clicks behind similar pages");
    expect(read.headline).not.toMatch(/did not work|\+/); // a loss never renders a plus sign
    const early = evaluateChange(baseInput({ actionType: "content", windows: [win(7, { adjustedClicksLift: -40 })] }), evaluateWindows("2026-05-01", NOW, "2026-05-10"), []); expect(early.basisDay).toBe(7);
    expect(early.headline).toContain("Still measuring"); expect(early.headline).not.toMatch(/did not work|try something else|different angle/);});
  it("stays waiting with no closed window and never reads a dead end", () => {
    const read = evaluateChange(baseInput({ windows: [win(7, { ran: false })] }), evaluateWindows("2026-05-30", NOW, "2026-05-31"), []); expect([read.verdict, read.rankingSignal]).toEqual(["waiting", 0]);});
  it("reads insufficient evidence on a thin baseline, and on too few comparable pages", () => {
    const thin = evaluateChange(baseInput({ baselineImpressions: 50, windows: [win(28, { adjustedClicksLift: 40 })] }), CLOSED_WINDOWS, []); expect([thin.verdict, thin.rankingSignal]).toEqual(["insufficient_evidence", 0]); expect(thin.confidenceReasons.join(" ")).toContain("50 impressions");
    expect(evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: 40, controlsUsed: 1 })] }), CLOSED_WINDOWS, []).verdict).toBe("insufficient_evidence");});});
describe("overlap and confounding honesty", () => {
  it("flags same-page overlapping windows, names the day the clean one closed, and never two months apart", () => {
    const overlaps = overlapClosures([{ id: "a", path: "/x", anchoredAt: "2026-05-01" }, { id: "b", path: "/x", anchoredAt: "2026-05-12" }, { id: "c", path: "/y", anchoredAt: "2026-05-05" }]);
    expect(overlaps.get("a")).toEqual({ ids: ["b"], cleanUntil: "2026-05-12" }); expect(overlaps.get("b")).toEqual({ ids: ["a"], cleanUntil: null });
    expect(overlaps.get("c")).toEqual({ ids: [], cleanUntil: null }); expect(overlapClosures([{ id: "a", path: "/x", anchoredAt: "2026-05-01" }, { id: "b", path: "/x", anchoredAt: "2026-07-01" }]).get("a")!.ids).toEqual([]);});
  it("downgrades a directional read to confounded when changes overlap", () => {
    const read = evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: 40 })] }), CLOSED_WINDOWS, ["other-change"]); expect([read.verdict, read.rankingSignal]).toEqual(["confounded", 0]);
    expect(read.headline).toContain("cannot be pinned on one");});
  it("reads every change on one page as confounded, so no single one is credited", () => {
    const rec = (id: string, at: string): LedgerRecordLike => ({ id, page: "p", path: "/x", actionType: "content", shippedAt: at,
      baseline: { impressions: 5000, clicks: 400 }, windows: [{ day: 28, ran: true, adjustedLift: 90, controlsUsed: 3, treatedPostImpressions: 5000 }] });
    const reads = readLedger([rec("a", "2026-05-01"), rec("b", "2026-05-05")], new Date("2026-07-15T00:00:00Z"), "2026-07-01");
    expect([reads.every((r) => r.verdict === "confounded"), reads.every((r) => r.rankingSignal === 0)]).toEqual([true, true]);});});
describe("historical records are preserved end to end", () => {
  it("maps every historical record to exactly one read", () => {
    const records: LedgerRecordLike[] = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`, page: `https://site.com/p${i}`, path: `/p${i}`, actionType: i % 2 === 0 ? "edit_title" : "content",
      shippedAt: "2026-05-01", baseline: { impressions: 4000, clicks: 300 },
      windows: [{ day: 28, ran: true, adjustedLift: 10, adjustedCtrLift: 0.01, controlsUsed: 3, treatedPostImpressions: 4000 }],}));
    const reads = readLedger(records, NOW, "2026-07-01"); expect([reads.length, new Set(reads.map((r) => r.id)).size]).toEqual([12, 12]);});
  it("tolerates a legacy record with missing optional fields", () => {
    const input = toKernelInput({ id: "x", page: "p", path: "/p", actionType: "keep", shippedAt: "2026-05-01" }); expect([input.baselineImpressions, input.windows]).toEqual([0, []]);
    expect(evaluateChange(input, CLOSED_WINDOWS, []).verdict).toBe("insufficient_evidence"); expect(evaluateChange({ ...input, actionType: "content" }, CLOSED_WINDOWS, []).verdict).toBe("waiting");});});
describe("ranking outcome signal", () => {
  it("earns a per-action-type prior only from settled reads at sample floor", () => {
    const priors = rankingPriors(Array.from({ length: 3 }, () => ({ actionType: "edit_title", read: { rankingSignal: 0.6 } }))); expect(priors.get("edit_title")).toBeCloseTo(0.6, 5);});
  it("ignores zero-signal reads, and stays neutral below the sample floor", () => {
    expect(rankingPriors(Array.from({ length: 3 }, () => ({ actionType: "faq", read: { rankingSignal: 0 } }))).has("faq")).toBe(false); expect(rankingPriors([{ actionType: "meta", read: { rankingSignal: 0.6 } }]).has("meta")).toBe(false);});});
/** PHASE 7: the windows count from the stamp, a later change on the same page closes the earlier one's clean window instead of being silently measured as if it were clean, the day-56 read runs only when the day-28 read did not settle, and every settled read carries the learning shape. Fixtures only. */
/** One checkpoint that RAN, on the three fair comparisons every ledger fixture below is read against. */
type LedgerWindow = NonNullable<LedgerRecordLike["windows"]>[number];
const lw = (day: number, adjustedLift: number, over: Partial<LedgerWindow> = {}): LedgerWindow =>
  ({ day, ran: true, adjustedLift, controlsUsed: 3, treatedPostImpressions: 5000, ...over });
const ledgerRow = (over: Partial<LedgerRecordLike> = {}): LedgerRecordLike => ({
  id: "a", page: "https://site.com/x", path: "/x", actionType: "content", shippedAt: "2026-05-01",
  baseline: { impressions: 5000, clicks: 400 }, windows: [lw(7, 40), lw(14, 40), lw(28, 40)], ...over,});
const LATE = new Date("2026-07-15T00:00:00Z");
/** ONE stored shipment and ONE proof window, both anchored on the day the change shipped. Two describes below hand-rolled the same twenty five fields and drifted apart on the ones they never meant to vary. */
const proofWindow = (stamp: string, day: ProofWindowDay, over: Partial<ProofWindowResult> = {}): ProofWindowResult => ({
  day, checkOn: addDays(stamp, day), ran: true, treatedDelta: 0, controlDelta: 0, adjustedLift: 0,
  treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0, controlPosDelta: 0,
  adjustedPosLift: 0, controlsUsed: 3, treatedPostImpressions: 5000, treatedImpressionsDelta: 0, controlImpressionsDelta: 0, adjustedImpressionsLift: 0, ...over,});
const shippedRecord = (stamp: string, over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord => ({
  id: "s1", page: "https://site.com/x", path: "/x", actionType: "title-family", before: null, after: null,
  shippedAt: stamp, baseline: { clicks: 400, impressions: 5000, ctr: 0.08, position: 8, windowDays: 28 },
  targetQueries: [], controlPages: [], controlsReceipt: null, judgedMetric: null, primaryWindowDays: null,
  windows: [proofWindow(stamp, 7), proofWindow(stamp, 14), proofWindow(stamp, 28)],
  verdict: "won", confidence: "medium", measuredAt: null, notes: null, verifiedLive: false,
  liveSourceUrl: null, recrawlRequestedAt: null, operatorVerdictOverride: null, proposalId: "p1",
  proposalVersion: "v1", basis: null, caseId: null, bundleHypothesis: null, componentsApplied: [{ kind: "title", label: "Page title" }], implementedAt: stamp,
  preChangeContentHash: null, preChangeHashUnavailable: false, measurementState: null, shipmentBaseline: null,
  verification: { status: "verified", checkedAt: stamp, components: [] },
  operatorNote: null, aiScope: null, treatmentStamp: null, pinnedRead: null, createdAt: stamp, updatedAt: stamp, ...over,});
describe("checkpoints count from the stamp", () => {
  it("counts from implementedAt when the row carries the stamp, and from the ship date when it does not", () => {
    expect(readLedger([ledgerRow({ implementedAt: "2026-05-10T09:30:00.000Z" })], LATE, "2026-07-01")[0] .windows.map((w) => w.closesOn)).toEqual(["2026-05-17", "2026-05-24", "2026-06-07"]);
    expect(readLedger([ledgerRow()], LATE, "2026-07-01")[0].windows.find((w) => w.day === 7)!.closesOn).toBe("2026-05-08");});});
describe("overlap honesty: a later change closes the earlier one's clean window", () => {
  const twoChanges = (secondStamp: string) => readLedger([ledgerRow({ id: "first", implementedAt: "2026-05-01T00:00:00.000Z" }),
    ledgerRow({ id: "second", shippedAt: secondStamp, implementedAt: secondStamp })], LATE, "2026-07-01");
  it("keeps the reads that closed before the second change and confounds the ones after it", () => {
    const [first] = twoChanges("2026-05-12T00:00:00.000Z"); expect(first.cleanUntil).toBe("2026-05-12");
    expect(first.windows.find((w) => w.day === 7)!.confounded).toBeUndefined(); expect(first.windows.filter((w) => w.confounded === "overlapping_change").map((w) => w.day)).toEqual([14, 28]);
    expect(first.basisDay).toBe(7); expect(["directional_improvement", "stronger_improvement"]).toContain(first.verdict);
    expect(first.caveats.join(" ")).toContain("the page changed again on May 12"); expect(first.caveats.join(" ")).not.toMatch(/[—–]/);});
  it("confounds the read outright when the second change landed before any window closed", () => {
    const [first] = twoChanges("2026-05-03T00:00:00.000Z"); expect(first.verdict).toBe("confounded");
    expect(first.headline).toContain("the page changed again on May 3"); expect(first.rankingSignal).toBe(0);});
  it("leaves the LATER change confounded, because the earlier one is still in flight under it", () => {
    const second = twoChanges("2026-05-12T00:00:00.000Z")[1]; expect([second.verdict, second.cleanUntil]).toEqual(["confounded", null]);
    expect(second.headline).toContain("other change");});
  it("reads a bundle applied together as ONE treatment, never one read per component", () => {
    const reads = readLedger([ledgerRow({
      componentsApplied: [{ kind: "title" }, { kind: "opening_answer" }, { kind: "internal_link_add" }],
    })], LATE, "2026-07-01");
    expect(reads).toHaveLength(1); expect([reads[0].overlappingIds, reads[0].cleanUntil]).toEqual([[], null]);
    expect(reads[0].verdict).toBe("directional_improvement");});});
/** A reading that RAN is a reading the operator has already been shown. Moving the clock under it (a stamp that lands after the ship date, a second press that moves the ship date) may never un-decide it, and the promised dates on Today move with the stamp, never with the press. */
describe("a settled reading survives the clock moving under it", () => {
  const SETTLED = new Date("2026-06-10T00:00:00Z"), WATERMARK = "2026-06-05";
  const stamped = ledgerRow({
    implementedAt: "2026-05-20T00:00:00.000Z",
    windows: [{ day: 28, ran: true, checkOn: "2026-05-29", adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 }],});
  it("keeps a decided row decided, and still lets the live schedule govern every window that has NOT run", () => {
    const read = readLedger([stamped], SETTLED, WATERMARK)[0]; expect(read.basisDay).toBe(28);
    expect(read.windows.find((w) => w.day === 28)).toMatchObject({ closesOn: "2026-05-29", state: "closed" }); expect([read.verdict, bandOf(read)]).toEqual(["directional_improvement", "won"]);
    expect(read.windows.filter((w) => w.day !== 28).map((w) => w.closesOn)).toEqual(["2026-05-27", "2026-06-03"]);});});
describe("the dates Beacon promises count from the stamp", () => {
  const NOW_S = new Date("2026-05-25T00:00:00Z");
  const scheduleRow = (over: Partial<VerdictScheduleRow> = {}): VerdictScheduleRow => ({
    id: "s1", path: "/x", shippedAt: "2026-05-01T00:00:00.000Z", verdict: "measuring",
    windows: [], baseline: { impressions: 5000, clicks: 400 }, ...over,});
  it("moves the promised dates onto the stamp, and never moves one because the change was pressed twice", () => {
    expect(verdictSchedule([scheduleRow()], NOW_S)).toMatchObject({ firstReadOn: "2026-05-29", finalVerdictOn: "2026-05-29" });
    expect(verdictSchedule([scheduleRow({ implementedAt: "2026-05-20T00:00:00.000Z" })], NOW_S))
      .toMatchObject({ firstReadOn: "2026-05-27", finalVerdictOn: "2026-06-17" });
    expect(verdictSchedule([scheduleRow({ implementedAt: "2026-05-20T00:00:00.000Z", shippedAt: "2026-05-24T00:00:00.000Z" })], NOW_S))
      .toMatchObject({ firstReadOn: "2026-05-27", finalVerdictOn: "2026-06-17" });});});
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
      outcomeDirection: "up",});});
  it("decodes a legacy row with no components, and never guesses what it does not hold", () => {
    const read = readLedger([ledgerRow({ actionType: "edit_title" })], LATE, "2026-07-01")[0]; expect(read.learning.actionFamily).toBe("title-family");
    expect([read.learning.diagnosisCause, read.learning.evidenceCompleteness]).toEqual([null, null]);
    expect(learningShape({ componentKinds: [], actionType: "keep", diagnosisCause: null, evidenceItemCount: null, direction: "flat" }).actionFamily).toBe("unclassified");});
  it("records the direction of the outcome, unclear while nothing has settled", () => {
    const down = readLedger([ledgerRow({ windows: [{ day: 28, ran: true, adjustedLift: -80, controlsUsed: 3, treatedPostImpressions: 5000 }] })], LATE, "2026-07-01")[0];
    const waiting = readLedger([ledgerRow({ windows: [] })], LATE, "2026-07-01")[0]; expect([down.learning.outcomeDirection, waiting.learning.outcomeDirection]).toEqual(["down", "unclear"]);
    expect(waiting.verdict).toBe("waiting"); expect(waiting.headline).toContain("Still measuring");});});
/** Product Truth: 7, 14 and 28 always; 56 ONLY when the 28-day read was confounded, insufficient or unclear, or the change was a dangerous one. A clean 28 closes it. */
describe("the conditional day-56 read", () => {
  const STAMP = "2026-05-01T00:00:00.000Z";
  const pw = (day: ProofWindowDay, ran: boolean) => proofWindow(STAMP, day, { ran });
  const shipped = (over: Partial<ShippedChangeRecord> = {}) => shippedRecord(STAMP, over);
  const AFTER_56 = new Date("2026-07-10T00:00:00Z"), FINAL = "2026-07-05";
  it("omits the fourth read entirely when the 28-day read settled cleanly", () => {
    for (const verdict of ["won", "lost"] as const) {
      const record = shipped({ verdict }); expect(day56Followup(record, FINAL, AFTER_56)).toMatchObject({ runs: false, due: false, reason: null });
      expect(isDueForMeasure(record, FINAL, AFTER_56)).toBe(false);}});
  it("runs it when the 28-day read was confounded, insufficient or unclear", () => {
    for (const verdict of ["measuring", "insufficient_data", "inconclusive"] as const) {
      const record = shipped({ verdict }); const followUp = day56Followup(record, FINAL, AFTER_56);
      expect([followUp.runs, followUp.due, followUp.checkOn]).toEqual([true, true, "2026-06-26"]); expect(isDueForMeasure(record, FINAL, AFTER_56)).toBe(true);}
    expect(day56Followup(shipped({ verdict: "insufficient_data" }), FINAL, AFTER_56).reason).toBe("insufficient_28"); expect(day56Followup(shipped({ verdict: "inconclusive" }), FINAL, AFTER_56).reason).toBe("unclear_28");
    expect(day56Followup(shipped({ verdict: "measuring" }), FINAL, AFTER_56).reason).toBe("measuring_28");});
  it("runs it for a change that moved or hid the page, or one the proposal GRADED dangerous, on a clean 28-day read", () => {
    const moved = shipped({ componentsApplied: [{ kind: "redirect", label: "Redirect" }] }); const graded = shipped({ componentsApplied: [{ kind: "title", label: "Page title", risk: "dangerous" }] });
    for (const record of [moved, graded]) {
      expect(day56Followup(record, FINAL, AFTER_56)).toMatchObject({ runs: true, due: true, reason: "dangerous_change" }); expect(isDueForMeasure(record, FINAL, AFTER_56)).toBe(true);}
    expect(day56Followup(shipped({ componentsApplied: [{ kind: "title", label: "Page title", risk: "safe" }] }), FINAL, AFTER_56).runs).toBe(false);});
  it("waits for Google, and never asks twice", () => {
    const unsettled = shipped({ verdict: "inconclusive" });
    expect(day56Followup(unsettled, "2026-06-01", AFTER_56)).toMatchObject({ runs: true, due: false });
    const taken = shipped({ verdict: "inconclusive", windows: [pw(7, true), pw(14, true), pw(28, true), pw(56, true)] }); expect(day56Followup(taken, FINAL, AFTER_56).runs).toBe(false);
    expect(day56Followup(shipped({ verdict: "measuring", windows: [pw(7, true)] }), FINAL, AFTER_56).runs).toBe(false);});
  /** The same change read at both mature checkpoints, the 28 day lift against the 56 day one. */
  const bothReads = (lift28: number, lift56: number) =>
    readLedger([ledgerRow({ implementedAt: STAMP, windows: [lw(28, lift28), lw(56, lift56)] })], AFTER_56, FINAL)[0];
  it("shows the fourth checkpoint on the read, and treats it as a mature basis", () => {
    const read = bothReads(40, 90);
    expect(read.windows.map((w) => w.day)).toEqual([7, 14, 28, 56]); expect(read.basisDay).toBe(56);
    expect(read.headline).toContain("56-day window"); expect(read.headline).not.toContain("This firms up when the 28-day window closes");});
  it("names BOTH reads when the fourth checkpoint changes the answer", () => {
    const read = bothReads(40, 0);
    expect([read.basisDay, bandOf(read)]).toEqual([56, "learned"]);
    expect(read.headline).toContain( "The 28 day read looked like a win; the full 56 day read shows no clear change, and the longer window wins.",);
    const agrees = bothReads(40, 200);
    expect(agrees.headline).not.toContain("The 28 day read looked like");}); });
describe("no causal overclaim on any read", () => {
  const readFor = (windows: LedgerRecordLike["windows"]) => readLedger([ledgerRow({ windows })], LATE, "2026-07-01")[0];
  it("never says a change caused anything, and never sells a loss as a win", () => {
    const down = readFor([{ day: 28, ran: true, adjustedLift: -80, controlsUsed: 3, treatedPostImpressions: 5000 }]); expect(down.headline).toContain("moved down after the change");
    expect(bandOf(down)).toBe("learned"); expect(down.rankingSignal).toBeLessThan(0);
    for (const read of [down, readFor([{ day: 28, ran: true, adjustedLift: 90, controlsUsed: 3, treatedPostImpressions: 5000 }]), readFor([])]) {
      expect(read.headline.toLowerCase()).not.toMatch(/caused|thanks to|because of the change|proof that/); expect([read.headline, ...read.caveats].join(" ")).not.toMatch(/[—–]/);}
    const early = readFor([{ day: 7, ran: true, adjustedLift: 40, controlsUsed: 3, treatedPostImpressions: 5000 }]); expect([bandOf(early), learningVerdictOf(early)]).toEqual(["promising", "measuring"]);
    expect(early.headline).toContain("This firms up when the 28-day window closes"); });
  it("says WHAT confounded a read, never just that it is confounded", () => {
    const [first] = readLedger([
      ledgerRow({ id: "first", implementedAt: "2026-05-01T00:00:00.000Z" }),
      ledgerRow({ id: "second", shippedAt: "2026-05-03", implementedAt: "2026-05-03T00:00:00.000Z" }),
    ], LATE, "2026-07-01");
    expect(first.verdict).toBe("confounded"); expect(first.headline).toMatch(/page changed again on [A-Z][a-z]{2} \d{1,2}\b/);
    expect(first.headline).not.toMatch(/\d{4}-\d{2}-\d{2}/); // never a raw date stamp in operator copy
    expect(learningVerdictOf(first)).toBe("measuring"); }); });
/** THE TWO VOCABULARIES. A row's action word is a KIND from the older producers ("title") or the FAMILY the bundle producer stamps off changeFamily ("title-family"). Only the kinds were in the table, so every family spelling  fell through to CLICKS and a title rewrite was graded on the number it moves last. */
describe("metric selection and vocabulary", () => {
  it("answers for every canonical KIND and FAMILY spelling, and fails closed on one it does not hold", () => {
    const table: Array<[string, string]> = [["edit_title", "ctr"], ["title-family", "ctr"], ["description-family", "ctr"],
      ["title_meta", "ctr"], ["answer", "ctr"], ["schema", "ctr"], ["internal_link", "position"], ["links-family", "position"],
      ["technical-family", "position"], ["redirect", "position"], ["content", "clicks"], ["section-family", "clicks"],
      ["full_rewrite", "clicks"], ["new_page", "clicks"], ["consolidation", "clicks"],
      ["other", "unclassified"], ["bundle", "unclassified"], ["", "unclassified"], ["keep_current", "unclassified"]];
    expect(table.map(([a]) => metricFor(a))).toEqual(table.map(([, m]) => m));
    const unknown = readLedger([ledgerRow({ actionType: "other" })], LATE, "2026-07-01")[0]; // no verdict, no number, nothing taught to ranking
    expect([unknown.verdict, unknown.basisDay, unknown.lift, unknown.rankingSignal]).toEqual(["insufficient_evidence", null, 0, 0]); expect(unknown.headline).toMatch(/not a kind that Search data can fairly judge/);});
  it("reads the live stored row spelled 'title-family' on click rate, with no history rewritten", () => {
    const read = readLedger([ledgerRow({ actionType: "title-family",
      windows: [{ day: 28, ran: true, adjustedLift: -40, adjustedCtrLift: 0.02, controlsUsed: 3, treatedPostImpressions: 5000 }] })], LATE, "2026-07-01")[0];
    expect([read.metric, read.lift, read.verdict]).toEqual(["ctr", 0.02, "stronger_improvement"]); });
  it("exposes a phrase for every verdict with no dashes", () => {
    for (const v of ["waiting", "insufficient_evidence", "directional_decline", "no_clear_movement", "directional_improvement", "stronger_improvement", "confounded"] as const) {
      const phrase = verdictPhrase(v); expect(phrase.length).toBeGreaterThan(0);
      expect(phrase).not.toMatch(/[—–]/);}
  }); });
/** A FINISHED READING NEVER MOVES AGAIN. /results re-measures the whole ledger every fifteen minutes against fresh Google data and a fresh comparison set, so a change reported at +1,040 clicks was re-read at +1,428  the same afternoon. Once the window has closed with every day behind it finalized, the tuple is frozen. */
describe("a settled reading is held still", () => {
  const STAMP = "2026-04-01T00:00:00.000Z";
  const pinWin = (day: ProofWindowDay, lift: number) =>
    proofWindow(STAMP, day, { treatedDelta: lift, adjustedLift: lift, controlsUsed: 4, treatedPostImpressions: 9000 });
  const record = (over: Partial<ShippedChangeRecord> = {}) => shippedRecord(STAMP, {
    id: "shp_pin", actionType: "content", confidence: "high",
    baseline: { clicks: 900, impressions: 9000, ctr: 0.1, position: 6, windowDays: 28 },
    windows: [pinWin(7, 300), pinWin(14, 700), pinWin(28, 1040)],
    componentsApplied: [{ kind: "section", label: "Section" }], ...over,});
  const AFTER = new Date("2026-06-01T00:00:00Z"), FINAL = "2026-05-20";
  it("freezes the whole tuple once the window closed and Google finalized the days behind it", () => {
    const r = record(); const read = readLedger([r], AFTER, FINAL)[0]!;
    const pin = pinFor(r, read, FINAL, AFTER); expect(pin).not.toBeNull();
    expect([pin!.basisDay, pin!.lift, pin!.controlsUsed, pin!.verdict]).toEqual([28, 1040, 4, read.verdict]); });
  it("freezes nothing while the window is still open, so later checkpoints still land", () => {
    const r = record({ windows: [pinWin(7, 300)] }); const read = readLedger([r], new Date("2026-04-12T00:00:00Z"), "2026-04-10")[0]!;
    expect(pinFor(r, read, "2026-04-10", new Date("2026-04-12T00:00:00Z"))).toBeNull(); });
  it("serves the frozen number and the sentence that matches it, whatever the re-measure now says", () => {
    const drifted = record({ windows: [pinWin(7, 300), pinWin(14, 700), pinWin(28, 1428)] }); const live = readLedger([drifted], AFTER, FINAL)[0]!;
    const pin = pinFor(record(), readLedger([record()], AFTER, FINAL)[0]!, FINAL, AFTER)!; const served = applyPinnedRead(live, pin);
    expect(served.lift).toBe(1040); expect(served.headline).toContain("1040 clicks");
    expect(served.headline).not.toContain("1428"); });
  it("still lets a later change on the same page take shared credit, with the numbers untouched", () => {
    const first = record(), second = record({ id: "shp_2", implementedAt: "2026-04-05T00:00:00.000Z", shippedAt: "2026-04-05T00:00:00.000Z" }); const live = readLedger([first, second], AFTER, FINAL)[0]!;
    const pin = pinFor(first, readLedger([first], AFTER, FINAL)[0]!, FINAL, AFTER)!; const served = applyPinnedRead(live, pin);
    expect([live.verdict, served.verdict, served.lift, served.rankingSignal]).toEqual(["confounded", "confounded", 1040, 0]); expect(served.confidenceReasons.join(" ")).toMatch(/changed again afterwards/);
  }); });
/** PHASE 2: ONE COMPARISON POLICY. Exclusion is scoped to the window being read, so a page that was changed months ago is comparable again instead of being lost forever; the receipt lists only facts  anybody can check; too few fair comparisons is a VERDICT rather than a weak number; and the frozen reading the operator was shown is the same one ranking learns from. */
describe("one comparison policy, one durable result", () => {
  const NOW_C = new Date("2026-06-01T00:00:00Z");
  const change = (path: string, at: string, verdict: string): ShippedChangeRecord =>
    ({ path, shippedAt: at, implementedAt: at, verdict, windows: [{ day: 28, ran: true }] } as unknown as ShippedChangeRecord);
  it("holds a page only for its own window, names why, and lets it back in afterwards", () => {
    const ledger = [change("/live", "2026-05-28", "measuring"), change("/old", "2026-01-05", "won")]; expect([...contaminationFor(ledger, ["/queued"], NOW_C)]).toEqual([["/live", "treated-now"], ["/queued", "open-proposal"]]);
    expect(contaminationFor(ledger, [], NOW_C, change("/x", "2026-05-20", "measuring")).has("/old")).toBe(false); expect(contaminationFor(ledger, [], NOW_C, change("/x", "2026-01-20", "measuring")).get("/old")).toBe("measuring-window-overlap");});
  it("stands the matched page behind a change instead of the biggest one, and says why in checkable facts", () => {
    const cand = (path: string, pageType: string | null, impr: number) =>
      ({ url: `https://s.test${path}`, path, pageType, baselineImpressions: impr, hasBaseline: impr > 0 });
    const { controls, receipts } = selectMatchedControls({
      treated: { path: "/a", pageType: "city", baselineImpressions: 1000 },
      candidates: [cand("/huge", "guide", 90000), cand("/peer", "city", 1400), cand("/dirty", "city", 1100), cand("/thin", null, 0)],
      excluded: contaminationFor([change("/dirty", "2026-05-30", "measuring")], [], NOW_C),});
    expect(controls).toEqual(["https://s.test/peer", "https://s.test/huge", "https://s.test/thin"]);
    expect(receipts[0]).toEqual({ path: "/peer", reasons: ["same page type: city", "traffic within 2x",
      "search data across the whole baseline window", "no open or measuring changes"] }); });
  it("calls too few fair comparisons a verdict, shows the page's own numbers unadjusted, and teaches nothing", () => {
    const read = evaluateChange(baseInput({ actionType: "content",
      windows: [win(28, { adjustedClicksLift: 40, controlsUsed: 1, treatedDelta: 58 })] }), CLOSED_WINDOWS, []);
    expect([read.comparison, read.verdict, read.rankingSignal]).toEqual(["insufficient", "insufficient_evidence", 0]); expect(read.headline).toBe("The change is recorded. Its effect cannot be separated from the rest of the site yet.");
    expect(read.unadjusted).toEqual({ basisDay: 28, clicksBefore: 400, clicksAfter: 458, impressionsBefore: 5000, impressionsAfter: 5000 }); expect(learningVerdictOf(read)).toBe("measuring");
    // AND THE SITE'S OWN MOVEMENT IS A BASIS, NOT A SHORTAGE (operator, 2026-09-03): the same window read against the rest of the site lands in the band a matched read lands in, and says what it stood against rather than borrowing "similar pages".
    const at = (over: Partial<KernelInput["windows"][number]>) => evaluateChange(baseInput({ actionType: "content", windows: [win(28, { adjustedClicksLift: 40, treatedDelta: 58, ...over })] }), CLOSED_WINDOWS, []);
    const drift = at({ controlsUsed: 1, comparedToSite: true });
    expect([drift.comparison, drift.verdict, bandOf(drift)]).toEqual(["site", "directional_improvement", bandOf(at({ controlsUsed: 3 }))]);
    expect(drift.headline).toContain("40 clicks ahead of the rest of the site over the 28-day window");
    expect(drift.headline).toContain("Measured against the site's own movement, because too few untouched pages matched this one. That is a weaker comparison than matched pages, and a rise the whole site shared shows up here as no change.");
    expect([drift.confidence, drift.confidenceReasons[0]]).toEqual(["low", "Read on the 28-day window against the site's own movement, which is weaker than a comparison with matched pages."]); });
  it("teaches ranking the frozen reading, and records a recompute that disagrees beside it", () => {
    const pin = { verdict: "directional_improvement", metric: "clicks", lift: 1040, impressionsLift: 0, basisDay: 28,
      confidence: "high", controlsUsed: 4, pinnedAt: "2026-06-01T00:00:00.000Z", finalizedThrough: "2026-05-20" } as const;
    const learned = readRecordsForLearning([{ ...ledgerRow(), pinnedRead: pin }], LATE)[0]; expect([learned.lift, learned.confidence, learningVerdictOf(learned)]).toEqual([1040, "high", "won"]);
    const corrected = withCorrection(pin, { ...learned, lift: 1428 }, LATE)!; expect([corrected.lift, corrected.corrections?.length]).toEqual([1040, 1]); }); });
