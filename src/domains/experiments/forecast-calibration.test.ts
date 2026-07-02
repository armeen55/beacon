import { describe, expect, it } from "vitest";
import { summarizeForecastCalibration, findForecastedPickForProofId, MIN_SETTLED_FOR_CALIBRATION } from "./forecast-calibration";
import type { CalibrationRecord } from "./forecast-calibration-store";
import type { DailyExperimentPlanRecord, PlannedExperimentRecord, ExperimentLever } from "./daily-plan-types";
import type { PlanExecutionState } from "./execution-state";

function rec(over: Partial<CalibrationRecord> = {}): CalibrationRecord {
  return {
    pickId: "p1",
    tenantId: "t",
    proofId: "p1::2026-06-01",
    page: "https://s.com/a",
    lever: "meta",
    forecastLow: 20,
    forecastHigh: 60,
    actual: 40,
    outcome: "inside",
    at: "2026-06-29T00:00:00.000Z",
    ...over,
  };
}

describe("summarizeForecastCalibration - matrix (item 27)", () => {
  it("self-hides (null sentence) below MIN_SETTLED_FOR_CALIBRATION (sparse)", () => {
    const s = summarizeForecastCalibration([rec(), rec({ pickId: "p2" })]);
    expect(s.settledCount).toBe(2);
    expect(s.settledCount).toBeLessThan(MIN_SETTLED_FOR_CALIBRATION);
    expect(s.sentence).toBeNull();
    expect(s.correctionFactor).toBe(1); // too thin to correct
  });

  it("cold forecasts (actuals beat the promise): bias > 1, negative hotColdPct, correction grows future ranges", () => {
    const records = [
      rec({ pickId: "p1", forecastLow: 20, forecastHigh: 60, actual: 100, outcome: "above" }),
      rec({ pickId: "p2", forecastLow: 10, forecastHigh: 30, actual: 50, outcome: "above" }),
      rec({ pickId: "p3", forecastLow: 5, forecastHigh: 15, actual: 25, outcome: "above" }),
    ];
    const s = summarizeForecastCalibration(records);
    expect(s.settledCount).toBe(3);
    expect(s.aboveCount).toBe(3);
    expect(s.bias).toBeGreaterThan(1);
    expect(s.hotColdPct).toBeLessThan(0);
    expect(s.correctionFactor).toBeGreaterThan(1);
    expect(s.sentence).toContain("ran about");
    expect(s.sentence).toContain("cold");
  });

  it("hot forecasts (actuals fall short): bias < 1, positive hotColdPct, correction shrinks future ranges", () => {
    const records = [
      rec({ pickId: "p1", forecastLow: 40, forecastHigh: 80, actual: 10, outcome: "below" }),
      rec({ pickId: "p2", forecastLow: 20, forecastHigh: 40, actual: 5, outcome: "below" }),
      rec({ pickId: "p3", forecastLow: 10, forecastHigh: 30, actual: 2, outcome: "below" }),
    ];
    const s = summarizeForecastCalibration(records);
    expect(s.bias).toBeLessThan(1);
    expect(s.hotColdPct).toBeGreaterThan(0);
    expect(s.correctionFactor).toBeLessThan(1);
    expect(s.sentence).toContain("hot");
  });

  it("perfectly calibrated (actual == midpoint every time): bias == 1, hotColdPct == 0, correction == 1", () => {
    const records = [
      rec({ pickId: "p1", forecastLow: 20, forecastHigh: 60, actual: 40, outcome: "inside" }),
      rec({ pickId: "p2", forecastLow: 10, forecastHigh: 30, actual: 20, outcome: "inside" }),
      rec({ pickId: "p3", forecastLow: 0, forecastHigh: 0, actual: 0, outcome: "inside" }),
    ];
    const s = summarizeForecastCalibration(records);
    expect(s.bias).toBe(1);
    expect(s.hotColdPct).toBe(0);
    expect(s.correctionFactor).toBe(1);
    expect(s.sentence).toContain("landed about where we said");
  });

  it("clamps an extreme correction factor to the safe band even with wild history", () => {
    const records = [
      rec({ pickId: "p1", forecastLow: 10, forecastHigh: 10, actual: 1000, outcome: "above" }),
      rec({ pickId: "p2", forecastLow: 10, forecastHigh: 10, actual: 1000, outcome: "above" }),
      rec({ pickId: "p3", forecastLow: 10, forecastHigh: 10, actual: 1000, outcome: "above" }),
    ];
    const s = summarizeForecastCalibration(records);
    expect(s.correctionFactor).toBeLessThanOrEqual(1.3);
  });

  it("names the month + the low/high sums + the measured total in the sentence", () => {
    const records = [
      rec({ pickId: "p1", forecastLow: 100, forecastHigh: 300, actual: 200, outcome: "inside", at: "2026-06-15T00:00:00.000Z" }),
      rec({ pickId: "p2", forecastLow: 100, forecastHigh: 300, actual: 200, outcome: "inside", at: "2026-06-20T00:00:00.000Z" }),
      rec({ pickId: "p3", forecastLow: 200, forecastHigh: 300, actual: 210, outcome: "inside", at: "2026-06-29T00:00:00.000Z" }),
    ];
    const s = summarizeForecastCalibration(records);
    expect(s.sentence).toContain("June");
    expect(s.sentence).toContain("400 to 900");
    expect(s.sentence).toContain("610");
  });

  it("counts inside/above/below correctly across a mixed batch", () => {
    const records = [
      rec({ pickId: "p1", outcome: "inside" }),
      rec({ pickId: "p2", outcome: "above" }),
      rec({ pickId: "p3", outcome: "below" }),
      rec({ pickId: "p4", outcome: "below" }),
    ];
    const s = summarizeForecastCalibration(records);
    expect(s.insideCount).toBe(1);
    expect(s.aboveCount).toBe(1);
    expect(s.belowCount).toBe(2);
    expect(s.insideRate).toBeCloseTo(0.25);
  });

  it("never emits an em or en dash in the sentence (dash guard)", () => {
    const records = [
      rec({ pickId: "p1" }), rec({ pickId: "p2" }), rec({ pickId: "p3" }),
    ];
    const s = summarizeForecastCalibration(records);
    expect(s.sentence ?? "").not.toMatch(/[–—]/);
  });
});

