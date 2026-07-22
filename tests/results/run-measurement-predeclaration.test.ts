import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Predeclaration contract wiring (Lane P2, protocol Section 4.1):
 *   - recordShippedChange STAMPS the block once at ship (judgedMetric from
 *     actionType, expectedDirection, primaryWindowDays 28, the default window
 *     plan, a ship-time baseline snapshot, predeclaredAt), and measureRecord
 *     preserves it immutably.
 *   - measureRecord READS the stored judgedMetric when predeclaredAt is set and
 *     never recomputes it via pickProofMetric.
 *   - a legacy record (no predeclaredAt) keeps the pickProofMetric path unchanged.
 *
 * I/O modules are mocked at their boundaries the way run-measurement.test.ts
 * does. pickProofMetric is wrapped in a spy (real impl underneath) so we can
 * assert it is / is not consulted; the "position -> no Bayesian read" rule is a
 * second, independent observable of which metric measureRecord actually used.
 */

const gscWindow = { clicks: 100, impressions: 1000, ctr: 0.1, position: 8 };
const confirmationReadMock = vi.hoisted(() => vi.fn(async (_input: { windowDays: number; tenantId: string }) => {}));
const loadConfirmationReadsMock = vi.hoisted(() => vi.fn(async () => [] as Array<{
  windowDays: number;
  computationVersion: string;
  result: Record<string, unknown>;
}>));

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
vi.mock("@/domains/serp/serp-history", () => ({
  rankSeriesFor: vi.fn(async () => []),
}));
vi.mock("@/domains/proof-gsc/rank-recheck", async () => {
  const actual = await vi.importActual<typeof import("@/domains/proof-gsc/rank-recheck")>("@/domains/proof-gsc/rank-recheck");
  return { ...actual, runRankRecheck: vi.fn(async () => null) };
});
vi.mock("@/domains/proof-gsc/aa-calibration-store", () => ({ readFloorsFor: vi.fn(async () => ({})) }));
vi.mock("@/domains/proof-gsc/daily-series", () => ({
  loadDailyClicksByPathsForTenant: vi.fn(async () => new Map()),
}));
vi.mock("@/domains/proof-gsc/algorithm-weather-store", () => ({ loadDetectedChangepoints: vi.fn(async () => []) }));
vi.mock("@/domains/proof-gsc/confirmation-reads-store", () => ({
  loadConfirmationReads: loadConfirmationReadsMock,
  recordConfirmationRead: confirmationReadMock,
}));

// Wrap pickProofMetric in a spy over the REAL implementation so we can assert
// whether measureRecord consulted it (legacy path) or read the stored metric.
const pickSpy = vi.hoisted(() => vi.fn());
vi.mock("@/domains/proof-gsc/measure", async () => {
  const actual = await vi.importActual<typeof import("@/domains/proof-gsc/measure")>("@/domains/proof-gsc/measure");
  pickSpy.mockImplementation(actual.pickProofMetric);
  return { ...actual, pickProofMetric: pickSpy };
});

import { measureRecord, recordShippedChange } from "@/domains/proof-gsc/run-measurement";
import { DEFAULT_WINDOW_PLAN } from "@/domains/proof-gsc/window-role";
import { CONFIRMATION_COMPUTATION_VERSION } from "@/domains/proof-gsc/confirmation-read";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";

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
    calibrationVersion: null,
    createdAt: "2026-05-01T00:00:00Z",
    updatedAt: "2026-05-01T00:00:00Z",
    ...overrides,
  };
}

const NOW = new Date("2026-05-09T00:00:00.000Z");

beforeEach(() => {
  pickSpy.mockClear();
  confirmationReadMock.mockClear();
  loadConfirmationReadsMock.mockReset();
  loadConfirmationReadsMock.mockResolvedValue([]);
});

