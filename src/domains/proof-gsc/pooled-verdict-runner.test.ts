/**
 * pooled-verdict-runner (2026-07-02, master plan item 34) - integration test at the module
 * boundary, mirroring run-measurement-calibration.test.ts's mocking style: every I/O dependency
 * (ledger, plans, daily-clicks read, the store write) is mocked so this pins the GLUE logic
 * (grouping -> per-page derivation -> pooling -> persistence), not the underlying reads.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ShippedChangeRecord } from "./shipped-change-store";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";
import type { PlanExecutionState } from "@/domains/experiments/execution-state";

const ZERO_BASELINE = { clicks: 100, impressions: 2000, ctr: 0.05, position: 8, windowDays: 28 };
function win(adjustedLift: number, ran = true) {
  return { day: 28 as const, checkOn: "2026-07-28", ran, treatedDelta: 10, controlDelta: 1, adjustedLift, treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0, controlsUsed: 3 };
}

function ledgerRow(path: string, adjustedLift: number): ShippedChangeRecord {
  return {
    id: `${path}::2026-06-30`,
    page: `https://s.com${path}`,
    path,
    actionType: "edit_meta",
    before: null,
    after: null,
    shippedAt: "2026-06-30T00:00:00.000Z",
    baseline: ZERO_BASELINE,
    targetQueries: [],
    controlPages: ["https://s.com/ctrl1", "https://s.com/ctrl2", "https://s.com/ctrl3"],
    windows: [win(adjustedLift)],
    verdict: "inconclusive",
    confidence: "low",
    measuredAt: "2026-07-28T00:00:00.000Z",
    trafficOutcome: null,
    citationOutcome: null,
    rankOutcome: null,
    dollarValue: null,
    notes: null,
    verifiedLive: true,
    liveSourceUrl: null,
    recrawlRequestedAt: null,
    operatorVerdictOverride: null,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
  };
}

function pick(id: string): PlannedExperimentRecord {
  return {
    id, candidateId: id, url: `https://s.com${id}`, canonicalUrl: `https://s.com${id}`, pageLabel: id, pageFamily: "f",
    lever: "meta", targetQuery: "q", whyNow: "why", currentText: "old", proposedText: "new",
    placement: "head", leaveUnchanged: [], rollbackText: "old", effortMinutes: 5, risk: "low",
    controls: [], influencedUrls: [], evidenceHash: "e", currentTextHash: "h", eligibilityHash: "g",
    detail: { kind: "meta", source: "p" },
  };
}

function planWith(paths: string[]): DailyExperimentPlanRecord {
  const items: PlanExecutionState["items"] = {};
  for (const p of paths) items[p] = { experimentId: p, status: "active", receipts: [], proofId: `${p}::2026-06-30` };
  return {
    version: 1, id: "plan1", tenantId: "tenant-a", date: "2026-06-30", status: "accepted",
    createdAt: "2026-06-30T00:00:00.000Z", expiresAt: "2026-07-07T00:00:00.000Z", inputHash: "h", plannerVersion: "v",
    activeExperimentSnapshot: { proofIds: [], treatedUrls: [], controlUrls: [], influencedUrls: [], capturedAt: "2026-06-30T00:00:00.000Z" },
    selected: paths.map(pick), backups: [], distribution: { byLever: {}, byPageFamily: {} }, estimatedMinutes: 10,
    execution: { items, updatedAt: "2026-06-30T00:00:00.000Z" },
  };
}

const upsertMock = vi.fn(async (_row: unknown) => {});
vi.mock("./pooled-verdict-store", () => ({
  upsertPooledVerdict: (row: unknown) => upsertMock(row),
}));

let records: ShippedChangeRecord[] = [];
let plans: DailyExperimentPlanRecord[] = [];
vi.mock("./shipped-change-store", () => ({
  loadShippedChanges: async () => records,
}));
vi.mock("@/domains/experiments/daily-experiment-plan-store", () => ({
  listPlans: async () => plans,
}));

const quietSeries = (clicks: number) =>
  Array.from({ length: 20 }, (_, i) => ({ date: `2026-06-${String(i + 1).padStart(2, "0")}`, clicks }));

vi.mock("./daily-series", () => ({
  loadDailyClicksByPathsForTenant: async (_t: string, paths: string[]) => {
    const m = new Map<string, { date: string; clicks: number }[]>();
    for (const p of paths) m.set(p, quietSeries(10));
    return m;
  },
}));

import { computePooledVerdicts } from "./pooled-verdict-runner";

beforeEach(() => {
  upsertMock.mockClear();
  records = [];
  plans = [];
});

describe("computePooledVerdicts", () => {
  it("returns a zeroed result when no batch qualifies", async () => {
    records = [ledgerRow("/a", 10)];
    plans = [planWith(["/a"])]; // only 1 page, below the pooling floor
    const result = await computePooledVerdicts("tenant-a");
    expect(result.groupsConsidered).toBe(0);
    expect(result.groupsPooled).toBe(0);
    expect(upsertMock).not.toHaveBeenCalled();
  });

  it("pools a qualifying batch and persists exactly one row", async () => {
    const paths = ["/a", "/b", "/c", "/d", "/e", "/f"];
    records = paths.map((p) => ledgerRow(p, 8 + Math.random() * 0)); // consistent lift
    plans = [planWith(paths)];
    const result = await computePooledVerdicts("tenant-a");
    expect(result.groupsConsidered).toBe(1);
    expect(result.groupsPooled).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    const row = upsertMock.mock.calls[0]![0] as { tenant_id: string; plan_id: string; verdict: string; n: number };
    expect(row.tenant_id).toBe("tenant-a");
    expect(row.plan_id).toBe("plan1");
    expect(row.n).toBe(6);
  });

  it("is idempotent: running twice on the same input persists the same row twice (overwrite, not duplicate)", async () => {
    const paths = ["/a", "/b", "/c", "/d"];
    records = paths.map((p) => ledgerRow(p, 8));
    plans = [planWith(paths)];
    const first = await computePooledVerdicts("tenant-a");
    const second = await computePooledVerdicts("tenant-a");
    expect(first.groupsPooled).toBe(1);
    expect(second.groupsPooled).toBe(1);
    expect(upsertMock).toHaveBeenCalledTimes(2);
    const rowA = upsertMock.mock.calls[0]![0] as { pooled_lift_pct: number };
    const rowB = upsertMock.mock.calls[1]![0] as { pooled_lift_pct: number };
    expect(rowA.pooled_lift_pct).toBe(rowB.pooled_lift_pct); // deterministic, byte-identical recompute
  });

  it("never mutates the ledger records it read (computed-only posture)", async () => {
    const paths = ["/a", "/b", "/c"];
    records = paths.map((p) => ledgerRow(p, 8));
    const snapshot = JSON.parse(JSON.stringify(records));
    plans = [planWith(paths)];
    await computePooledVerdicts("tenant-a");
    expect(records).toEqual(snapshot);
  });

  it("fails soft (never throws) when the ledger load itself throws", async () => {
    vi.doMock("./shipped-change-store", () => ({
      loadShippedChanges: async () => {
        throw new Error("boom");
      },
    }));
    const { computePooledVerdicts: freshRunner } = await import("./pooled-verdict-runner");
    await expect(freshRunner("tenant-a")).resolves.toEqual({
      groupsConsidered: 0,
      groupsPooled: 0,
      groupsSkipped: 0,
    });
  });
});
