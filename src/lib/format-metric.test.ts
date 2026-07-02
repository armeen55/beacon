import { describe, expect, it } from "vitest";
import { formatDeltaPct, formatMetric, formatMetricCompact } from "./format-metric";

describe("format-metric (item 18)", () => {
  it("formats full numbers with separators, safe on junk", () => {
    expect(formatMetric(26569)).toBe("26,569");
    expect(formatMetric(0)).toBe("0");
    expect(formatMetric(null)).toBe("");
    expect(formatMetric(NaN)).toBe("");
  });

  it("compacts for chips: 26.5k over 26,569", () => {
    expect(formatMetricCompact(999)).toBe("999");
    expect(formatMetricCompact(26569)).toBe("26.5k");
    expect(formatMetricCompact(2650)).toBe("2.6k");
    expect(formatMetricCompact(4000)).toBe("4k");
    expect(formatMetricCompact(1_240_000)).toBe("1.2m");
    expect(formatMetricCompact(135_000)).toBe("135k");
    expect(formatMetricCompact(-2650)).toBe("-2.6k");
    expect(formatMetricCompact(null)).toBe("");
  });

  it("signs delta percents", () => {
    expect(formatDeltaPct(9.4)).toBe("+9%");
    expect(formatDeltaPct(-3)).toBe("-3%");
    expect(formatDeltaPct(0)).toBe("0%");
    expect(formatDeltaPct(null)).toBe("");
  });
});
