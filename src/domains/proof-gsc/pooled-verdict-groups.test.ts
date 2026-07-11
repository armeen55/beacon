import { describe, it, expect } from "vitest";
import { linkLedgerRowsToPlans, groupLedgerRowsByPlanAndLever } from "./pooled-verdict-groups";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord } from "@/domains/experiments/daily-plan-types";
import type { PlanExecutionState } from "@/domains/experiments/execution-state";
import type { ShippedChangeRecord } from "./shipped-change-store";

const ZERO_BASELINE = { clicks: 100, impressions: 2000, ctr: 0.05, position: 8, windowDays: 28 };
const ZERO_WINDOW = { day: 28 as const, checkOn: "2026-07-28", ran: true, treatedDelta: 10, controlDelta: 1, adjustedLift: 9, treatedCtrDelta: 0, controlCtrDelta: 0, adjustedCtrLift: 0, treatedPosDelta: 0, controlPosDelta: 0, adjustedPosLift: 0, controlsUsed: 3 };

function ledgerRow(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: over.id ?? "/a::2026-06-30",
    page: "https://s.com/a",
    path: "/a",
    actionType: "edit_meta",
    before: null,
    after: null,
    shippedAt: "2026-06-30T00:00:00.000Z",
    baseline: ZERO_BASELINE,
    targetQueries: [],
    controlPages: ["https://s.com/ctrl1", "https://s.com/ctrl2", "https://s.com/ctrl3"],
    windows: [ZERO_WINDOW],
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
    operatorVerdictOverride: null, calibrationVersion: null,
    createdAt: "2026-06-30T00:00:00.000Z",
    updatedAt: "2026-07-28T00:00:00.000Z",
    ...over,
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

function planWith(id: string, date: string, picks: string[], proofIdOf: (pickId: string) => string): DailyExperimentPlanRecord {
  const items: PlanExecutionState["items"] = {};
  for (const p of picks) {
    items[p] = { experimentId: p, status: "active", receipts: [], proofId: proofIdOf(p) };
  }
  return {
    version: 1, id, tenantId: "t", date, status: "accepted",
    createdAt: date, expiresAt: date, inputHash: "h", plannerVersion: "v",
    activeExperimentSnapshot: { proofIds: [], treatedUrls: [], controlUrls: [], influencedUrls: [], capturedAt: date },
    selected: picks.map(pick), backups: [], distribution: { byLever: {}, byPageFamily: {} }, estimatedMinutes: 10,
    execution: { items, updatedAt: date },
  };
}

describe("linkLedgerRowsToPlans", () => {
  it("links a ledger row to its plan + pick via execution.items[pickId].proofId", () => {
    const plan = planWith("plan1", "2026-06-30", ["/a"], (p) => `${p}::2026-06-30`);
    const rows = [ledgerRow({ id: "/a::2026-06-30", path: "/a" })];
    const linked = linkLedgerRowsToPlans(rows, [plan]);
    expect(linked).toHaveLength(1);
    expect(linked[0]!.planId).toBe("plan1");
    expect(linked[0]!.pickId).toBe("/a");
    expect(linked[0]!.actionFamily).toBe("meta");
  });

  it("honestly excludes a ledger row with no matching plan/pick (manual or legacy ship)", () => {
    const plan = planWith("plan1", "2026-06-30", ["/a"], (p) => `${p}::2026-06-30`);
    const rows = [ledgerRow({ id: "/manual::2026-06-30", path: "/manual" })];
    const linked = linkLedgerRowsToPlans(rows, [plan]);
    expect(linked).toHaveLength(0);
  });
});

describe("groupLedgerRowsByPlanAndLever", () => {
  it("groups by (planId, actionFamily) and keeps only groups with >= 3 measured pages", () => {
    const plan = planWith("plan1", "2026-06-30", ["/a", "/b", "/c"], (p) => `${p}::2026-06-30`);
    const rows = ["/a", "/b", "/c"].map((path) => ledgerRow({ id: `${path}::2026-06-30`, path }));
    const groups = groupLedgerRowsByPlanAndLever(rows, [plan]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.planId).toBe("plan1");
    expect(groups[0]!.actionFamily).toBe("meta");
    expect(groups[0]!.measuredRows).toHaveLength(3);
  });

  it("refuses a group below the min-3 pooling floor (tiny batch honesty)", () => {
    const plan = planWith("plan1", "2026-06-30", ["/a", "/b"], (p) => `${p}::2026-06-30`);
    const rows = ["/a", "/b"].map((path) => ledgerRow({ id: `${path}::2026-06-30`, path }));
    const groups = groupLedgerRowsByPlanAndLever(rows, [plan]);
    expect(groups).toHaveLength(0);
  });

  it("does not pool a page whose window has not run yet (not truly measured)", () => {
    const plan = planWith("plan1", "2026-06-30", ["/a", "/b", "/c"], (p) => `${p}::2026-06-30`);
    const rows = [
      ledgerRow({ id: "/a::2026-06-30", path: "/a" }),
      ledgerRow({ id: "/b::2026-06-30", path: "/b" }),
      ledgerRow({ id: "/c::2026-06-30", path: "/c", windows: [{ ...ZERO_WINDOW, ran: false }] }),
    ];
    const groups = groupLedgerRowsByPlanAndLever(rows, [plan]);
    expect(groups).toHaveLength(0); // only 2 measured, below the floor
    // but allRows still carries all 3, for an honest "n of m have a read yet" line later
  });

  it("does NOT collapse different action families under the same plan into one group", () => {
    const plan = planWith("plan1", "2026-06-30", ["/a", "/b", "/c"], (p) => `${p}::2026-06-30`);
    const rows = [
      ledgerRow({ id: "/a::2026-06-30", path: "/a", actionType: "edit_meta" }),
      ledgerRow({ id: "/b::2026-06-30", path: "/b", actionType: "edit_meta" }),
      ledgerRow({ id: "/c::2026-06-30", path: "/c", actionType: "edit_title" }),
    ];
    const groups = groupLedgerRowsByPlanAndLever(rows, [plan]);
    expect(groups).toHaveLength(0); // 2 meta + 1 title, neither clears 3 on its own
  });

  it("does NOT collapse the same lever shipped under two different plans into one group", () => {
    const planA = planWith("planA", "2026-06-29", ["/a", "/b", "/c"], (p) => `${p}::planA`);
    const planB = planWith("planB", "2026-06-30", ["/d", "/e", "/f"], (p) => `${p}::planB`);
    const rows = [
      ledgerRow({ id: "/a::planA", path: "/a" }),
      ledgerRow({ id: "/b::planA", path: "/b" }),
      ledgerRow({ id: "/c::planA", path: "/c" }),
      ledgerRow({ id: "/d::planB", path: "/d" }),
      ledgerRow({ id: "/e::planB", path: "/e" }),
      ledgerRow({ id: "/f::planB", path: "/f" }),
    ];
    const groups = groupLedgerRowsByPlanAndLever(rows, [planA, planB]);
    expect(groups).toHaveLength(2);
    expect(new Set(groups.map((g) => g.planId))).toEqual(new Set(["planA", "planB"]));
  });

  it("sorts newest plan date first", () => {
    const planA = planWith("planA", "2026-06-01", ["/a", "/b", "/c"], (p) => `${p}::planA`);
    const planB = planWith("planB", "2026-06-30", ["/d", "/e", "/f"], (p) => `${p}::planB`);
    const rows = [
      ledgerRow({ id: "/a::planA", path: "/a" }),
      ledgerRow({ id: "/b::planA", path: "/b" }),
      ledgerRow({ id: "/c::planA", path: "/c" }),
      ledgerRow({ id: "/d::planB", path: "/d" }),
      ledgerRow({ id: "/e::planB", path: "/e" }),
      ledgerRow({ id: "/f::planB", path: "/f" }),
    ];
    const groups = groupLedgerRowsByPlanAndLever(rows, [planA, planB]);
    expect(groups[0]!.planId).toBe("planB");
    expect(groups[1]!.planId).toBe("planA");
  });
});
