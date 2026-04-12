import { describe, expect, it } from "vitest";
import {
  deriveCoverageTone,
  type TodayProofContext,
} from "@/lib/today-proof-context";

function baseCtx(over: Partial<TodayProofContext> = {}): TodayProofContext {
  return {
    crawlRunId: "c1",
    crawlCompletedAt: "2026-01-01T00:00:00.000Z",
    crawlHref: "/observations/c1",
    visibilityRunId: "v1",
    visibilityCompletedAt: "2026-01-01T00:00:00.000Z",
    visibilityHref: "/observations/v1",
    citationIndexBuiltAt: "2026-01-01T00:00:00.000Z",
    visibilitySynthetic: false,
    visibilitySource: "seed",
    resultsRowCount: 10,
    resultsThrough: "2026-01-10",
    visibilityStaleVsCrawl: false,
    visibilityStaleNote: null,
    crawlAgeDays: 5,
    crawlStale: false,
    visibilityPartialSample: false,
    ...over,
  };
}

describe("deriveCoverageTone", () => {
  it("returns critical when crawl is older than 30 days", () => {
    expect(deriveCoverageTone(baseCtx({ crawlAgeDays: 31 }))).toBe("critical");
  });

  it("returns degraded when crawl is stale (>14d) and not yet critical branch order", () => {
    expect(
      deriveCoverageTone(
        baseCtx({
          crawlAgeDays: 20,
          crawlStale: true,
        }),
      ),
    ).toBe("degraded");
  });

  it("returns degraded when visibility sample is stale vs crawl", () => {
    expect(
      deriveCoverageTone(
        baseCtx({
          visibilityStaleVsCrawl: true,
          visibilityStaleNote: "rollup older than crawl",
        }),
      ),
    ).toBe("degraded");
  });

  it("returns partial when visibility sample is partial / synthetic gap", () => {
    expect(
      deriveCoverageTone(
        baseCtx({
          visibilityPartialSample: true,
          crawlAgeDays: 5,
          crawlStale: false,
        }),
      ),
    ).toBe("partial");
  });

  it("returns ok when no staleness or partial flags", () => {
    expect(deriveCoverageTone(baseCtx())).toBe("ok");
  });
});
