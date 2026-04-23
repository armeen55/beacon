import { describe, it, expect } from "vitest";

import { aggregateDerivedPlatformRows } from "@/domains/daily-metric-snapshots/today-kpis";

describe("aggregateDerivedPlatformRows", () => {
  it("sums citation_count and mention_count across rows", () => {
    const rows = [
      {
        platform: "Perplexity",
        mention_count: 103,
        citation_count: 106,
        visibility_score: 51.5,
        share_of_voice: 7.32,
      },
      {
        platform: "ChatGPT",
        mention_count: 70,
        citation_count: 68,
        visibility_score: 59.83,
        share_of_voice: 14.05,
      },
    ];
    const out = aggregateDerivedPlatformRows("2026-04-23", false, rows);
    expect(out.date).toBe("2026-04-23");
    expect(out.isFallback).toBe(false);
    expect(out.totalCitations).toBe(174);
    expect(out.totalMentions).toBe(173);
    expect(out.platformRowCount).toBe(2);
  });

  it("handles a single platform row (partial poll — only one platform completed)", () => {
    const rows = [
      {
        platform: "Perplexity",
        mention_count: 103,
        citation_count: 106,
        visibility_score: 51.5,
        share_of_voice: 7.32,
      },
    ];
    const out = aggregateDerivedPlatformRows("2026-04-23", false, rows);
    expect(out.totalCitations).toBe(106);
    expect(out.totalMentions).toBe(103);
    expect(out.platformRowCount).toBe(1);
  });

  it("returns zeros on empty input (caller filters this case, but aggregator stays defensive)", () => {
    const out = aggregateDerivedPlatformRows("2026-04-23", false, []);
    expect(out.totalCitations).toBe(0);
    expect(out.totalMentions).toBe(0);
    expect(out.platformRowCount).toBe(0);
  });

  it("propagates isFallback=true through aggregation", () => {
    const rows = [
      {
        platform: "Perplexity",
        mention_count: 100,
        citation_count: 100,
        visibility_score: 50,
        share_of_voice: 7,
      },
    ];
    const out = aggregateDerivedPlatformRows("2026-04-22", true, rows);
    expect(out.isFallback).toBe(true);
    expect(out.date).toBe("2026-04-22");
  });

  it("treats null mention_count / citation_count as 0", () => {
    // Defensive: DB columns are NOT NULL but TS types tolerate nulls.
    const rows = [
      {
        platform: "Perplexity",
        mention_count: null as unknown as number,
        citation_count: null as unknown as number,
        visibility_score: null,
        share_of_voice: null,
      },
    ];
    const out = aggregateDerivedPlatformRows("2026-04-23", false, rows);
    expect(out.totalCitations).toBe(0);
    expect(out.totalMentions).toBe(0);
  });
});
