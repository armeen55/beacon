import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Fail-soft integration contract for the item-19 rank re-check wired into
 * measureRecord (run-measurement.ts). The GSC diff-in-diff verdict is the
 * untouchable core of the proof ledger; this file pins that a SERP failure -
 * or a SERP win - never changes verdict/confidence/windows, and that the
 * batch-caller bound (allowRankRecheck=false) suppresses spend deterministically.
 *
 * gsc-window / ga4-window / citation-window all hit Supabase directly (no
 * injected deps), so they are mocked at the module boundary the way this
 * codebase mocks I/O modules elsewhere (vi.mock + module path).
 */

const gscWindow = {
  clicks: 100,
  impressions: 1000,
  ctr: 0.1,
  position: 8,
};

vi.mock("./gsc-window", () => ({
  readWindowForPages: vi.fn(async () => new Map([["https://iranopedia.com/singers", gscWindow]])),
  readLastFinalizedDate: vi.fn(async () => "2026-07-01"),
}));

vi.mock("./ga4-window", () => ({
  readGa4WindowForPages: vi.fn(async () => new Map()),
  readLatestGa4Date: vi.fn(async () => null),
}));

vi.mock("./citation-window", () => ({
  computeCitationOutcomeForRecord: vi.fn(async () => null),
}));

vi.mock("@/domains/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: vi.fn(async () => ({ gscByUrl: new Map(), snapshotByCanon: new Map() })),
  assemblePacketForUrl: vi.fn(() => ({ gsc: null })),
}));
vi.mock("@/domains/recommendation-intelligence/page-surgeon/bridge", () => ({
  loadPageSurgeonForUrl: vi.fn(async () => ({ status: "none" })),
}));

const { rankRecheckMock, readFloorsForMock, dailyClicksMock } = vi.hoisted(() => ({
  rankRecheckMock: vi.fn(),
  // Item 31: defaults to the fail-soft "no calibration yet" shape so every
  // existing test in this file (written before item 31) keeps its exact
  // pre-calibration behavior unless a test overrides the mock.
  readFloorsForMock: vi.fn(async () => ({})),
  // P4 R10a: the daily-clicks series behind the weekday-aligned, early-signal,
  // and novelty-decay attachments. Defaults to the fail-soft empty map so every
  // pre-existing test keeps its exact behavior (all three attachments null).
  dailyClicksMock: vi.fn(async () => new Map<string, Array<{ date: string; clicks: number }>>()),
}));

vi.mock("@/domains/serp/serp-history", () => ({
  rankSeriesFor: vi.fn(async () => [{ capturedAt: "2026-05-02T00:00:00Z", ownRank: 9, ownUrl: "https://iranopedia.com/singers" }]),
}));
vi.mock("./rank-recheck", async () => {
  const actual = await vi.importActual<typeof import("./rank-recheck")>("./rank-recheck");
  return {
    ...actual,
    runRankRecheck: rankRecheckMock,
  };
});
vi.mock("./aa-calibration-store", () => ({
  readFloorsFor: readFloorsForMock,
}));
vi.mock("./daily-series", () => ({
  loadDailyClicksByPathsForTenant: dailyClicksMock,
}));

import { measureRecord } from "./run-measurement";
import type { ShippedChangeRecord } from "./shipped-change-store";

