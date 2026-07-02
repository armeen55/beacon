import { describe, expect, it } from "vitest";
import { buildForecastReceiptLine, buildForecastHitRateLine, shouldShowForecastReceipt } from "./forecast-receipts";
import { summarizeForecastCalibration, MIN_SETTLED_FOR_CALIBRATION } from "./forecast-calibration";
import type { CalibrationRecord } from "./forecast-calibration-store";

function rec(over: Partial<CalibrationRecord> = {}): CalibrationRecord {
  return {
    pickId: "p1",
    tenantId: "t",
    proofId: "p1::2026-06-01",
    page: "https://s.com/a",
    lever: "meta",
    forecastLow: 8,
    forecastHigh: 20,
    actual: 14,
    outcome: "inside",
    at: "2026-06-29T00:00:00.000Z",
    ...over,
  };
}

describe("buildForecastReceiptLine (item 42)", () => {
  it("renders the inside phrasing verbatim", () => {
    const line = buildForecastReceiptLine(rec({ forecastLow: 8, forecastHigh: 20, actual: 14, outcome: "inside" }));
    expect(line).toBe("We forecast 8 to 20 extra clicks a month; we got 14. Inside the range.");
  });

  it("renders the above phrasing (better than promised)", () => {
    const line = buildForecastReceiptLine(rec({ forecastLow: 8, forecastHigh: 20, actual: 27, outcome: "above" }));
    expect(line).toBe("We forecast 8 to 20 extra clicks a month; we got 27. Better than promised.");
  });

  it("renders the below phrasing (short of the range, tuning note)", () => {
    const line = buildForecastReceiptLine(rec({ forecastLow: 8, forecastHigh: 20, actual: 3, outcome: "below" }));
    expect(line).toBe(
      "We forecast 8 to 20 extra clicks a month; we got 3. Short of the range, noted and feeding our forecast tuning.",
    );
  });

  it("uses the record's own persisted outcome, never re-derives one from the numbers", () => {
    // actual (14) sits inside [8,20] numerically, but the record says "above" (e.g. a legacy
    // or hand-edited record) - the line must follow the RECORD, not recompute a verdict.
    const line = buildForecastReceiptLine(rec({ forecastLow: 8, forecastHigh: 20, actual: 14, outcome: "above" }));
    expect(line).toContain("Better than promised.");
  });

  it("formats whole-number forecasts and actuals without decimals", () => {
    const line = buildForecastReceiptLine(rec({ forecastLow: 10, forecastHigh: 30, actual: 30, outcome: "inside" }));
    expect(line).toBe("We forecast 10 to 30 extra clicks a month; we got 30. Inside the range.");
  });

  it("keeps one decimal for a non-integer actual", () => {
    const line = buildForecastReceiptLine(rec({ forecastLow: 10, forecastHigh: 30, actual: 22.47, outcome: "inside" }));
    expect(line).toBe("We forecast 10 to 30 extra clicks a month; we got 22.5. Inside the range.");
  });

  it("never emits an em or en dash (dash guard)", () => {
    for (const outcome of ["inside", "above", "below"] as const) {
      const line = buildForecastReceiptLine(rec({ outcome }));
      expect(line).not.toMatch(/[–—]/);
    }
  });
});

describe("buildForecastHitRateLine (item 42)", () => {
  it("is null below MIN_SETTLED_FOR_CALIBRATION (aligned with the aggregate card's threshold)", () => {
    const records = Array.from({ length: MIN_SETTLED_FOR_CALIBRATION - 1 }, (_, i) =>
      rec({ pickId: `p${i}`, outcome: "inside" }),
    );
    expect(buildForecastHitRateLine(records)).toBeNull();
  });

  it("renders the running hit-rate sentence once the threshold is met", () => {
    const records = [
      rec({ pickId: "p1", outcome: "inside" }),
      rec({ pickId: "p2", outcome: "inside" }),
      rec({ pickId: "p3", outcome: "above" }),
    ];
    expect(buildForecastHitRateLine(records)).toBe(
      "Our forecasts have landed inside their promised range 2 of 3 times.",
    );
  });

  it("matches the example shape: 9 of 12", () => {
    const records = [
      ...Array.from({ length: 9 }, (_, i) => rec({ pickId: `in${i}`, outcome: "inside" })),
      ...Array.from({ length: 2 }, (_, i) => rec({ pickId: `ab${i}`, outcome: "above" })),
      rec({ pickId: "bl1", outcome: "below" }),
    ];
    expect(buildForecastHitRateLine(records)).toBe(
      "Our forecasts have landed inside their promised range 9 of 12 times.",
    );
  });

  it("counts zero inside honestly (0 of N) rather than hiding", () => {
    const records = [
      rec({ pickId: "p1", outcome: "above" }),
      rec({ pickId: "p2", outcome: "below" }),
      rec({ pickId: "p3", outcome: "above" }),
    ];
    expect(buildForecastHitRateLine(records)).toBe(
      "Our forecasts have landed inside their promised range 0 of 3 times.",
    );
  });

  it("never emits an em or en dash (dash guard)", () => {
    const records = [rec({ pickId: "p1" }), rec({ pickId: "p2" }), rec({ pickId: "p3" })];
    expect(buildForecastHitRateLine(records) ?? "").not.toMatch(/[–—]/);
  });
});

describe("shouldShowForecastReceipt (item 42 - row wiring gate)", () => {
  it("shows on a mature row with a matching calibration record", () => {
    expect(shouldShowForecastReceipt({ mature: true, calibration: rec() })).toBe(true);
  });

  it("never shows on a measuring/in-flight row, even with a record present", () => {
    // Belt-and-suspenders: a measuring row must never be graded, even if a stray
    // calibration record somehow existed for its id.
    expect(shouldShowForecastReceipt({ mature: false, calibration: rec() })).toBe(false);
  });

  it("stays silent on a mature row with no matching calibration record", () => {
    expect(shouldShowForecastReceipt({ mature: true, calibration: null })).toBe(false);
    expect(shouldShowForecastReceipt({ mature: true, calibration: undefined })).toBe(false);
  });

  it("stays silent when neither condition is met", () => {
    expect(shouldShowForecastReceipt({ mature: false, calibration: null })).toBe(false);
  });
});

describe("threshold alignment with the aggregate card (item 27/28 vs item 42)", () => {
  it("hides both the aggregate card's sentence and the running hit-rate line at the same count", () => {
    const records = Array.from({ length: MIN_SETTLED_FOR_CALIBRATION - 1 }, (_, i) =>
      rec({ pickId: `p${i}` }),
    );
    expect(summarizeForecastCalibration(records).sentence).toBeNull();
    expect(buildForecastHitRateLine(records)).toBeNull();
  });

  it("shows both the aggregate card's sentence and the running hit-rate line at the same count", () => {
    const records = Array.from({ length: MIN_SETTLED_FOR_CALIBRATION }, (_, i) =>
      rec({ pickId: `p${i}` }),
    );
    expect(summarizeForecastCalibration(records).sentence).not.toBeNull();
    expect(buildForecastHitRateLine(records)).not.toBeNull();
  });
});