describe("recordShippedChange - ship-time predeclaration stamping (protocol 4.1)", () => {
  it("stamps the full predeclaration block once at ship", async () => {
    const shipNow = new Date("2026-05-01T00:00:00.000Z");
    const rec = await recordShippedChange({
      tenantId: "tenant-iranopedia",
      page: "https://iranopedia.com/singers",
      path: "/singers",
      actionType: "edit_title", // pickProofMetric -> ctr
      before: "old",
      after: "new",
      targetQueries: ["persian singers"],
      controlPages: [],
      shippedAt: "2026-05-01",
      now: shipNow,
    });

    expect(rec.judgedMetric).toBe("ctr");
    expect(rec.expectedDirection).toBe(1);
    expect(rec.primaryWindowDays).toBe(28);
    expect(rec.windowPlan).toEqual([...DEFAULT_WINDOW_PLAN]);
    expect(rec.predeclaredAt).toBe("2026-05-01T00:00:00.000Z");
    // C4 matched-control selection is Lane P3 -> null now, round-trip ready.
    expect(rec.controlSetIds).toBeNull();
    expect(rec.controlAlternates).toBeNull();
    expect(rec.classifierVersionPredeclared).toBeNull();
    // Baseline snapshot from the ship-time pre window (the mocked GSC reading).
    expect(rec.baselineSnapshot).toEqual({
      clicks: 100,
      impressions: 1000,
      ctr: 0.1,
      position: 8,
      windowDays: 28,
      trafficTier: "medium",
    });
  });

  it("stamps expectedDirection -1 for a consolidation (donor page loses traffic on purpose)", async () => {
    const rec = await recordShippedChange({
      tenantId: "tenant-iranopedia",
      page: "https://iranopedia.com/singers",
      path: "/singers",
      actionType: "consolidate",
      before: "old",
      after: "new",
      targetQueries: [],
      controlPages: [],
      shippedAt: "2026-05-01",
      now: new Date("2026-05-01T00:00:00.000Z"),
    });
    expect(rec.expectedDirection).toBe(-1);
    expect(rec.judgedMetric).toBe("clicks"); // consolidation is not a CTR/position lever
  });

  // Trust-audit fix (2026-07-18): the production Iranopedia rows all carry a NULL
  // predeclaredAt / windowPlan (shipped before this contract landed), which is
  // what the /results legacy-measurement caveat keys on. This pins the opposite
  // invariant for a NEW ship: every live ship path funnels through
  // recordShippedChange, so a change shipped today is ALWAYS predeclared (a
  // non-null predeclaredAt and a populated windowPlan) and would never show that
  // caveat. If this ever regresses, new ships would silently look "legacy".
  it("a fresh ship is always predeclared (non-null predeclaredAt + populated windowPlan)", async () => {
    for (const actionType of ["edit_title", "edit_meta", "add_answer_block", "add_schema"]) {
      const rec = await recordShippedChange({
        tenantId: "tenant-iranopedia",
        page: "https://iranopedia.com/singers",
        path: "/singers",
        actionType,
        before: "old",
        after: "new",
        targetQueries: [],
        controlPages: [],
        shippedAt: "2026-05-01",
        now: new Date("2026-05-01T00:00:00.000Z"),
      });
      expect(rec.predeclaredAt).not.toBeNull();
      expect(rec.predeclaredAt).toBeTruthy();
      expect((rec.windowPlan ?? []).length).toBeGreaterThan(0);
      expect(rec.judgedMetric).not.toBeNull();
      expect(rec.expectedDirection == null).toBe(false);
    }
  });
});