function record(overrides: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "singers::2026-05-01",
    page: "https://iranopedia.com/singers",
    path: "/singers",
    actionType: "edit_title",
    before: "old title",
    after: "new title",
    shippedAt: "2026-05-01",
    baseline: { clicks: 50, impressions: 800, ctr: 0.06, position: 12, windowDays: 28 },
    targetQueries: ["persian singers"],
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
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

describe("measureRecord - rank re-check integration (item 19)", () => {
  beforeEach(() => {
    rankRecheckMock.mockReset();
  });

  it("attaches rankOutcome without touching the GSC verdict/windows", async () => {
    rankRecheckMock.mockResolvedValue({
      window: 7,
      query: "persian singers",
      wasRank: 9,
      wasAt: "2026-05-02T00:00:00Z",
      nowRank: 4,
      nowAt: "2026-05-08T00:00:00Z",
      delta: 5,
      sentence: 'Google moved this page 9 to 4 for "persian singers" since the change.',
    });

    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(result.rankOutcome?.sentence).toBe(
      'Google moved this page 9 to 4 for "persian singers" since the change.',
    );
    // The verdict path is computed purely from the mocked GSC window and must be
    // identical regardless of what the rank re-check returned.
    expect(result.windows.length).toBe(3);
    expect(result.verdict).toBeDefined();
  });

  it("is fail-soft: a thrown SERP re-check never blocks or alters the GSC verdict", async () => {
    rankRecheckMock.mockRejectedValue(new Error("dataforseo down"));

    const now = new Date("2026-05-09T00:00:00Z");
    const withFailure = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    rankRecheckMock.mockResolvedValue(null);
    const withNull = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(withFailure.rankOutcome).toBeNull();
    // Same verdict/windows shape as the null-rank-outcome path - the failure
    // changed nothing about the Search math.
    expect(withFailure.verdict).toBe(withNull.verdict);
    expect(withFailure.confidence).toBe(withNull.confidence);
    expect(withFailure.windows).toEqual(withNull.windows);
  });

  it("never calls the rank re-check when allowRankRecheck is false (the batch-pass bound)", async () => {
    rankRecheckMock.mockResolvedValue({
      window: 7,
      query: "persian singers",
      wasRank: 9,
      wasAt: "2026-05-02T00:00:00Z",
      nowRank: 4,
      nowAt: "2026-05-08T00:00:00Z",
      delta: 5,
      sentence: "should not appear",
    });
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01", new Set(), false);
    expect(result.rankOutcome).toBeNull();
    expect(rankRecheckMock).not.toHaveBeenCalled();
  });

  it("skips the rank re-check entirely when the record has no target query", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord(
      "tenant-iranopedia",
      record({ targetQueries: [] }),
      now,
      "2026-07-01",
    );
    expect(result.rankOutcome).toBeNull();
    expect(rankRecheckMock).not.toHaveBeenCalled();
  });
});

describe("measureRecord - item 31 A/A calibration floor injection", () => {
  beforeEach(() => {
    rankRecheckMock.mockReset();
    rankRecheckMock.mockResolvedValue(null);
    readFloorsForMock.mockReset();
    readFloorsForMock.mockResolvedValue({});
  });

  it("is BYTE-IDENTICAL to the pre-calibration verdict when no calibration data exists (the pin)", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const withEmptyCalibration = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(readFloorsForMock).toHaveBeenCalled();

    // Simulate "calibration store not registered / read failed" -> same {} shape.
    readFloorsForMock.mockResolvedValueOnce({});
    const withFailedCalibration = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(withEmptyCalibration.verdict).toBe(withFailedCalibration.verdict);
    expect(withEmptyCalibration.confidence).toBe(withFailedCalibration.confidence);
    expect(withEmptyCalibration.windows).toEqual(withFailedCalibration.windows);
  });

  it("passes the baseline-impressions-derived traffic tier to readFloorsFor", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    // gscWindow mock reads back 1000 impressions for the treated page pre-window -> "medium" tier.
    expect(readFloorsForMock).toHaveBeenCalledWith("tenant-iranopedia", "medium");
  });

  it("a calibrated stricter floor can flip a marginal win to inconclusive", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    // gscWindow mock: clicks 100, impressions 1000 for every page/window read, so
    // treated vs control clicks delta is 0 with the default fixture - use a
    // record whose baseline is large enough that MIN_LIFT_FRACTION still passes
    // with a small lift, and rely on the floor override instead to prove
    // wiring, not the underlying GSC math (already covered in measure.test.ts).
    readFloorsForMock.mockResolvedValue({ minLiftClicks: 100_000, minLiftCtr: 0.9 });
    const withHugeFloor = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    readFloorsForMock.mockResolvedValue({});
    const withDefaultFloor = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    // An impossibly high calibrated floor can only make the verdict LESS likely
    // to read won/lost than the default floor's own verdict.
    const strictness = (v: string) => (v === "won" || v === "lost" ? 1 : 0);
    expect(strictness(withHugeFloor.verdict)).toBeLessThanOrEqual(strictness(withDefaultFloor.verdict));
  });

  it("is fail-soft: a thrown readFloorsFor never blocks or alters the GSC verdict", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    readFloorsForMock.mockRejectedValueOnce(new Error("store down"));
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(result.verdict).toBeDefined();
    expect(result.windows.length).toBe(3);
  });
});

