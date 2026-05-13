/**
 * Phase 2B follow-up (2026-05-13) — hero/chart alignment + filter-state
 * pins for the Today v2 visibility group client.
 *
 * The key product contract these tests enforce:
 *
 *   The visible hero score equals the chart headline score for every
 *   supported (window × metric) combination. Toggling 7d/14d/30d/60d/
 *   All time × Overall/Mentions/Citations updates BOTH surfaces in
 *   lockstep.
 *
 * This file pins:
 *   1. The visibility-group client owns shared state for both window
 *      and metric (lifted up from the chart).
 *   2. The hero derives its score from the SAME `brandSeriesByMetric`
 *      / `chartEndDate` / window the chart uses — and the same
 *      latest-non-empty-in-window math.
 *   3. The leaderboard slice stays composite-by-window (rank logic
 *      unchanged; toggling metric does not shuffle the leaderboard).
 *   4. Stale GAIO entries (if they ever appear in
 *      `brandSeriesByPlatform`) are filtered out client-side.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLIENT_SRC = readFileSync(
  resolve(__dirname, "today-v2-visibility-group-client.tsx"),
  "utf8",
);
const CHART_SRC = readFileSync(
  resolve(__dirname, "../../components/today/visibility-score-chart.tsx"),
  "utf8",
);

describe("TodayV2VisibilityGroupClient — shared state ownership", () => {
  it("owns useState<VisibilityMetric> (lifted out of the chart)", () => {
    expect(CLIENT_SRC).toMatch(
      /useState<VisibilityMetric>\(\s*["']composite["']\s*\)/,
    );
  });

  it("owns useState<number> for visibilityWindow with default 14", () => {
    expect(CLIENT_SRC).toMatch(/useState<number>\(\s*14\s*\)/);
  });

  it("passes both metric + onMetricChange to VisibilityScoreChart", () => {
    expect(CLIENT_SRC).toMatch(/metric=\{visibilityMetric\}/);
    expect(CLIENT_SRC).toMatch(/onMetricChange=\{setVisibilityMetric\}/);
  });

  it("passes both timeRange + onTimeRangeChange to VisibilityScoreChart", () => {
    expect(CLIENT_SRC).toMatch(/timeRange=\{visibilityWindow\}/);
    expect(CLIENT_SRC).toMatch(/onTimeRangeChange=\{setVisibilityWindow\}/);
  });
});

describe("TodayV2VisibilityGroupClient — hero/chart alignment", () => {
  it("hero score reads brandSeriesByMetric[visibilityMetric] (NOT leaderboard.score)", () => {
    // Find the heroProps useMemo and verify the score-source line
    // points at the selected-metric series, not at the leaderboard.
    const heroBlock =
      CLIENT_SRC.split("const heroProps = useMemo(")[1] ?? "";
    expect(heroBlock).toMatch(
      /brandSeriesByMetric\[visibilityMetric\]/,
    );
    // Legacy "score from brandRow" line must be gone — that was the
    // window-AVERAGE source that diverged from the chart's latest-in-
    // window headline (the bug this fix closes).
    expect(heroBlock).not.toMatch(/score:\s*brandRow\?\.score/);
    expect(heroBlock).not.toMatch(/score:\s*brandRow\.score/);
  });

  it("hero applies the same chartEndDate − (window − 1) cutoff the chart uses", () => {
    const heroBlock =
      CLIENT_SRC.split("const heroProps = useMemo(")[1] ?? "";
    // Same windowing arithmetic as VisibilityScoreChart's `cutoffDate`
    // calculation. Without this, the hero's "latest" could fall outside
    // the chart's visible range when sampling is sparse.
    expect(heroBlock).toMatch(/setUTCDate\(/);
    expect(heroBlock).toMatch(/visibilityWindow\s*-\s*1/);
  });

  it("hero delta is latest-minus-earliest within the visible window (matches chart)", () => {
    const heroBlock =
      CLIENT_SRC.split("const heroProps = useMemo(")[1] ?? "";
    expect(heroBlock).toMatch(/latestVisible\.score\s*-\s*earliestVisible\.score/);
    // Old leaderboard-driven delta line must be gone.
    expect(heroBlock).not.toMatch(/delta:\s*brandRow\?\.delta/);
  });

  it("hero useMemo dependency list includes visibilityMetric (so toggling re-renders)", () => {
    const heroBlock =
      CLIENT_SRC.split("const heroProps = useMemo(")[1] ?? "";
    const depsMatch = heroBlock.match(/\}\s*,\s*\[([^\]]+)\]\s*\)/);
    expect(depsMatch).toBeTruthy();
    const deps = depsMatch![1];
    expect(deps).toContain("visibilityWindow");
    expect(deps).toContain("visibilityMetric");
    expect(deps).toContain("visibilityData");
  });
});

describe("TodayV2VisibilityGroupClient — leaderboard stays composite-by-window", () => {
  it("leaderboard slice still reads composite[visibilityWindow]", () => {
    expect(CLIENT_SRC).toMatch(
      /leaderboardByMetricAndWindow\?\.composite\[\s*visibilityWindow\s*\]/,
    );
  });

  it("rank + closestChallenger derived from composite leaderboard (unchanged)", () => {
    const heroBlock =
      CLIENT_SRC.split("const heroProps = useMemo(")[1] ?? "";
    // rank line still reads from brandRow (the composite leaderboard
    // entry), not from the metric series — keeping rank as a single-
    // axis comparison that doesn't shuffle when the user toggles
    // metrics.
    expect(heroBlock).toMatch(/rank:\s*brandRow\?\.rank/);
    expect(heroBlock).toMatch(/closestChallenger/);
  });
});

describe("VisibilityScoreChart — controlled metric prop + All time + GAIO defense", () => {
  it("accepts a controlled `metric` prop (lifted state contract)", () => {
    expect(CHART_SRC).toMatch(/metric\?: VisibilityMetric/);
    expect(CHART_SRC).toMatch(/onMetricChange\?: \(m: VisibilityMetric\) => void/);
  });

  it("TIME_RANGES includes All time entry using ALL_TIME_WINDOW sentinel", () => {
    expect(CHART_SRC).toMatch(/\bALL_TIME_WINDOW\b/);
    expect(CHART_SRC).toMatch(/label:\s*["']All time["']/);
  });

  it("split-by-platform branch defensively drops inactive providers", () => {
    // Even if a stale RSC payload still listed "Google AI Overviews"
    // as a key in `brandSeriesByPlatform`, the chart must not render
    // it. The filter is the `isActiveSnapshotPlatform` predicate
    // (delegates to canonicalizePollPlatform — same source of truth
    // the server-side filter uses).
    expect(CHART_SRC).toMatch(/isActiveSnapshotPlatform\(\s*platform\s*\)/);
  });

  it("Perplexity color is purple (#7C3AED), not teal — distinct from ChatGPT", () => {
    expect(CHART_SRC).toMatch(/"Perplexity":\s*"stroke-\[#7C3AED\]/);
    expect(CHART_SRC).not.toMatch(/"Perplexity":\s*"stroke-\[#0D9488\]/);
  });

  it("competitor colors are non-semantic neutrals (no status-danger/warning/success)", () => {
    // Locate the competitor color block.
    const block = CHART_SRC.split("COMPETITOR_COLORS")[1] ?? "";
    expect(block).not.toMatch(/stroke-status-danger/);
    expect(block).not.toMatch(/stroke-status-warning/);
    expect(block).not.toMatch(/stroke-status-success/);
    // And the new neutral hexes are present.
    expect(block).toMatch(/#64748B/); // slate
    expect(block).toMatch(/#0EA5E9/); // sky
    expect(block).toMatch(/#F59E0B/); // amber
    expect(block).toMatch(/#EC4899/); // pink
  });

  it("layout breakpoint moved from sm: to lg: so toggles do not overlap title on narrow tablets", () => {
    // The header row's flex direction switch breakpoint.
    expect(CHART_SRC).toMatch(/lg:flex-row\s+lg:items-start\s+lg:justify-between/);
    // Old `sm:flex-row sm:items-start sm:justify-between` must be gone
    // (would re-introduce the overlap).
    expect(CHART_SRC).not.toMatch(/sm:flex-row\s+sm:items-start\s+sm:justify-between/);
  });

  it("All time toggle label uses the canonical sentinel in the sampled-day strip", () => {
    expect(CHART_SRC).toMatch(/timeRange === ALL_TIME_WINDOW/);
    expect(CHART_SRC).toMatch(/all-time/);
  });
});

describe("Today page — force-dynamic", () => {
  it("declares `export const dynamic = \"force-dynamic\"`", () => {
    const pageSrc = readFileSync(resolve(__dirname, "page.tsx"), "utf8");
    expect(pageSrc).toMatch(
      /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
    );
  });
});

describe("Read-model loader — All time leaderboard window", () => {
  it("LEADERBOARD_WINDOWS includes the ALL_TIME_WINDOW sentinel", () => {
    const src = readFileSync(
      resolve(__dirname, "../../domains/today/visibility-read-model.ts"),
      "utf8",
    );
    const block = src.split("const LEADERBOARD_WINDOWS")[1] ?? "";
    expect(block).toMatch(/ALL_TIME_WINDOW_SHARED/);
  });

  it("SNAPSHOT_WINDOW_DAYS extended past 60 to support All time", () => {
    const src = readFileSync(
      resolve(__dirname, "../../domains/today/visibility-read-model.ts"),
      "utf8",
    );
    const m = src.match(/SNAPSHOT_WINDOW_DAYS\s*=\s*(\d+)/);
    expect(m).toBeTruthy();
    const days = Number(m![1]);
    expect(days).toBeGreaterThanOrEqual(365);
  });
});
