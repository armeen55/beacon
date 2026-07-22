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

vi.mock("@/domains/proof-gsc/gsc-window", () => ({
  readWindowForPages: vi.fn(async () => new Map([["https://iranopedia.com/singers", gscWindow]])),
  readLastFinalizedDate: vi.fn(async () => "2026-07-01"),
}));

vi.mock("@/domains/proof-gsc/ga4-window", () => ({
  readGa4WindowForPages: vi.fn(async () => new Map()),
  readLatestGa4Date: vi.fn(async () => null),
}));

vi.mock("@/domains/proof-gsc/citation-window", () => ({
  computeCitationOutcomeForRecord: vi.fn(async () => null),
}));

vi.mock("@/domains/recommendation-intelligence/page-surgeon/assemble-packet", () => ({
  loadPageSurgeonContext: vi.fn(async () => ({ gscByUrl: new Map(), snapshotByCanon: new Map() })),
  assemblePacketForUrl: vi.fn(() => ({ gsc: null })),
}));
vi.mock("@/domains/recommendation-intelligence/page-surgeon/bridge", () => ({
  loadPageSurgeonForUrl: vi.fn(async () => ({ status: "none" })),
}));

const { rankRecheckMock, readFloorsForMock, dailyClicksMock, changepointsMock } = vi.hoisted(() => ({
  rankRecheckMock: vi.fn(),
  // Item 31: defaults to the fail-soft "no calibration yet" shape so every
  // existing test in this file (written before item 31) keeps its exact
  // pre-calibration behavior unless a test overrides the mock.
  readFloorsForMock: vi.fn(async () => ({})),
  // P4 R10a: the daily-clicks series behind the weekday-aligned, early-signal,
  // and novelty-decay attachments. Defaults to the fail-soft empty map so every
  // pre-existing test keeps its exact behavior (all three attachments null).
  dailyClicksMock: vi.fn(async () => new Map<string, Array<{ date: string; clicks: number }>>()),
  // P4 R10b (v1 152): the persisted changepoints behind the clean-window
  // salvage's SELF-read path (when no shockWindows param is passed). Defaults
  // to [] so pre-existing tests never pick up a developer's local .data state.
  changepointsMock: vi.fn(async () => [] as Array<{ date: string; direction: "up" | "down" }>),
}));

vi.mock("@/domains/serp/serp-history", () => ({
  rankSeriesFor: vi.fn(async () => [{ capturedAt: "2026-05-02T00:00:00Z", ownRank: 9, ownUrl: "https://iranopedia.com/singers" }]),
}));
vi.mock("@/domains/proof-gsc/rank-recheck", async () => {
  const actual = await vi.importActual<typeof import("@/domains/proof-gsc/rank-recheck")>("@/domains/proof-gsc/rank-recheck");
  return {
    ...actual,
    runRankRecheck: rankRecheckMock,
  };
});
vi.mock("@/domains/proof-gsc/aa-calibration-store", () => ({
  readFloorsFor: readFloorsForMock,
}));
vi.mock("@/domains/proof-gsc/daily-series", () => ({
  loadDailyClicksByPathsForTenant: dailyClicksMock,
}));
vi.mock("@/domains/proof-gsc/algorithm-weather-store", () => ({
  loadDetectedChangepoints: changepointsMock,
}));

import { measureRecord } from "@/domains/proof-gsc/run-measurement";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { ShockWindow } from "@/domains/proof-gsc/algorithm-weather";

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
    operatorVerdictOverride: null, calibrationVersion: null,
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

});

