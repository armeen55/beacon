import { describe, it, expect } from "vitest";
import type { ShippedChangeRecord } from "./shipped-change-store";
import type { ProofWindowResult } from "./measure";
import { isDueForMeasure, outcomeStateOf } from "./measure-lifecycle";

const NOW = new Date("2026-06-25T12:00:00Z");

function win(day: number, ran: boolean): ProofWindowResult {
  return { day, ran } as ProofWindowResult;
}

function record(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "p::d",
    page: "https://iranopedia.com/iran-flags",
    path: "/iran-flags",
    actionType: "add_answer_block",
    before: null,
    after: null,
    shippedAt: "2026-06-17", // 8 days before NOW
    baseline: { clicks: 0, impressions: 0, ctr: 0, position: 0, windowDays: 28 },
    targetQueries: [],
    controlPages: [],
    windows: [],
    verdict: "measuring",
    confidence: "low",
    measuredAt: null,
    notes: null,
    verifiedLive: false,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    createdAt: "2026-06-17",
    updatedAt: "2026-06-17",
    ...over,
  };
}

describe("isDueForMeasure", () => {
  it("is NOT due without a finalized GSC watermark", () => {
    expect(isDueForMeasure(record(), null, NOW)).toBe(false);
  });

  it("IS due when the 7d window can newly run (shipped 8d ago, watermark caught up)", () => {
    // shipped 2026-06-17 → 7d check = 2026-06-24; runnable once watermark >= 2026-06-23.
    expect(isDueForMeasure(record({ windows: [] }), "2026-06-24", NOW)).toBe(true);
  });

  it("is NOT due when every runnable window has already run", () => {
    // Only the 7d window is runnable at 8d; mark it ran. 14/28 are future → not runnable.
    expect(isDueForMeasure(record({ windows: [win(7, true)] }), "2026-06-24", NOW)).toBe(false);
  });

  it("re-checks a settled win while a later window can still run", () => {
    // shipped 15d ago → 14d window runnable; 7d ran, 14d not → due even though "won".
    const r = record({ shippedAt: "2026-06-10", verdict: "won", windows: [win(7, true), win(14, false)] });
    expect(isDueForMeasure(r, "2026-06-24", NOW)).toBe(true);
  });

  it("is NOT due once fully aged out (> 28d + grace)", () => {
    const r = record({ shippedAt: "2026-05-10" }); // ~46 days before NOW
    expect(isDueForMeasure(r, "2026-06-24", NOW)).toBe(false);
  });
});

describe("outcomeStateOf", () => {
  it("maps verdicts to lifecycle states", () => {
    expect(outcomeStateOf(record({ verdict: "won" }), NOW)).toBe("win");
    expect(outcomeStateOf(record({ verdict: "lost" }), NOW)).toBe("loss");
    expect(outcomeStateOf(record({ verdict: "inconclusive" }), NOW)).toBe("inconclusive");
    expect(outcomeStateOf(record({ verdict: "insufficient_data" }), NOW)).toBe("inconclusive");
  });
  it("is 'measuring' while in flight", () => {
    expect(outcomeStateOf(record({ verdict: "measuring", windows: [win(7, true)] }), NOW)).toBe("measuring");
  });
  it("is 'stale' when aged out with no window ever run", () => {
    const r = record({ shippedAt: "2026-05-10", verdict: "measuring", windows: [] });
    expect(outcomeStateOf(r, NOW)).toBe("stale");
  });
  it("is NOT stale if a window ran, even when old (a real reading exists)", () => {
    const r = record({ shippedAt: "2026-05-10", verdict: "measuring", windows: [win(28, true)] });
    expect(outcomeStateOf(r, NOW)).toBe("measuring");
  });
});
