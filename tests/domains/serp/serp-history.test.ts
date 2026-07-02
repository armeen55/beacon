import { describe, it, expect } from "vitest";

import { computeRankDelta, pickLatestOwnRank, type SerpRankPoint } from "@/domains/serp/serp-history";

const NOW = new Date("2026-07-02T00:00:00Z");

const p = (capturedAt: string, ownRank: number | null, ownUrl: string | null = null): SerpRankPoint => ({
  capturedAt,
  ownRank,
  ownUrl,
});

describe("computeRankDelta — the observed movement math", () => {
  it("returns the earliest -> latest observed ranks inside the window (9 to 6 = up)", () => {
    const d = computeRankDelta(
      [p("2026-06-20T00:00:00Z", 9), p("2026-06-25T00:00:00Z", 8), p("2026-07-01T00:00:00Z", 6)],
      30,
      NOW,
    );
    expect(d).toEqual({
      fromRank: 9,
      toRank: 6,
      fromAt: "2026-06-20T00:00:00Z",
      toAt: "2026-07-01T00:00:00Z",
      direction: "up",
    });
  });

  it("labels a worsening rank down and an unchanged rank flat", () => {
    expect(computeRankDelta([p("2026-06-20T00:00:00Z", 4), p("2026-07-01T00:00:00Z", 7)], 30, NOW)?.direction).toBe("down");
    expect(computeRankDelta([p("2026-06-20T00:00:00Z", 5), p("2026-07-01T00:00:00Z", 5)], 30, NOW)?.direction).toBe("flat");
  });

  it("needs at least TWO observed positions — one point or none is honest silence (null)", () => {
    expect(computeRankDelta([], 30, NOW)).toBeNull();
    expect(computeRankDelta([p("2026-07-01T00:00:00Z", 6)], 30, NOW)).toBeNull();
  });

  it("ignores snapshots where the tenant was absent (null own rank)", () => {
    expect(computeRankDelta([p("2026-06-20T00:00:00Z", null), p("2026-07-01T00:00:00Z", 6)], 30, NOW)).toBeNull();
    const d = computeRankDelta(
      [p("2026-06-20T00:00:00Z", 9), p("2026-06-25T00:00:00Z", null), p("2026-07-01T00:00:00Z", 6)],
      30,
      NOW,
    );
    expect(d?.fromRank).toBe(9);
    expect(d?.toRank).toBe(6);
  });

  it("respects the sinceDays window — older observations do not count", () => {
    const d = computeRankDelta(
      [p("2026-05-01T00:00:00Z", 20), p("2026-06-20T00:00:00Z", 9), p("2026-07-01T00:00:00Z", 6)],
      30,
      NOW,
    );
    expect(d?.fromRank).toBe(9); // May 1 (rank 20) is outside the 30-day window
    expect(computeRankDelta([p("2026-05-01T00:00:00Z", 20), p("2026-05-02T00:00:00Z", 18)], 30, NOW)).toBeNull();
  });

  it("sorts out-of-order points by captured time before picking earliest/latest", () => {
    const d = computeRankDelta(
      [p("2026-07-01T00:00:00Z", 6), p("2026-06-20T00:00:00Z", 9)],
      30,
      NOW,
    );
    expect(d?.fromRank).toBe(9);
    expect(d?.toRank).toBe(6);
  });
});

describe("pickLatestOwnRank — the literal latest observed position", () => {
  it("returns the most recent point where the tenant actually appeared", () => {
    const latest = pickLatestOwnRank([
      p("2026-06-20T00:00:00Z", 9, "https://iranopedia.com/x"),
      p("2026-07-01T00:00:00Z", 6, "https://iranopedia.com/x"),
    ]);
    expect(latest).toEqual({ rank: 6, url: "https://iranopedia.com/x", capturedAt: "2026-07-01T00:00:00Z" });
  });

  it("skips trailing absent snapshots and answers null when never observed", () => {
    expect(
      pickLatestOwnRank([p("2026-06-20T00:00:00Z", 9), p("2026-07-01T00:00:00Z", null)])?.rank,
    ).toBe(9);
    expect(pickLatestOwnRank([p("2026-07-01T00:00:00Z", null)])).toBeNull();
    expect(pickLatestOwnRank([])).toBeNull();
  });
});