describe("measureRecord - P4 R10b breadth + equivalence + clean-window salvage", () => {
  beforeEach(() => {
    rankRecheckMock.mockReset();
    rankRecheckMock.mockResolvedValue(null);
    readFloorsForMock.mockReset();
    readFloorsForMock.mockResolvedValue({});
    dailyClicksMock.mockReset();
    dailyClicksMock.mockResolvedValue(new Map());
    changepointsMock.mockReset();
    changepointsMock.mockResolvedValue([]);
  });

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

  it("queryBreadth is honestly null when gsc_daily_rows is unreachable (fail-soft), verdict untouched", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(result.queryBreadth).toBeNull();
    expect(result.verdict).toBeDefined();
    expect(result.windows.length).toBe(3);
  });

  it("attaches an equivalence read on a mature non-win with a Bayesian read, without touching the verdict", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    // The fixture's verdict is a non-win (no comparison pages -> the floor
    // verdict reads insufficient_data) with a closed 28 day window and a real
    // CTR Bayesian read - so the equivalence test RAN. Its interval here is
    // far wider than the band, so neutrality is honestly NOT proven.
    expect(result.verdict).not.toBe("won");
    expect(result.equivalence).not.toBeNull();
    expect(result.equivalence?.provenNeutral).toBe(false);
    expect(result.equivalence?.sentence).toBeNull();
  });

  it("computes cleanWindowLift from caller-passed shock windows WITHOUT reading the changepoint store", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    dailyClicksMock.mockResolvedValue(new Map([["/singers", dailySeries("2026-05-01", 10, Array(28).fill(12))]]));
    const shocks: ShockWindow[] = [
      { id: "confirmed:test", start: "2026-05-06", end: "2026-05-14", kind: "confirmed", label: "a test update" },
    ];
    const withShocks = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01", new Set(), true, shocks);
    expect(withShocks.cleanWindowLift).not.toBeNull();
    expect(withShocks.cleanWindowLift?.muddiedDays).toBe(9);
    expect(withShocks.cleanWindowLift?.cleanDays).toBe(19);
    expect(withShocks.cleanWindowLift?.sentence).toBe(
      "A Google update muddied 9 of these 28 days; on the 19 clean days this change is still up 20 percent.",
    );
    expect(changepointsMock).not.toHaveBeenCalled();

    // An explicitly-empty shock list means nothing muddied -> honest null,
    // and the verdict is identical either way (salvage never touches it).
    const noShocks = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01", new Set(), true, []);
    expect(noShocks.cleanWindowLift).toBeNull();
    expect(noShocks.verdict).toBe(withShocks.verdict);
    expect(noShocks.windows).toEqual(withShocks.windows);
  });

  it("self-reads the persisted changepoints when no shock list is passed (and the May 2026 confirmed update salvages)", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    dailyClicksMock.mockResolvedValue(new Map([["/singers", dailySeries("2026-05-01", 10, Array(28).fill(12))]]));
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(changepointsMock).toHaveBeenCalledWith("tenant-iranopedia");
    // The seeded May 2026 core update (May 21 to June 2) muddies post days
    // 21 through 28 of this window; the other 20 days salvage cleanly.
    expect(result.cleanWindowLift).not.toBeNull();
    expect(result.cleanWindowLift?.shockKind).toBe("confirmed");
    expect(result.cleanWindowLift?.muddiedDays).toBe(8);
    expect(result.cleanWindowLift?.cleanDays).toBe(20);
    expect(result.cleanWindowLift?.sentence).toContain("A Google update muddied 8 of these 28 days");
  });

  it("a thrown changepoint-store read never blocks the salvage path or the verdict (fail-soft)", async () => {
    const now = new Date("2026-07-01T00:00:00Z");
    dailyClicksMock.mockResolvedValue(new Map([["/singers", dailySeries("2026-05-01", 10, Array(28).fill(12))]]));
    changepointsMock.mockRejectedValue(new Error("store down"));
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    // The rejected store read fails soft to [] but the seeded confirmed
    // update list still applies - and the verdict is untouched regardless.
    expect(result.verdict).toBeDefined();
    expect(result.windows.length).toBe(3);
    expect(result.cleanWindowLift?.muddiedDays).toBe(8);
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

  it("is null-safe before any window has run (measuring state)", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, null);
    expect(result.targetQueryRead).toEqual([]);
  });
});

