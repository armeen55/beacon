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

const { rankRecheckMock } = vi.hoisted(() => ({ rankRecheckMock: vi.fn() }));

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
