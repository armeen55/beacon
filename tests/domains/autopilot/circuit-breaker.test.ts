/**
 * Portfolio circuit breaker (2026-07-02, BEACON 500 item 80).
 *
 * Pins the two trip gates, their boundaries, the fail-safe direction (a
 * computation error must NEVER itself trip the breaker), and the plain
 * language of the reason line (first person, real numbers, no em/en dashes).
 */

import { describe, it, expect } from "vitest";

import {
  evaluateCircuitBreaker,
  groupIntoSettledBatches,
  countRollbacksInWindow,
  outcomeOf,
  DEFAULT_CIRCUIT_BREAKER_CONFIG,
  type BreakerProofInput,
  type BreakerReceiptInput,
} from "@/domains/autopilot/circuit-breaker";

const NOW = new Date("2026-07-02T09:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function windowRow(partial: Partial<BreakerProofInput["windows"][number]> = {}): BreakerProofInput["windows"][number] {
  return { day: 14, ran: true, adjustedLift: 0, adjustedCtrLift: 0, adjustedPosLift: 0, ...partial };
}

// "update_intro" is judged on CLICKS (not in pickProofMetric's CTR/POSITION
// sets) - the default fixture lever, so windowRow's adjustedLift is the field
// evaluateCircuitBreaker actually reads for these tests.
function proofRow(partial: Partial<BreakerProofInput> = {}): BreakerProofInput {
  return {
    id: "row-1",
    path: "/a",
    actionType: "update_intro",
    shippedAt: NOW.toISOString(),
    verdict: "lost",
    windows: [windowRow()],
    ...partial,
  };
}

function receiptRow(partial: Partial<BreakerReceiptInput> = {}): BreakerReceiptInput {
  return { kind: "revert", result: "pushed", shippedAt: NOW.toISOString(), ...partial };
}

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

// ---------------------------------------------------------------------------
// outcomeOf / groupIntoSettledBatches (pure helpers)
// ---------------------------------------------------------------------------

describe("outcomeOf", () => {
  it("reads clicks (adjustedLift) for a clicks-judged lever", () => {
    const clicksRow = proofRow({ actionType: "update_intro", windows: [windowRow({ adjustedLift: -5 })] });
    expect(outcomeOf(clicksRow)).toEqual({ metric: "clicks", value: -5 });
  });

  it("reads CTR (adjustedCtrLift) for a CTR-judged lever (e.g. edit_title)", () => {
    const ctrRow = proofRow({ actionType: "edit_title", windows: [windowRow({ adjustedCtrLift: -0.02 })] });
    expect(outcomeOf(ctrRow)).toEqual({ metric: "ctr", value: -0.02 });
  });

  it("reads position (adjustedPosLift) for a position-judged lever", () => {
    const posRow = proofRow({ actionType: "add_internal_link", windows: [windowRow({ adjustedPosLift: -1.2 })] });
    expect(outcomeOf(posRow)).toEqual({ metric: "position", value: -1.2 });
  });

  it("picks the LONGEST ran window as the basis", () => {
    const r = proofRow({
      windows: [
        windowRow({ day: 7, ran: true, adjustedLift: -1 }),
        windowRow({ day: 14, ran: true, adjustedLift: -9 }),
        windowRow({ day: 28, ran: false, adjustedLift: 999 }),
      ],
    });
    expect(outcomeOf(r)).toEqual({ metric: "clicks", value: -9 });
  });

  it("returns null when no window has run", () => {
    const r = proofRow({ windows: [windowRow({ ran: false })] });
    expect(outcomeOf(r)).toBeNull();
  });
});

describe("groupIntoSettledBatches", () => {
  it("groups by Pacific ship date, newest first", () => {
    const batches = groupIntoSettledBatches([
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "lost" }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(1), verdict: "won" }),
      proofRow({ id: "c", shippedAt: isoDaysAgo(3), verdict: "lost" }),
    ]);
    expect(batches).toHaveLength(2);
    expect(batches[0].records.map((r) => r.id).sort()).toEqual(["a", "b"]);
    expect(batches[1].records.map((r) => r.id)).toEqual(["c"]);
  });

  it("excludes unsettled verdicts (measuring, insufficient_data)", () => {
    const batches = groupIntoSettledBatches([
      proofRow({ id: "a", verdict: "measuring" }),
      proofRow({ id: "b", verdict: "insufficient_data" }),
    ]);
    expect(batches).toHaveLength(0);
  });

  it("sums each record's own judged-metric outcome into netOutcome", () => {
    const batches = groupIntoSettledBatches([
      proofRow({ id: "a", verdict: "lost", windows: [windowRow({ adjustedLift: -10 })] }),
      proofRow({ id: "b", verdict: "won", windows: [windowRow({ adjustedLift: 4 })] }),
    ]);
    expect(batches[0].netOutcome).toBe(-6);
  });
});

