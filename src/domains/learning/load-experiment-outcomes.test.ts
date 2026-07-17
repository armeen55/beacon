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

import {
  loadExperimentOutcomes,
  loadEffectObservations,
  loadProofOutcomeRows,
  loadTitleSignalObservations,
  loadRetrainedTitleWeights,
} from "./load-experiment-outcomes";
import { BASE_TITLE_SIGNAL_WEIGHTS } from "@/domains/demand-graph/ctr-title-scorer";
import type { ShippedChangeRecord } from "@/domains/proof-gsc/shipped-change-store";
import type { Changepoint } from "@/domains/proof-gsc/changepoint";
import {
  TEST_CALIBRATED_VERSION,
  registerTestCalibratedVersion,
  clearTestCalibratedVersions,
} from "@/domains/proof-gsc/verdict-calibration-test-support";

// Fail-closed calibration quarantine (2026-07-11): the existing cases below all
// use CALIBRATED records (via the factory default), so they pin that a calibrated
// verdict flows through maturityGatedVerdict exactly as it always did. The
// dedicated "uncalibrated" block at the end pins the quarantine (neutralized to
// measuring). afterAll restores the empty production registry.
import { beforeAll, afterAll } from "vitest";
beforeAll(registerTestCalibratedVersion);
afterAll(clearTestCalibratedVersions);

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
    calibrationVersion: TEST_CALIBRATED_VERSION,
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

/**
 * R5 / N15 (2026-07-03) - the effect-size loader shares the IDENTICAL
 * maturity/weather/parallel-trends gate as the win-rate loader above, then
 * additionally requires a decided verdict AND an honest relative magnitude.
 */
describe("loadEffectObservations - decided magnitudes only, same gate as the win-rate prior", () => {
  it("maps a mature decided win into a clamped relative-clicks observation with the shared dims", async () => {
    // baseline 10 clicks / 28d, day-28 adjustedLift 35 -> raw +350%, clamped to +100%.
    ledger = [record()];
    const out = await loadEffectObservations("iranopedia");
    expect(out).toHaveLength(1);
    expect(out[0]!.relativeLift).toBe(1);
    expect(out[0]!.leverFamily).toBe("edit_page"); // canonicalMoveType("edit_title")
    expect(out[0]!.pageType).toBe("singers");
    expect(out[0]!.settledAt).toBe("2026-05-19T00:00:00.000Z");
  });

  it("skips a non-decided (measuring) row - a 7-day read can never train a magnitude", async () => {
    ledger = [record({ verdict: "measuring", windows: [win28({ ran: false })] })];
    expect(await loadEffectObservations("iranopedia")).toHaveLength(0);
  });

  it("skips an operator-excluded row (pinned inconclusive)", async () => {
    ledger = [record({ operatorVerdictOverride: "inconclusive" })];
    expect(await loadEffectObservations("iranopedia")).toHaveLength(0);
  });

  it("skips a decided row whose baseline clicks are too thin for an honest percent", async () => {
    ledger = [record({ baseline: { clicks: 1, impressions: 5000, ctr: 0.001, position: 8, windowDays: 28 } })];
    expect(await loadEffectObservations("iranopedia")).toHaveLength(0);
  });

  it("applies the SAME weather quarantine as the win-rate loader (shock -> no magnitude)", async () => {
    ledger = [record()];
    jsonStoreRows["algorithm-weather-shocks"] = [shockRow("iranopedia", [{ date: "2026-05-01", direction: "up", magnitude: 0.6 }])];
    expect(await loadEffectObservations("iranopedia")).toHaveLength(0);
  });

  it("applies the SAME parallel-trends veto (controlMatchWeak -> no magnitude)", async () => {
    ledger = [record({ controlMatchWeak: true })];
    expect(await loadEffectObservations("iranopedia")).toHaveLength(0);
  });

  it("a decided LOSS trains a negative magnitude (misses owned plainly)", async () => {
    ledger = [record({ verdict: "lost", windows: [win28({ adjustedLift: -5, treatedDelta: -3 })] })];
    const out = await loadEffectObservations("iranopedia");
    expect(out).toHaveLength(1);
    expect(out[0]!.relativeLift).toBeCloseTo(-0.5, 10); // -5 over a 10-click scaled baseline
  });
});

describe("loadTitleSignalObservations / loadRetrainedTitleWeights - R9 title retrain edge", () => {
  it("maps a DECIDED title record with shipped text into the scorer's own signals + a clamped lift", async () => {
    ledger = [record({ after: "10 Best Iranian Singers (Ranked)" })];
    const out = await loadTitleSignalObservations("iranopedia");
    expect(out).toHaveLength(1);
    expect(out[0]!.signals).toContain("number");
    expect(out[0]!.signals).toContain("parenthetical");
    expect(out[0]!.relativeLift).toBe(1); // 35 lift over a 10-click scaled baseline, clamped
    expect(out[0]!.settledAt).toBe("2026-05-19T00:00:00.000Z");
  });

  it("skips non-title rows, rows without shipped text, and undecided rows", async () => {
    ledger = [
      record({ id: "m1::2026-04-20", actionType: "edit_meta" }),
      record({ id: "m2::2026-04-20", after: null }),
      record({ id: "m3::2026-04-20", verdict: "measuring", windows: [win28({ ran: false })] }),
      record({ id: "m4::2026-04-20", operatorVerdictOverride: "inconclusive" }),
    ];
    expect(await loadTitleSignalObservations("iranopedia")).toHaveLength(0);
  });

  it("loadRetrainedTitleWeights self-neutralizes to the untouched base constants on a thin ledger", async () => {
    ledger = [record({ after: "10 Best Iranian Singers (Ranked)" })]; // 1 test < MIN_TILT_SAMPLES
    const weights = await loadRetrainedTitleWeights("iranopedia");
    expect(weights).toBe(BASE_TITLE_SIGNAL_WEIGHTS);
  });
});

describe("fail-closed calibration quarantine (2026-07-11)", () => {
  it("neutralizes an UNCALIBRATED mature won to measuring - it trains no win-rate prior", async () => {
    ledger = [record({ calibrationVersion: null })]; // otherwise a clean, mature, decided win
    const outcomes = await loadExperimentOutcomes("iranopedia");
    // The row still appears (so counts stay honest) but its decided verdict is stripped.
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.verdict).toBe("measuring");
  });

  it("excludes an UNCALIBRATED decided row from effect-size magnitudes (decided-only gate)", async () => {
    ledger = [record({ calibrationVersion: null })];
    expect(await loadEffectObservations("iranopedia")).toHaveLength(0);
  });

  it("excludes an UNCALIBRATED decided title row from title-signal retraining", async () => {
    ledger = [record({ calibrationVersion: null, after: "10 Best Iranian Singers (Ranked)" })];
    expect(await loadTitleSignalObservations("iranopedia")).toHaveLength(0);
  });

  it("downgrades an UNCALIBRATED mature row's page-caution confidence to low (reads as measuring)", async () => {
    ledger = [record({ calibrationVersion: null })];
    const rows = await loadProofOutcomeRows("iranopedia");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe("measuring");
    expect(rows[0]!.confidence).toBe("low");
  });
});

describe("compound action learning boundary", () => {
  it("does not credit either individual lever when same-page edits shipped as one package", async () => {
    ledger = [
      record({ id: "title", actionType: "edit_title" }),
      record({ id: "answer", actionType: "add_answer_block" }),
    ];
    const outcomes = await loadExperimentOutcomes("iranopedia");
    expect(outcomes).toHaveLength(2);
    expect(outcomes.every((outcome) => outcome.verdict === "measuring")).toBe(true);
  });
});
