/**
 * load-experiment-outcomes (2026-07-02, master plan item 32 - algorithm-weather
 * guard) - pins the ADDITIVE prior/lesson exclusion gate: a mature, cleanly-
 * attributed verdict whose measurement window overlapped a detected sitewide
 * shock must read as "measuring" (never trains the prior), the same way an
 * early or accidentally-overlapping read already does. Without a shock, the
 * gate's output is byte-identical to its pre-item-32 behavior.
 *
 * Mocking discipline mirrors winner-memory.test.ts: json-store + shipped-
 * change-store are mocked; the real (pure) measurement-maturity / algorithm-
 * weather modules run unmocked so the gate logic itself is exercised end to end.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

let jsonStoreRows: Record<string, unknown[]> = {};
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async (name: string) => jsonStoreRows[name] ?? [],
  writeStore: async (name: string, data: unknown[]) => {
    jsonStoreRows[name] = data;
  },
}));

let ledger: Array<Record<string, unknown>> = [];
vi.mock("@/domains/proof-gsc/shipped-change-store", () => ({
  loadShippedChanges: async () => ledger,
}));

import { loadExperimentOutcomes, loadProofOutcomeRows } from "./load-experiment-outcomes";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { Changepoint } from "@/domains/proof-gsc/changepoint";

function win28(over: Partial<ShippedChangeRecord["windows"][number]> = {}): ShippedChangeRecord["windows"][number] {
  return {
    day: 28,
    checkOn: "2026-05-18",
    ran: true,
    treatedDelta: 40,
    controlDelta: 5,
    adjustedLift: 35,
    treatedCtrDelta: 0.03,
    controlCtrDelta: 0.002,
    adjustedCtrLift: 0.028,
    treatedPosDelta: 1,
    controlPosDelta: 0,
    adjustedPosLift: 1,
    controlsUsed: 3,
    ...over,
  };
}

/**
 * Ship/checkOn dates sit April 20 -> May 18, 2026: a real gap between the
 * confirmed March core update (ends Apr 8) and the confirmed May core update
 * (starts May 21) in google-updates.ts, so these fixtures exercise ONLY the
 * detected-changepoint half of the guard, not the seeded confirmed-update list.
 */
function record(over: Partial<ShippedChangeRecord> = {}): ShippedChangeRecord {
  return {
    id: "p1::2026-04-20",
    page: "https://iranopedia.com/singers",
    path: "/singers",
    actionType: "edit_title",
    before: "Iranian Singers",
    after: "Top Iranian Singers",
    shippedAt: "2026-04-20T00:00:00.000Z",
    baseline: { clicks: 10, impressions: 5000, ctr: 0.01, position: 8, windowDays: 28 },
    targetQueries: ["iranian singers"],
    controlPages: ["https://iranopedia.com/actors", "https://iranopedia.com/comedians", "https://iranopedia.com/poets"],
    windows: [win28()],
    verdict: "won",
    confidence: "high",
    measuredAt: "2026-05-19T00:00:00.000Z",
    operatorVerdictOverride: null,
    ...over,
  } as ShippedChangeRecord;
}

function shockRow(tenantId: string, changepoints: Changepoint[]) {
  return {
    tenant_id: tenantId,
    computed_at: "2026-07-01T00:00:00.000Z",
    anchor_date: "2026-06-30",
    clicksChangepoints: changepoints,
    impressionsChangepoints: [],
  };
}

beforeEach(() => {
  jsonStoreRows = {};
  ledger = [];
});

describe("loadExperimentOutcomes - no shock history (pre-item-32 behavior unchanged)", () => {
  it("a mature, clean, decided record keeps its real verdict when no shocks are on record", async () => {
    ledger = [record()];
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out).toHaveLength(1);
    expect(out[0]!.verdict).toBe("won");
  });
});