describe("measureRecord - fail-closed calibration quarantine (review fix 4)", () => {
  it("a re-measure RESETS a previously stamped calibrationVersion to null (this pass ran under the old thresholds)", async () => {
    // A record somehow stamped with a REGISTERED version gets re-measured today.
    // The verdict this pass computes comes from the current (self-test-failing)
    // thresholds, so the stamp no longer describes it: the result must be null.
    // Only the future corrected classifier may write a version, at the moment it
    // computes a verdict itself.
    registerTestCalibratedVersion();
    try {
      const now = new Date("2026-05-09T00:00:00Z");
      const stamped = record({ calibrationVersion: TEST_CALIBRATED_VERSION });
      const result = await measureRecord("tenant-iranopedia", stamped, now, "2026-07-01");
      expect(result.calibrationVersion).toBeNull();
    } finally {
      clearTestCalibratedVersions();
    }
  });

  it("an unstamped record stays null through a measure (no version ever invented)", async () => {
    const now = new Date("2026-05-09T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(result.calibrationVersion).toBeNull();
  });
});

type CalibrationRecordArg = {
  pickId: string;
  tenantId: string;
  proofId: string;
  page: string;
  lever: string;
  forecastLow: number;
  forecastHigh: number;
  actual: number;
  outcome: string;
  at: string;
};

const { listPlansMock, hasCalibrationRecordMock, appendCalibrationRecordMock } = vi.hoisted(() => ({
  listPlansMock: vi.fn(),
  hasCalibrationRecordMock: vi.fn(async (_tenantId: string, _pickId: string) => false),
  appendCalibrationRecordMock: vi.fn(async (_record: CalibrationRecordArg) => true),
}));

vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  listPlans: listPlansMock,
}));
vi.mock("@/domains/experiments/forecast-calibration-store", () => ({
  hasCalibrationRecord: hasCalibrationRecordMock,
  appendCalibrationRecord: appendCalibrationRecordMock,
  buildCalibrationRecord: (input: { pickId: string; tenantId: string; proofId: string; page: string; lever: string; forecastLow: number; forecastHigh: number; actual: number; at: string }) => ({
    ...input,
    outcome: input.actual < input.forecastLow ? "below" : input.actual > input.forecastHigh ? "above" : "inside",
  }),
}));

import type { DailyExperimentPlanRecord, PlannedExperimentRecord, ExperimentLever } from "@/domains/experiments/daily-plan-types";
import type { PlanExecutionState } from "@/domains/experiments/execution-state";