describe("countRollbacksInWindow", () => {
  it("counts only pushed revert receipts inside the trailing window", () => {
    const receipts = [
      receiptRow({ shippedAt: isoDaysAgo(1) }),
      receiptRow({ shippedAt: isoDaysAgo(2), result: "failed" }), // failed - excluded
      receiptRow({ shippedAt: isoDaysAgo(2), kind: "ship" }), // ship, not revert - excluded
      receiptRow({ shippedAt: isoDaysAgo(10) }), // outside 7-day window - excluded
    ];
    const res = countRollbacksInWindow(receipts, NOW, 7);
    expect(res.count).toBe(1);
  });

  it("returns zero for an empty receipt list", () => {
    expect(countRollbacksInWindow([], NOW, 7).count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// evaluateCircuitBreaker - the trip decision
// ---------------------------------------------------------------------------

describe("evaluateCircuitBreaker - consecutive-negative gate", () => {
  it("trips when the last TWO consecutive settled batches both net negative", () => {
    const proofRecords = [
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "lost", windows: [windowRow({ adjustedLift: -20 })] }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(3), verdict: "lost", windows: [windowRow({ adjustedLift: -21 })] }),
    ];
    const res = evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW });
    expect(res.tripped).toBe(true);
    expect(res.reason).toContain("I paused myself");
    expect(res.reason).toContain("41"); // combined magnitude, real number
    expect(res.evidence.batches).toHaveLength(2);
    expect(res.sinceIso).not.toBeNull();
  });

  it("does NOT trip when only the latest batch is negative (prior batch was positive)", () => {
    const proofRecords = [
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "lost", windows: [windowRow({ adjustedLift: -20 })] }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(3), verdict: "won", windows: [windowRow({ adjustedLift: 5 })] }),
    ];
    const res = evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW });
    expect(res.tripped).toBe(false);
  });

  it("does NOT trip on a single negative batch (needs two consecutive)", () => {
    const proofRecords = [proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "lost", windows: [windowRow({ adjustedLift: -50 })] })];
    const res = evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW });
    expect(res.tripped).toBe(false);
  });

  it("boundary: a batch net exactly zero is NOT negative", () => {
    const proofRecords = [
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "lost", windows: [windowRow({ adjustedLift: -5 })] }),
      proofRow({ id: "a2", shippedAt: isoDaysAgo(1), verdict: "won", windows: [windowRow({ adjustedLift: 5 })] }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(3), verdict: "lost", windows: [windowRow({ adjustedLift: -30 })] }),
    ];
    const res = evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW });
    expect(res.tripped).toBe(false);
  });

  it("a batch with zero settled rows (all measuring) never counts as one of the two", () => {
    const proofRecords = [
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "measuring" }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(3), verdict: "lost", windows: [windowRow({ adjustedLift: -30 })] }),
      proofRow({ id: "c", shippedAt: isoDaysAgo(5), verdict: "lost", windows: [windowRow({ adjustedLift: -30 })] }),
    ];
    const res = evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW });
    // Only 2 settled batches exist (b, c) after excluding the measuring-only batch - trips.
    expect(res.tripped).toBe(true);
  });
});