describe("loadExperimentOutcomes - algorithm-weather guard excludes a shock-overlapped mature verdict", () => {
  it("neutralizes a mature win to measuring when its window overlapped a detected shock", async () => {
    ledger = [record()]; // ship 2026-04-20, checkOn 2026-05-18
    // A CUSUM changepoint landing inside the ship->checkOn window.
    jsonStoreRows["algorithm-weather-shocks"] = [shockRow("iranopedia", [{ date: "2026-05-01", direction: "up", magnitude: 0.6 }])];
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out[0]!.verdict).toBe("measuring");
  });

  it("does NOT exclude a mature verdict whose window sits entirely outside the detected shock", async () => {
    ledger = [record()]; // ship 2026-04-20, checkOn 2026-05-18
    // A changepoint two months later - nowhere near this record's window.
    jsonStoreRows["algorithm-weather-shocks"] = [shockRow("iranopedia", [{ date: "2026-08-15", direction: "down", magnitude: 0.5 }])];
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out[0]!.verdict).toBe("won");
  });

  it("is scoped per tenant - another tenant's shock never quarantines this tenant's verdict", async () => {
    ledger = [record()];
    jsonStoreRows["algorithm-weather-shocks"] = [shockRow("some-other-tenant", [{ date: "2026-05-01", direction: "up", magnitude: 0.6 }])];
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out[0]!.verdict).toBe("won");
  });

  it("a store read failure fails soft to the un-quarantined verdict (never crashes the loader)", async () => {
    ledger = [record()];
    jsonStoreRows = undefined as unknown as Record<string, unknown[]>; // force the mocked readStore to throw on property access
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out).toHaveLength(1);
    expect(out[0]!.verdict).toBe("won");
  });
});

describe("loadProofOutcomeRows - same additive gate on the page-caution read path", () => {
  it("downgrades confidence to low and neutralizes the verdict when weather-quarantined", async () => {
    ledger = [record({ confidence: "high" })];
    jsonStoreRows["algorithm-weather-shocks"] = [shockRow("iranopedia", [{ date: "2026-05-01", direction: "up", magnitude: 0.6 }])];
    const out = await loadProofOutcomeRows("iranopedia");
    expect(out[0]!.verdict).toBe("measuring");
    expect(out[0]!.confidence).toBe("low");
  });

  it("keeps the real confidence when no shock overlaps", async () => {
    ledger = [record({ confidence: "high" })];
    const out = await loadProofOutcomeRows("iranopedia");
    expect(out[0]!.verdict).toBe("won");
    expect(out[0]!.confidence).toBe("high");
  });
});

/**
 * Parallel-trends veto (master plan item 33) - the SAME additive exclusion
 * pattern as the algorithm-weather guard above, gated on
 * ShippedChangeRecord.controlMatchWeak (set once at selection time by
 * auto-record-on-ship.ts's matcher when it had to fall back to its
 * best-available comparison pages). Without the flag, output is byte-
 * identical to pre-item-33 behavior.
 */
describe("loadExperimentOutcomes - parallel-trends veto excludes a weak-comparison mature verdict", () => {
  it("neutralizes a mature win to measuring when controlMatchWeak is true", async () => {
    ledger = [record({ controlMatchWeak: true })];
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out[0]!.verdict).toBe("measuring");
  });

  it("does NOT exclude a mature verdict when controlMatchWeak is false", async () => {
    ledger = [record({ controlMatchWeak: false })];
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out[0]!.verdict).toBe("won");
  });

  it("does NOT exclude a mature verdict when controlMatchWeak is undefined (rows that predate item 33)", async () => {
    ledger = [record()]; // no controlMatchWeak field at all
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out[0]!.verdict).toBe("won");
  });

  it("composes with the weather guard - either condition alone is enough to neutralize", async () => {
    ledger = [record({ controlMatchWeak: true })];
    // No shock on record at all - the weak-comparison flag alone still fires.
    const out = await loadExperimentOutcomes("iranopedia");
    expect(out[0]!.verdict).toBe("measuring");
  });
});

describe("loadProofOutcomeRows - parallel-trends veto on the page-caution read path", () => {
  it("downgrades confidence to low and neutralizes the verdict when controlMatchWeak is true", async () => {
    ledger = [record({ confidence: "high", controlMatchWeak: true })];
    const out = await loadProofOutcomeRows("iranopedia");
    expect(out[0]!.verdict).toBe("measuring");
    expect(out[0]!.confidence).toBe("low");
  });

  it("keeps the real confidence when controlMatchWeak is false", async () => {
    ledger = [record({ confidence: "high", controlMatchWeak: false })];
    const out = await loadProofOutcomeRows("iranopedia");
    expect(out[0]!.verdict).toBe("won");
    expect(out[0]!.confidence).toBe("high");
  });
});