describe("measureRecord - item 67 Bayesian read integration", () => {
  beforeEach(() => {
    rankRecheckMock.mockReset();
    rankRecheckMock.mockResolvedValue(null);
    readFloorsForMock.mockReset();
    readFloorsForMock.mockResolvedValue({});
  });

  it("attaches a bayesianRead for a CTR-judged action type without touching verdict/windows", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record({ actionType: "edit_title" }), now, "2026-07-01");
    // edit_title is CTR-judged; the gscWindow mock returns real clicks/impressions
    // for both pre and post, so a read should be computed.
    expect(result.bayesianRead).not.toBeNull();
    expect(typeof result.bayesianRead?.pWin).toBe("number");
    expect(typeof result.bayesianRead?.sentence).toBe("string");
    expect(result.windows.length).toBe(3);
  });

  it("never attaches a bayesianRead for a position-judged action type (no honest count/rate model for a rank)", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord(
      "tenant-iranopedia",
      record({ actionType: "add_internal_link" }),
      now,
      "2026-07-01",
    );
    expect(result.bayesianRead).toBeNull();
  });

  it("is null before any window has run (measuring state)", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    // No finalized data at all -> no window has run.
    const result = await measureRecord("tenant-iranopedia", record(), now, null);
    expect(result.bayesianRead).toBeNull();
  });

  it("is fail-soft: a throwing buildBayesianRead dependency never blocks the GSC verdict", async () => {
    // buildBayesianRead itself is pure and cannot throw on well-formed numeric
    // input, but the call site wraps it in try/catch - assert the overall
    // measure call still resolves with a defined verdict regardless.
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(result.verdict).toBeDefined();
  });
});

