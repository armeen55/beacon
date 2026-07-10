import { describe, it, expect } from "vitest";
import type { ShippedChangeRecord } from "./shipped-change-store";
import type { ProofWindowResult } from "./measure";
import { isDueForMeasure, outcomeStateOf, gscLagStatus, proofMaturityLabel, resolveVerdictLag } from "./measure-lifecycle";

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

  it("E-39 D4: past the horizon, a still-unsettled record IS due when its 28-day data finally arrived (recompute-to-settle)", () => {
    const r = record({ shippedAt: "2026-05-10" }); // ~46 days before NOW, still 'measuring'
    // required 28-day GSC date = 2026-06-06; watermark 2026-06-24 has it -> recompute.
    expect(isDueForMeasure(r, "2026-06-24", NOW)).toBe(true);
  });

  it("E-39 D4: past the horizon with NO new data is NOT due (released + retryable, never a fabricated verdict)", () => {
    const r = record({ shippedAt: "2026-05-10" });
    // watermark 2026-06-05 is BEFORE the required 2026-06-06 -> no recompute.
    expect(isDueForMeasure(r, "2026-06-05", NOW)).toBe(false);
  });

  it("E-39 D4: past the bounded fair retry window is NOT due even with data (never re-scan forever)", () => {
    const r = record({ shippedAt: "2026-01-01" }); // ~175 days before NOW, well past horizon + retry
    expect(isDueForMeasure(r, "2026-06-24", NOW)).toBe(false);
  });
});

describe("resolveVerdictLag - E-39 D4 verdict-lag repair (fail-closed, honest)", () => {
  it("in_window while inside 28d + grace", () => {
    expect(resolveVerdictLag(record({ shippedAt: "2026-06-17" }), "2026-06-24", NOW).kind).toBe("in_window");
  });
  it("settled when a mature verdict already exists (never re-opened)", () => {
    expect(resolveVerdictLag(record({ shippedAt: "2026-05-10", verdict: "won" }), "2026-06-24", NOW).kind).toBe("settled");
    expect(resolveVerdictLag(record({ shippedAt: "2026-05-10", verdict: "lost" }), "2026-06-24", NOW).kind).toBe("settled");
  });
  it("recompute past the horizon ONLY when the 28-day data is available (settle + release)", () => {
    expect(resolveVerdictLag(record({ shippedAt: "2026-05-10" }), "2026-06-24", NOW).kind).toBe("recompute");
  });
  it("release_unresolved with NO fabricated verdict when data is unavailable, and stays retryable", () => {
    const r = resolveVerdictLag(record({ shippedAt: "2026-05-10" }), "2026-06-05", NOW);
    expect(r.kind).toBe("release_unresolved");
    if (r.kind === "release_unresolved") {
      expect(r.markState).toBe("blocked_data"); // honest, never won/lost/inconclusive
      expect(r.retryEligible).toBe(true);
    }
  });
  it("stops retrying past the bounded fair window (retryEligible false), still never fabricates a verdict", () => {
    const r = resolveVerdictLag(record({ shippedAt: "2026-01-01" }), "2026-06-24", NOW);
    expect(r.kind).toBe("release_unresolved");
    if (r.kind === "release_unresolved") expect(r.retryEligible).toBe(false);
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

describe("gscLagStatus — why a calendar-open window still has no verdict", () => {
  // shipped 2026-06-20 → 7-day check ≈ 2026-06-27, needs GSC through 2026-06-26.
  const r = () => record({ shippedAt: "2026-06-20", windows: [] });
  const NOW_28 = new Date("2026-06-28T12:00:00Z");

  it("calendar passed but GSC behind → not available, honest reason", () => {
    const s = gscLagStatus(r(), "2026-06-25", NOW_28);
    expect(s.calendarWindowClosed).toBe(true);
    expect(s.gscWindowAvailable).toBe(false);
    expect(s.latestGscDate).toBe("2026-06-25");
    expect(s.reasonCopy).toContain("needs Search Console data through");
    expect(s.reasonCopy).toContain("2026-06-25");
  });

  it("GSC caught up → window available", () => {
    const s = gscLagStatus(r(), "2026-06-27", NOW_28);
    expect(s.gscWindowAvailable).toBe(true);
    expect(s.reasonCopy).toContain("Ready");
  });

  it("calendar not yet passed → 'check opens'", () => {
    const s = gscLagStatus(record({ shippedAt: "2026-06-26", windows: [] }), "2026-06-25", new Date("2026-06-27T12:00:00Z"));
    expect(s.calendarWindowClosed).toBe(false);
    expect(s.reasonCopy).toContain("opens");
  });

  it("no GSC data at all → honest 'no data yet'", () => {
    const s = gscLagStatus(r(), null, NOW_28);
    expect(s.gscWindowAvailable).toBe(false);
    expect(s.reasonCopy).toContain("no Search Console data");
  });
});

describe("proofMaturityLabel — 7d early / 14d strengthening / 28d final (UI only)", () => {
  it("positive verdict reads as a signal at 7d/14d, only 'Helped' at 28d", () => {
    expect(proofMaturityLabel("won", 7)).toBe("Early positive signal");
    expect(proofMaturityLabel("won", 14)).toBe("Positive signal strengthening");
    expect(proofMaturityLabel("won", 28)).toBe("Helped");
  });
  it("negative verdict reads as a signal at 7d/14d, only 'Did not help' at 28d", () => {
    expect(proofMaturityLabel("lost", 7)).toBe("Early negative signal");
    expect(proofMaturityLabel("lost", 14)).toBe("Negative signal strengthening");
    expect(proofMaturityLabel("lost", 28)).toBe("Did not help");
  });
  it("a fresh 7-day win never reads as final", () => {
    expect(proofMaturityLabel("won", 7)).not.toMatch(/helped/i);
  });
  it("non-settled verdicts pass through to calm words; null basis → final read", () => {
    expect(proofMaturityLabel("measuring", null)).toBe("Still measuring");
    expect(proofMaturityLabel("inconclusive", 14)).toBe("No clear change");
    expect(proofMaturityLabel("won", null)).toBe("Helped");
  });
});