describe("measureRecord - reads the STORED judged metric when predeclared", () => {
  it("uses the stored judgedMetric and NEVER recomputes via pickProofMetric", async () => {
    // Stored metric is "position" but the actionType (edit_title) would map to
    // "ctr". If measureRecord read the stored value, the change is judged on
    // position -> NO Bayesian read (buildBayesianRead returns null for position).
    const predeclared = record({
      actionType: "edit_title",
      judgedMetric: "position",
      predeclaredAt: "2026-05-01T00:00:00.000Z",
      primaryWindowDays: 28,
      windowPlan: [...DEFAULT_WINDOW_PLAN],
    });

    const out = await measureRecord("tenant-iranopedia", predeclared, NOW, "2026-07-01");

    expect(out.bayesianRead).toBeNull(); // judged on the STORED "position" metric
    expect(pickSpy).not.toHaveBeenCalled(); // never recomputed
    // The predeclaration block is preserved immutably through the measure.
    expect(out.judgedMetric).toBe("position");
    expect(out.predeclaredAt).toBe("2026-05-01T00:00:00.000Z");
    expect(out.windowPlan).toEqual([...DEFAULT_WINDOW_PLAN]);
    expect(out.windows.map((window) => window.day)).toEqual([7, 14, 28]);
    expect(confirmationReadMock.mock.calls.map(([input]) => input.windowDays)).toEqual([7, 14, 28, 56]);
    expect(confirmationReadMock.mock.calls.every(([input]) => input.tenantId === "tenant-iranopedia")).toBe(true);
  });

  it("reuses first-written confirmation reads without duplicate writes", async () => {
    loadConfirmationReadsMock.mockResolvedValue(
      [7, 14, 28, 56].map((windowDays) => ({
        windowDays,
        computationVersion: CONFIRMATION_COMPUTATION_VERSION,
        result: { readVerdict: "inconclusive" },
      })),
    );
    const predeclared = record({
      judgedMetric: "ctr",
      predeclaredAt: "2026-05-01T00:00:00.000Z",
      windowPlan: [...DEFAULT_WINDOW_PLAN],
    });

    const out = await measureRecord("tenant-iranopedia", predeclared, NOW, "2026-07-01");

    expect(out.windows.map((window) => window.day)).toEqual([7, 14, 28]);
    expect(confirmationReadMock).not.toHaveBeenCalled();
  });

  it("records the predeclared 84-day context read once it closes", async () => {
    const predeclared = record({
      judgedMetric: "ctr",
      predeclaredAt: "2026-05-01T00:00:00.000Z",
      windowPlan: [...DEFAULT_WINDOW_PLAN],
    });

    await measureRecord(
      "tenant-iranopedia",
      predeclared,
      new Date("2026-08-01T00:00:00.000Z"),
      "2026-08-01",
    );

    expect(confirmationReadMock.mock.calls.map(([input]) => input.windowDays)).toEqual([7, 14, 28, 56, 84]);
  });
});

describe("measureRecord - legacy path (no predeclaredAt) unchanged", () => {
  it("falls back to pickProofMetric for a record with no predeclaration", async () => {
    const legacy = record({ actionType: "edit_title" }); // predeclaredAt undefined

    const out = await measureRecord("tenant-iranopedia", legacy, NOW, "2026-07-01");

    // edit_title -> pickProofMetric = "ctr", which HAS a Bayesian read.
    expect(pickSpy).toHaveBeenCalledWith("edit_title");
    expect(out.bayesianRead).not.toBeNull();
  });

  it("a predeclared ctr metric produces the SAME verdict/windows as the legacy ctr path", async () => {
    const legacy = record({ actionType: "edit_title" });
    const predeclaredSameMetric = record({
      actionType: "edit_title",
      judgedMetric: "ctr", // equals what pickProofMetric would choose
      predeclaredAt: "2026-05-01T00:00:00.000Z",
    });

    const a = await measureRecord("tenant-iranopedia", legacy, NOW, "2026-07-01");
    const b = await measureRecord("tenant-iranopedia", predeclaredSameMetric, NOW, "2026-07-01");

    expect(b.verdict).toBe(a.verdict);
    expect(b.confidence).toBe(a.confidence);
    expect(b.windows).toEqual(a.windows);
  });
});