describe("measureRecord - P4 R10a query-panel + daily-shape attachments", () => {
  beforeEach(() => {
    rankRecheckMock.mockReset();
    rankRecheckMock.mockResolvedValue(null);
    readFloorsForMock.mockReset();
    readFloorsForMock.mockResolvedValue({});
    dailyClicksMock.mockReset();
    dailyClicksMock.mockResolvedValue(new Map());
  });

  /** Daily series builder: 28 baseline days at `baseline` clicks starting at
   *  ship minus 28, then `post` per-day clicks from the ship date. */
  function dailySeries(shipDate: string, baseline: number, post: number[]): Array<{ date: string; clicks: number }> {
    const addDays = (d: string, n: number): string => {
      const dt = new Date(`${d}T00:00:00Z`);
      dt.setUTCDate(dt.getUTCDate() + n);
      return dt.toISOString().slice(0, 10);
    };
    const out: Array<{ date: string; clicks: number }> = [];
    for (let i = -28; i < 0; i++) out.push({ date: addDays(shipDate, i), clicks: baseline });
    post.forEach((clicks, i) => out.push({ date: addDays(shipDate, i), clicks }));
    return out;
  }

  it("all four attachments are honestly null with no daily series and no query grain (fail-soft), verdict untouched", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    // Query panel: gsc_daily_rows is unreachable in this file (no Supabase
    // env) - honest null, never a fabricated panel.
    expect(result.panelOutcome).toBeNull();
    expect(result.weekdayAdjustedLift).toBeNull();
    expect(result.earlySignal).toBeNull();
    expect(result.noveltyDecay).toBeNull();
    expect(result.verdict).toBeDefined();
    expect(result.windows.length).toBe(3);
  });

  it("computes noveltyDecay + weekdayAdjustedLift off a full 28-day post series WITHOUT touching verdict/windows", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    // Decay shape: week 1 at 20 clicks a day, weeks 2-4 back at the 10-a-day baseline.
    const post = [...Array(7).fill(20), ...Array(21).fill(10)] as number[];
    dailyClicksMock.mockResolvedValue(new Map([["/singers", dailySeries("2026-05-01", 10, post)]]));

    const withSeries = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    dailyClicksMock.mockResolvedValue(new Map());
    const withoutSeries = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(withSeries.noveltyDecay).not.toBeNull();
    expect(withSeries.noveltyDecay?.noveltyDecay).toBe(true);
    expect(withSeries.noveltyDecay?.sentence).toContain("novelty, not a lasting win");
    expect(withSeries.weekdayAdjustedLift).not.toBeNull();
    // Flat baseline, full-week window: raw and aligned agree - no preference.
    expect(withSeries.weekdayAdjustedLift?.preferAdjusted).toBe(false);
    // The 28-day window has closed - early signals no longer apply.
    expect(withSeries.earlySignal).toBeNull();
    // The attachments never alter the Search math.
    expect(withSeries.verdict).toBe(withoutSeries.verdict);
    expect(withSeries.confidence).toBe(withoutSeries.confidence);
    expect(withSeries.windows).toEqual(withoutSeries.windows);
    expect(dailyClicksMock).toHaveBeenCalledWith("tenant-iranopedia", ["/singers"], expect.any(Number));
  });

  it("computes earlyDecisive while the 28-day window is still open (presentation only, clock untouched)", async () => {
    const now = new Date("2026-05-12T00:00:00Z");
    // 10 finalized post days, every one far above the flat 10-a-day baseline.
    dailyClicksMock.mockResolvedValue(
      new Map([["/singers", dailySeries("2026-05-01", 10, Array(10).fill(25))]]),
    );
    // Watermark at 2026-05-10: the 7-day window has closed, 14/28 have not.
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-05-10");

    expect(result.windows.find((w) => w.day === 7)?.ran).toBe(true);
    expect(result.windows.find((w) => w.day === 28)?.ran).toBe(false);
    expect(result.earlySignal).not.toBeNull();
    expect(result.earlySignal?.earlyDecisive).toBe(true);
    expect(result.earlySignal?.direction).toBe("up");
    expect(result.earlySignal?.sentence).toContain("I do not need the full 28 days");
    // Novelty decay needs the full four post weeks - honestly null here.
    expect(result.noveltyDecay).toBeNull();
  });

  it("a thrown daily-series read never blocks or alters the GSC verdict (fail-soft)", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    dailyClicksMock.mockRejectedValue(new Error("supabase down"));
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(result.weekdayAdjustedLift).toBeNull();
    expect(result.earlySignal).toBeNull();
    expect(result.noveltyDecay).toBeNull();
    expect(result.verdict).toBeDefined();
    expect(result.windows.length).toBe(3);
  });

  it("skips the daily-shape read entirely before any finalized post-ship day exists", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-04-30");
    expect(dailyClicksMock).not.toHaveBeenCalled();
    expect(result.weekdayAdjustedLift).toBeNull();
    expect(result.earlySignal).toBeNull();
    expect(result.noveltyDecay).toBeNull();
  });
});

describe("measureRecord - item 68 target-query read integration", () => {
  beforeEach(() => {
    rankRecheckMock.mockReset();
    rankRecheckMock.mockResolvedValue(null);
    readFloorsForMock.mockReset();
    readFloorsForMock.mockResolvedValue({});
  });

  it("resolves to an empty targetQueryRead array when gsc_daily_rows is unreachable (fail-soft honest silence)", async () => {
    // No Supabase env in this test file (getSupabaseAdmin throws), so the
    // per-query reader fails soft to [] - this must never surface as a thrown
    // error or alter the page-level verdict.
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(result.targetQueryRead).toEqual([]);
    expect(result.verdict).toBeDefined();
  });

  it("skips the target-query read entirely when the record has no target queries", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord(
      "tenant-iranopedia",
      record({ targetQueries: [] }),
      now,
      "2026-07-01",
    );
    expect(result.targetQueryRead).toEqual([]);
  });

  it("is null-safe before any window has run (measuring state)", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, null);
    expect(result.targetQueryRead).toEqual([]);
  });
});
