/**
 * Section 6 C4a — Today primary-share snapshot helper unit tests.
 *
 * Pins the per-scope filtering + latest-non-null traversal contract
 * for `computeSnapshotPlatformPrimaryPct` per the C4 pre-flight §7:
 *   • Latest usable platform row wins (date-desc tiebreak)
 *   • source_type='derived' only; benchmark rows ignored
 *   • scope_type='platform' only; entity/topic/prompt rows ignored
 *   • Wrong-platform rows ignored
 *   • primary_recommendation_count null/undefined → row skipped
 *   • total_possible null/undefined/≤0 → row skipped
 *   • Numerator 0 + denominator > 0 → returns 0 (not null)
 *   • Numerator == denominator → returns 100
 *   • Missing platform entirely → returns null
 *   • Both platforms compute independently
 *   • Rounding matches `Math.round((P/N) × 100)` (single round)
 *
 * Companion equivalence harness
 * `tests/domains/today/today-primary-share-equivalence.test.ts`
 * proves the helper output matches the legacy
 * `enrichmentV2.sparklines[].primaryRate` path within 0pp drift.
 */

import { describe, expect, it } from "vitest";

import {
  computeSnapshotPlatformPrimaryPct,
  computeTodayPrimaryShare,
  type TodayPrimaryShareRepo,
} from "@/domains/daily-metric-snapshots/today-primary-share";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";

// ─────────────────────────────────────────────────────────────────────
// Fixture helpers
// ─────────────────────────────────────────────────────────────────────

function platformRow(
  over: Partial<DailyMetricSnapshot> = {},
): DailyMetricSnapshot {
  return {
    id: `derived-${over.date ?? "2026-05-15"}-platform-${(over.platform ?? "Perplexity").toLowerCase()}`,
    date: "2026-05-15",
    scope_type: "platform",
    scope_id: "Perplexity",
    platform: "Perplexity",
    source_type: "derived",
    visibility_score: null,
    mention_count: 0,
    citation_count: 0,
    share_of_voice: null,
    avg_position: null,
    total_possible: 100,
    metadata: {},
    tenant_id: "tenant-fixture",
    cited_or_mentioned_count: null,
    position_weighted_citation_count: null,
    mentioned_obs_count: null,
    primary_recommendation_count: 25,
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────────
// computeSnapshotPlatformPrimaryPct — pure unit tests
// ─────────────────────────────────────────────────────────────────────

describe("computeSnapshotPlatformPrimaryPct — latest-non-null traversal", () => {
  it("picks the latest date when multiple usable rows exist", () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-10",
        primary_recommendation_count: 10,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-15",
        primary_recommendation_count: 42,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-12",
        primary_recommendation_count: 5,
        total_possible: 100,
      }),
    ];
    expect(computeSnapshotPlatformPrimaryPct(snapshots, "Perplexity")).toBe(
      42,
    );
  });

  it("falls back to the previous date when the latest has null primary_recommendation_count", () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-15",
        primary_recommendation_count: null,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-14",
        primary_recommendation_count: 30,
        total_possible: 100,
      }),
    ];
    expect(computeSnapshotPlatformPrimaryPct(snapshots, "Perplexity")).toBe(
      30,
    );
  });

  it("falls back to the previous date when the latest has total_possible === 0", () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-15",
        primary_recommendation_count: 0,
        total_possible: 0,
      }),
      platformRow({
        date: "2026-05-14",
        primary_recommendation_count: 50,
        total_possible: 100,
      }),
    ];
    expect(computeSnapshotPlatformPrimaryPct(snapshots, "Perplexity")).toBe(
      50,
    );
  });
});

describe("computeSnapshotPlatformPrimaryPct — source_type filter", () => {
  it("ignores source_type='benchmark' rows even when populated", () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-15",
        source_type: "benchmark",
        primary_recommendation_count: 99,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-10",
        source_type: "derived",
        primary_recommendation_count: 10,
        total_possible: 100,
      }),
    ];
    expect(computeSnapshotPlatformPrimaryPct(snapshots, "Perplexity")).toBe(
      10,
    );
  });

  it("returns null when ONLY benchmark rows exist", () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-15",
        source_type: "benchmark",
        primary_recommendation_count: 50,
        total_possible: 100,
      }),
    ];
    expect(
      computeSnapshotPlatformPrimaryPct(snapshots, "Perplexity"),
    ).toBeNull();
  });
});

describe("computeSnapshotPlatformPrimaryPct — scope_type filter", () => {
  it("ignores entity/topic/prompt rows even when populated", () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-15",
        scope_type: "entity",
        primary_recommendation_count: 90,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-15",
        scope_type: "topic",
        primary_recommendation_count: 80,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-15",
        scope_type: "prompt",
        primary_recommendation_count: 70,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-10",
        scope_type: "platform",
        primary_recommendation_count: 11,
        total_possible: 100,
      }),
    ];
    expect(computeSnapshotPlatformPrimaryPct(snapshots, "Perplexity")).toBe(
      11,
    );
  });
});

describe("computeSnapshotPlatformPrimaryPct — platform filter", () => {
  it("ignores rows for other platforms", () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-15",
        platform: "ChatGPT",
        primary_recommendation_count: 95,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-12",
        platform: "Perplexity",
        primary_recommendation_count: 12,
        total_possible: 100,
      }),
    ];
    expect(computeSnapshotPlatformPrimaryPct(snapshots, "Perplexity")).toBe(
      12,
    );
    expect(computeSnapshotPlatformPrimaryPct(snapshots, "ChatGPT")).toBe(95);
  });
});