// ── findForecastedPickForProofId ──

function pick(id: string, expectations?: PlannedExperimentRecord["expectations"]): PlannedExperimentRecord {
  return {
    id, candidateId: id, url: `https://s.com${id}`, canonicalUrl: `https://s.com${id}`, pageLabel: id, pageFamily: "f",
    lever: "meta" as ExperimentLever, targetQuery: "q", whyNow: "why", currentText: "old", proposedText: "new",
    placement: "head", leaveUnchanged: [], rollbackText: "old", effortMinutes: 5, risk: "low",
    controls: [], influencedUrls: [], evidenceHash: "e", currentTextHash: "h", eligibilityHash: "g",
    detail: { kind: "meta", source: "p" }, expectations,
  };
}

function planWith(selected: PlannedExperimentRecord[], execution: PlanExecutionState): DailyExperimentPlanRecord {
  return {
    version: 1, id: "t::2026-07-01::abc", tenantId: "t", date: "2026-07-01", status: "accepted",
    createdAt: "t", expiresAt: "t", inputHash: "h", plannerVersion: "v",
    activeExperimentSnapshot: { proofIds: [], treatedUrls: [], controlUrls: [], influencedUrls: [], capturedAt: "t" },
    selected, backups: [], distribution: { byLever: {}, byPageFamily: {} }, estimatedMinutes: 10, execution,
  };
}

describe("findForecastedPickForProofId (item 28 writer lookup)", () => {
  it("finds the pick that activated into the given proofId and carries a numeric forecast", () => {
    const plans = [
      planWith(
        [pick("/a", { forecast: "roughly 20 to 60", forecastLow: 20, forecastHigh: 60, forecastMetric: "clicks_per_month", changeOurMind: "x", effort: "y" })],
        { items: { "/a": { experimentId: "/a", status: "active", receipts: [], proofId: "/a::2026-07-01" } }, updatedAt: "t" },
      ),
    ];
    const found = findForecastedPickForProofId(plans, "/a::2026-07-01");
    expect(found).not.toBeNull();
    expect(found!.pickId).toBe("/a");
    expect(found!.forecastLow).toBe(20);
    expect(found!.forecastHigh).toBe(60);
    expect(found!.lever).toBe("meta");
  });

  it("returns null (honest skip) when the pick has a prose-only forecast (no numeric fields)", () => {
    const plans = [
      planWith(
        [pick("/a", { forecast: "roughly 20 to 60", changeOurMind: "x", effort: "y" })],
        { items: { "/a": { experimentId: "/a", status: "active", receipts: [], proofId: "/a::2026-07-01" } }, updatedAt: "t" },
      ),
    ];
    expect(findForecastedPickForProofId(plans, "/a::2026-07-01")).toBeNull();
  });

  it("returns null when the pick has no expectations at all (legacy record)", () => {
    const plans = [
      planWith(
        [pick("/a")],
        { items: { "/a": { experimentId: "/a", status: "active", receipts: [], proofId: "/a::2026-07-01" } }, updatedAt: "t" },
      ),
    ];
    expect(findForecastedPickForProofId(plans, "/a::2026-07-01")).toBeNull();
  });

  it("returns null when no execution item maps to that proofId", () => {
    const plans = [planWith([pick("/a")], { items: {}, updatedAt: "t" })];
    expect(findForecastedPickForProofId(plans, "/missing")).toBeNull();
  });

  it("searches across multiple plans (most recent listed first is fine, order agnostic here)", () => {
    const plans = [
      planWith([pick("/a")], { items: {}, updatedAt: "t" }),
      planWith(
        [pick("/b", { forecast: "f", forecastLow: 5, forecastHigh: 15, forecastMetric: "clicks_per_month", changeOurMind: "x", effort: "y" })],
        { items: { "/b": { experimentId: "/b", status: "active", receipts: [], proofId: "/b::2026-07-02" } }, updatedAt: "t" },
      ),
    ];
    const found = findForecastedPickForProofId(plans, "/b::2026-07-02");
    expect(found?.pickId).toBe("/b");
  });
});