describe("evaluateCircuitBreaker - rollback-count gate", () => {
  it("trips when the default 2 rollbacks fire within 7 days", () => {
    const receipts = [receiptRow({ shippedAt: isoDaysAgo(1) }), receiptRow({ shippedAt: isoDaysAgo(4) })];
    const res = evaluateCircuitBreaker({ proofRecords: [], receipts, now: NOW });
    expect(res.tripped).toBe(true);
    expect(res.reason).toContain("2");
    expect(res.reason).toContain("7");
    expect(res.evidence.rollbacks).toHaveLength(2);
  });

  it("does NOT trip on exactly 1 rollback (below the default threshold)", () => {
    const receipts = [receiptRow({ shippedAt: isoDaysAgo(1) })];
    const res = evaluateCircuitBreaker({ proofRecords: [], receipts, now: NOW });
    expect(res.tripped).toBe(false);
  });

  it("does NOT trip when 2 rollbacks fire outside the trailing window", () => {
    const receipts = [receiptRow({ shippedAt: isoDaysAgo(8) }), receiptRow({ shippedAt: isoDaysAgo(9) })];
    const res = evaluateCircuitBreaker({ proofRecords: [], receipts, now: NOW });
    expect(res.tripped).toBe(false);
  });

  it("respects a custom rollbackTripCount / rollbackWindowDays config", () => {
    const receipts = [receiptRow({ shippedAt: isoDaysAgo(1) }), receiptRow({ shippedAt: isoDaysAgo(2) }), receiptRow({ shippedAt: isoDaysAgo(3) })];
    const notTripped = evaluateCircuitBreaker({
      proofRecords: [],
      receipts,
      now: NOW,
      config: { rollbackTripCount: 5 },
    });
    expect(notTripped.tripped).toBe(false);
    const tripped = evaluateCircuitBreaker({
      proofRecords: [],
      receipts,
      now: NOW,
      config: { rollbackTripCount: 3 },
    });
    expect(tripped.tripped).toBe(true);
  });

  it("the rollback gate is checked independent of (and before) the batch gate", () => {
    // Two positive batches (would never trip gate a) but 2 rollbacks in-window.
    const proofRecords = [
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "won", windows: [windowRow({ adjustedLift: 5 })] }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(3), verdict: "won", windows: [windowRow({ adjustedLift: 5 })] }),
    ];
    const receipts = [receiptRow({ shippedAt: isoDaysAgo(1) }), receiptRow({ shippedAt: isoDaysAgo(2) })];
    const res = evaluateCircuitBreaker({ proofRecords, receipts, now: NOW });
    expect(res.tripped).toBe(true);
    expect(res.evidence.rollbacks).toHaveLength(2);
    expect(res.evidence.batches).toHaveLength(0);
  });
});

describe("evaluateCircuitBreaker - fail-safe direction", () => {
  it("never trips on malformed proofRecords (not an array)", () => {
    // @ts-expect-error deliberately malformed input
    const res = evaluateCircuitBreaker({ proofRecords: null, receipts: [], now: NOW });
    expect(res.tripped).toBe(false);
    expect(res.reason).toContain("did not pause");
  });

  it("never trips on malformed receipts (not an array)", () => {
    // @ts-expect-error deliberately malformed input
    const res = evaluateCircuitBreaker({ proofRecords: [], receipts: "boom", now: NOW });
    expect(res.tripped).toBe(false);
  });

  it("never trips on an invalid `now`", () => {
    const res = evaluateCircuitBreaker({ proofRecords: [], receipts: [], now: new Date("not-a-date") });
    expect(res.tripped).toBe(false);
  });

  it("never throws even when a record's windows field is garbage", () => {
    const proofRecords = [
      // @ts-expect-error deliberately malformed windows
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "lost", windows: "not-an-array" }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(3), verdict: "lost", windows: [windowRow({ adjustedLift: -30 })] }),
    ];
    expect(() => evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW })).not.toThrow();
    const res = evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW });
    expect(res.tripped).toBe(false);
  });

  it("returns the safe default config when none is passed", () => {
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.rollbackTripCount).toBe(2);
    expect(DEFAULT_CIRCUIT_BREAKER_CONFIG.rollbackWindowDays).toBe(7);
  });
});

describe("evaluateCircuitBreaker - plain language", () => {
  it("the reason line never contains an em or en dash", () => {
    const proofRecords = [
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "lost", windows: [windowRow({ adjustedLift: -20 })] }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(3), verdict: "lost", windows: [windowRow({ adjustedLift: -21 })] }),
    ];
    const res = evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW });
    expect(res.reason).not.toMatch(/[–—]/);
    const receipts = [receiptRow({ shippedAt: isoDaysAgo(1) }), receiptRow({ shippedAt: isoDaysAgo(2) })];
    const res2 = evaluateCircuitBreaker({ proofRecords: [], receipts, now: NOW });
    expect(res2.reason).not.toMatch(/[–—]/);
  });

  it("owns the miss plainly, first person, with a next-step framing", () => {
    const proofRecords = [
      proofRow({ id: "a", shippedAt: isoDaysAgo(1), verdict: "lost", windows: [windowRow({ adjustedLift: -20 })] }),
      proofRow({ id: "b", shippedAt: isoDaysAgo(3), verdict: "lost", windows: [windowRow({ adjustedLift: -21 })] }),
    ];
    const res = evaluateCircuitBreaker({ proofRecords, receipts: [], now: NOW });
    expect(res.reason).toContain("I paused myself");
    expect(res.reason.toLowerCase()).toContain("did not work");
  });
});