describe("computeSnapshotPlatformPrimaryPct — null/zero handling", () => {
  it("returns 0 when numerator is 0 and denominator > 0", () => {
    expect(
      computeSnapshotPlatformPrimaryPct(
        [
          platformRow({
            primary_recommendation_count: 0,
            total_possible: 100,
          }),
        ],
        "Perplexity",
      ),
    ).toBe(0);
  });

  it("returns 100 when numerator equals denominator", () => {
    expect(
      computeSnapshotPlatformPrimaryPct(
        [
          platformRow({
            primary_recommendation_count: 100,
            total_possible: 100,
          }),
        ],
        "Perplexity",
      ),
    ).toBe(100);
  });

  it("returns null when no row for the requested platform", () => {
    expect(
      computeSnapshotPlatformPrimaryPct(
        [
          platformRow({
            platform: "ChatGPT",
            primary_recommendation_count: 50,
            total_possible: 100,
          }),
        ],
        "Perplexity",
      ),
    ).toBeNull();
  });

  it("returns null when snapshot array is empty", () => {
    expect(
      computeSnapshotPlatformPrimaryPct([], "Perplexity"),
    ).toBeNull();
  });

  it("returns null when total_possible is null on every candidate row", () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-15",
        primary_recommendation_count: 50,
        total_possible: null,
      }),
      platformRow({
        date: "2026-05-14",
        primary_recommendation_count: 30,
        total_possible: null,
      }),
    ];
    expect(
      computeSnapshotPlatformPrimaryPct(snapshots, "Perplexity"),
    ).toBeNull();
  });
});

describe("computeSnapshotPlatformPrimaryPct — rounding", () => {
  it("rounds to integer percent", () => {
    expect(
      computeSnapshotPlatformPrimaryPct(
        [platformRow({ primary_recommendation_count: 1, total_possible: 3 })],
        "Perplexity",
      ),
    ).toBe(33); // 1/3 × 100 = 33.333… → 33
    expect(
      computeSnapshotPlatformPrimaryPct(
        [platformRow({ primary_recommendation_count: 2, total_possible: 3 })],
        "Perplexity",
      ),
    ).toBe(67); // 2/3 × 100 = 66.666… → 67
    expect(
      computeSnapshotPlatformPrimaryPct(
        [platformRow({ primary_recommendation_count: 1, total_possible: 8 })],
        "Perplexity",
      ),
    ).toBe(13); // 1/8 × 100 = 12.5 → 13 (banker's vs half-up: Math.round → 13)
  });

  it("single round only (no intermediate rounding)", () => {
    // Legacy path stored primaryRate as `round(P/N × 100)/100`, then
    // client multiplied by 100 and rounded again. Net effect is a
    // single round in legacy too. NEW path does one round directly.
    expect(
      computeSnapshotPlatformPrimaryPct(
        [platformRow({ primary_recommendation_count: 7, total_possible: 11 })],
        "Perplexity",
      ),
    ).toBe(64); // 7/11 × 100 = 63.636… → 64
  });
});

// ─────────────────────────────────────────────────────────────────────
// computeTodayPrimaryShare — async loader wrapper
// ─────────────────────────────────────────────────────────────────────

function makeMockRepo(
  snapshots: DailyMetricSnapshot[],
  calls?: { sinceArg?: string },
): TodayPrimaryShareRepo {
  return {
    async getDailyMetricSnapshots(options) {
      if (calls && options?.since !== undefined) calls.sinceArg = options.since;
      return snapshots;
    },
  };
}

describe("computeTodayPrimaryShare — async loader wrapper", () => {
  it("returns null for both platforms when the snapshot read is empty", async () => {
    const repo = makeMockRepo([]);
    const result = await computeTodayPrimaryShare({ repo });
    expect(result).toEqual({
      chatgptPrimaryPct: null,
      perplexityPrimaryPct: null,
    });
  });

  it("derives both platforms independently from one snapshot read", async () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        date: "2026-05-15",
        platform: "ChatGPT",
        primary_recommendation_count: 33,
        total_possible: 100,
      }),
      platformRow({
        date: "2026-05-15",
        platform: "Perplexity",
        primary_recommendation_count: 42,
        total_possible: 100,
      }),
    ];
    const repo = makeMockRepo(snapshots);
    const result = await computeTodayPrimaryShare({ repo });
    expect(result).toEqual({
      chatgptPrimaryPct: 33,
      perplexityPrimaryPct: 42,
    });
  });

  it("forwards the optional `since` filter to the repo", async () => {
    const calls: { sinceArg?: string } = {};
    const repo = makeMockRepo([], calls);
    await computeTodayPrimaryShare({
      repo,
      options: { since: "2026-05-01" },
    });
    expect(calls.sinceArg).toBe("2026-05-01");
  });

  it("returns null for one platform when only the other is populated", async () => {
    const snapshots: DailyMetricSnapshot[] = [
      platformRow({
        platform: "ChatGPT",
        primary_recommendation_count: 17,
        total_possible: 100,
      }),
    ];
    const repo = makeMockRepo(snapshots);
    const result = await computeTodayPrimaryShare({ repo });
    expect(result).toEqual({
      chatgptPrimaryPct: 17,
      perplexityPrimaryPct: null,
    });
  });
});
