import { describe, it, expect } from "vitest";
import {
  deriveCoverageState,
  coverageWarningLine,
  coverageStateDisplayLabel,
  coverageAttentionForFindings,
  COVERAGE_STALE_DAY_THRESHOLD,
} from "@/lib/coverage-state";

describe("deriveCoverageState", () => {
  it("returns fresh when all signals are healthy", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 1,
        visibilityStaleVsCrawl: false,
        sampleQualityTier: "strong",
      }),
    ).toBe("fresh");
  });

  it("returns fresh with no inputs (defaults)", () => {
    expect(deriveCoverageState({})).toBe("fresh");
  });

  it("returns partial when sample quality is limited (highest precedence)", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 10,
        visibilityStaleVsCrawl: true,
        sampleQualityTier: "limited",
      }),
    ).toBe("partial");
  });

  it("returns aging when crawl age is in (0.7*T, T] — day 3 at T=3", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 3,
        visibilityStaleVsCrawl: false,
        sampleQualityTier: "strong",
      }),
    ).toBe("aging");
  });

  it("returns fresh at exact lower bound: day 2 not aging", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 2,
        visibilityStaleVsCrawl: false,
        sampleQualityTier: "moderate",
      }),
    ).toBe("fresh");
  });

  it("returns stale when crawl is strictly past threshold (day 4)", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 4,
        visibilityStaleVsCrawl: false,
        sampleQualityTier: "strong",
      }),
    ).toBe("stale");
  });

  it("returns stale when visibility is stale vs crawl", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 1,
        visibilityStaleVsCrawl: true,
        sampleQualityTier: "strong",
      }),
    ).toBe("stale");
  });

  it("visibility stale beats aging for same-day crawl", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 3,
        visibilityStaleVsCrawl: true,
        sampleQualityTier: "strong",
      }),
    ).toBe("stale");
  });

  it("returns critical when crawl age exceeds 2x threshold (day 7)", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 7,
        visibilityStaleVsCrawl: false,
        sampleQualityTier: "strong",
      }),
    ).toBe("critical");
  });

  it("returns stale at day 6 (not yet critical)", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: 6,
        visibilityStaleVsCrawl: false,
        sampleQualityTier: "strong",
      }),
    ).toBe("stale");
  });

  it("returns critical when treatMissingPrimaryCrawlAsNoData and age is null", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: null,
        treatMissingPrimaryCrawlAsNoData: true,
        sampleQualityTier: "strong",
      }),
    ).toBe("critical");
  });

  it("returns fresh when age null and treatMissing flag false", () => {
    expect(
      deriveCoverageState({
        crawlAgeDays: null,
        visibilityStaleVsCrawl: false,
        sampleQualityTier: "strong",
      }),
    ).toBe("fresh");
  });

  it("documents threshold constant", () => {
    expect(COVERAGE_STALE_DAY_THRESHOLD).toBe(3);
  });
});

describe("coverageStateDisplayLabel", () => {
  it("returns title-case labels", () => {
    expect(coverageStateDisplayLabel("fresh")).toBe("Fresh");
    expect(coverageStateDisplayLabel("aging")).toBe("Aging");
    expect(coverageStateDisplayLabel("stale")).toBe("Stale");
    expect(coverageStateDisplayLabel("critical")).toBe("Critical");
    expect(coverageStateDisplayLabel("partial")).toBe("Partial");
  });
});

describe("coverageWarningLine", () => {
  it("returns null for fresh", () => {
    expect(coverageWarningLine("fresh")).toBe(null);
  });

  it("returns factual strings for non-fresh", () => {
    expect(coverageWarningLine("stale")).toContain("not been updated");
    expect(coverageWarningLine("aging")).toContain("may be outdated");
    expect(coverageWarningLine("critical")).toContain("No recent data");
    expect(coverageWarningLine("partial")).toContain("Limited coverage");
  });
});

describe("coverageAttentionForFindings", () => {
  it("returns null for fresh and partial", () => {
    expect(coverageAttentionForFindings("fresh", false, 0)).toBe(null);
    expect(coverageAttentionForFindings("partial", false, 0)).toBe(null);
  });

  it("always returns critical and stale", () => {
    expect(coverageAttentionForFindings("critical", true, 3)).toBe("critical");
    expect(coverageAttentionForFindings("stale", true, 3)).toBe("stale");
  });

  it("returns aging only when no critical finding and no actionable findings", () => {
    expect(coverageAttentionForFindings("aging", false, 0)).toBe("aging");
    expect(coverageAttentionForFindings("aging", true, 0)).toBe(null);
    expect(coverageAttentionForFindings("aging", false, 1)).toBe(null);
  });
});