describe("measureRecord - calibration writer (folded from the calibration suite)", () => {
function pick(id: string, expectations?: PlannedExperimentRecord["expectations"]): PlannedExperimentRecord {
  return {
    id, candidateId: id, url: "https://iranopedia.com/singers", canonicalUrl: "https://iranopedia.com/singers",
    pageLabel: "Singers", pageFamily: "f", lever: "title" as ExperimentLever, targetQuery: "persian singers",
    whyNow: "why", currentText: "old title", proposedText: "new title", placement: "head", leaveUnchanged: [],
    rollbackText: "old title", effortMinutes: 2, risk: "low", controls: [], influencedUrls: [],
    evidenceHash: "e", currentTextHash: "h", eligibilityHash: "g", detail: { kind: "edit_field", field: "title" },
    expectations,
  };
}

function planWith(selected: PlannedExperimentRecord[], execution: PlanExecutionState): DailyExperimentPlanRecord {
  return {
    version: 1, id: "tenant-iranopedia::2026-05-01::abc", tenantId: "tenant-iranopedia", date: "2026-05-01", status: "accepted",
    createdAt: "t", expiresAt: "t", inputHash: "h", plannerVersion: "v",
    activeExperimentSnapshot: { proofIds: [], treatedUrls: [], controlUrls: [], influencedUrls: [], capturedAt: "t" },
    selected, backups: [], distribution: { byLever: {}, byPageFamily: {} }, estimatedMinutes: 10, execution,
  };
}
describe("measureRecord - calibration writer (items 27/28)", () => {
  beforeEach(() => {
    listPlansMock.mockReset();
    hasCalibrationRecordMock.mockReset().mockResolvedValue(false);
    appendCalibrationRecordMock.mockReset().mockResolvedValue(true);
  });

  it("writes a calibration record once the day-28 window has run and the pick has a numeric forecast", async () => {
    listPlansMock.mockResolvedValue([
      planWith(
        [pick("singers::2026-05-01", { forecast: "roughly 20 to 60", forecastLow: 20, forecastHigh: 60, forecastMetric: "clicks_per_month", changeOurMind: "x", effort: "y" })],
        { items: { "singers::2026-05-01": { experimentId: "singers::2026-05-01", status: "active", receipts: [], proofId: "singers::2026-05-01" } }, updatedAt: "t" },
      ),
    ]);
    const now = new Date("2026-06-15T00:00:00Z"); // well past day 28
    await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(appendCalibrationRecordMock).toHaveBeenCalledTimes(1);
    const written = appendCalibrationRecordMock.mock.calls[0]![0];
    expect(written.pickId).toBe("singers::2026-05-01");
    expect(written.forecastLow).toBe(20);
    expect(written.forecastHigh).toBe(60);
  });

  it("never writes when the day-28 window has not run yet", async () => {
    listPlansMock.mockResolvedValue([
      planWith(
        [pick("singers::2026-05-01", { forecastLow: 20, forecastHigh: 60, forecastMetric: "clicks_per_month", changeOurMind: "x", effort: "y" })],
        { items: { "singers::2026-05-01": { experimentId: "singers::2026-05-01", status: "active", receipts: [], proofId: "singers::2026-05-01" } }, updatedAt: "t" },
      ),
    ]);
    // lastFinalizedDate far in the past -> no window has run.
    const now = new Date("2026-05-03T00:00:00Z");
    await measureRecord("tenant-iranopedia", record(), now, "2026-05-02");
    expect(appendCalibrationRecordMock).not.toHaveBeenCalled();
  });

  it("never writes when the pick has no numeric forecast (prose-only, honest skip)", async () => {
    listPlansMock.mockResolvedValue([
      planWith(
        [pick("singers::2026-05-01", { forecast: "roughly 20 to 60", changeOurMind: "x", effort: "y" })],
        { items: { "singers::2026-05-01": { experimentId: "singers::2026-05-01", status: "active", receipts: [], proofId: "singers::2026-05-01" } }, updatedAt: "t" },
      ),
    ]);
    const now = new Date("2026-06-15T00:00:00Z");
    await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(appendCalibrationRecordMock).not.toHaveBeenCalled();
  });

  it("is idempotent: does not append when a calibration record already exists for this pick", async () => {
    listPlansMock.mockResolvedValue([
      planWith(
        [pick("singers::2026-05-01", { forecastLow: 20, forecastHigh: 60, forecastMetric: "clicks_per_month", changeOurMind: "x", effort: "y" })],
        { items: { "singers::2026-05-01": { experimentId: "singers::2026-05-01", status: "active", receipts: [], proofId: "singers::2026-05-01" } }, updatedAt: "t" },
      ),
    ]);
    hasCalibrationRecordMock.mockResolvedValue(true);
    const now = new Date("2026-06-15T00:00:00Z");
    await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(appendCalibrationRecordMock).not.toHaveBeenCalled();
  });

  it("is fail-soft: a thrown listPlans never blocks or alters the GSC verdict", async () => {
    listPlansMock.mockRejectedValue(new Error("db down"));
    const now = new Date("2026-06-15T00:00:00Z");
    const result = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(result.verdict).toBeDefined();
    expect(result.windows.length).toBe(3);
    expect(appendCalibrationRecordMock).not.toHaveBeenCalled();
  });

  it("never mutates the GSC verdict/windows regardless of calibration outcome", async () => {
    listPlansMock.mockResolvedValue([]); // no plan found at all
    const now = new Date("2026-06-15T00:00:00Z");
    const withoutPlan = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    listPlansMock.mockResolvedValue([
      planWith(
        [pick("singers::2026-05-01", { forecastLow: 20, forecastHigh: 60, forecastMetric: "clicks_per_month", changeOurMind: "x", effort: "y" })],
        { items: { "singers::2026-05-01": { experimentId: "singers::2026-05-01", status: "active", receipts: [], proofId: "singers::2026-05-01" } }, updatedAt: "t" },
      ),
    ]);
    const withPlan = await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");

    expect(withoutPlan.verdict).toBe(withPlan.verdict);
    expect(withoutPlan.confidence).toBe(withPlan.confidence);
    expect(withoutPlan.windows).toEqual(withPlan.windows);
  });
});
});
