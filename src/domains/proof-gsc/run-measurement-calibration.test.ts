import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Calibration-writer integration contract (BEACON 500 items 27/28): once the day-28 window
 * actually runs inside measureRecord, and the pick that shipped this change carries a numeric
 * forecast, write ONE calibration record - idempotent per pick, and never touching the GSC
 * verdict/windows it rides alongside. Mirrors run-measurement.test.ts's mocking style (module
 * boundary mocks for every I/O dependency).
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

vi.mock("@/domains/serp/serp-history", () => ({
  rankSeriesFor: vi.fn(async () => []),
}));
vi.mock("./rank-recheck", async () => {
  const actual = await vi.importActual<typeof import("./rank-recheck")>("./rank-recheck");
  return { ...actual, runRankRecheck: vi.fn(async () => null) };
});
vi.mock("./aa-calibration-store", () => ({
  readFloorsFor: vi.fn(async () => ({})),
}));

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

import { measureRecord } from "./run-measurement";
import type { ShippedChangeRecord } from "./shipped-change-store";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord, ExperimentLever } from "@/domains/experiments/daily-plan-types";
import type { PlanExecutionState } from "@/domains/experiments/execution-state";

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

  it("a re-measure after day 28 calls hasCalibrationRecord again but stays idempotent", async () => {
    listPlansMock.mockResolvedValue([
      planWith(
        [pick("singers::2026-05-01", { forecastLow: 20, forecastHigh: 60, forecastMetric: "clicks_per_month", changeOurMind: "x", effort: "y" })],
        { items: { "singers::2026-05-01": { experimentId: "singers::2026-05-01", status: "active", receipts: [], proofId: "singers::2026-05-01" } }, updatedAt: "t" },
      ),
    ]);
    const now = new Date("2026-06-15T00:00:00Z");
    await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    hasCalibrationRecordMock.mockResolvedValue(true); // simulate the store now has it
    await measureRecord("tenant-iranopedia", record(), now, "2026-07-01");
    expect(appendCalibrationRecordMock).toHaveBeenCalledTimes(1);
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
