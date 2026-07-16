"use client";

/**
 * Today v2 visibility group client.
 *
 * Owns the shared filter state for the hero + chart + leaderboard
 * subtree so all three pieces read from the same selection:
 *
 *   visibilityWindow  : 7 | 14 | 30 | 60 | ALL_TIME_WINDOW   (default 14)
 *   visibilityMetric  : composite | mention_rate | citation_rate (default composite)
 *
 * Hero score / chart headline / chart's per-day line all read
 * `brandSeriesByMetric[visibilityMetric]` filtered to the visible
 * window. The leaderboard rank / closest challenger continue to use
 * the composite leaderboard for the selected window (rank is an
 * intrinsically single-axis comparison; toggling the metric does not
 * shuffle the leaderboard).
 */

import { useMemo, useState } from "react";

import { AIVisibilityHero } from "@/components/today/ai-visibility-hero";
import { VisibilityScoreChart } from "@/components/today/visibility-score-chart";
import { VisibilityLeaderboard } from "@/components/today/visibility-leaderboard";
import { ALL_TIME_WINDOW } from "@/domains/today/visibility-read-model-constants";

import type {
  VisibilityMetric,
  VisibilityPoint,
  EntityVisibility,
} from "@/domains/product/visibility-score";
import type { EnrichmentV2Data } from "@/domains/prompt-answer-observations/enrichment-rollup";
import type { TodayPrimaryShare } from "@/domains/daily-metric-snapshots/today-primary-share";

type VisibilityData = {
  brandName: string;
  brandSeriesByMetric: Record<VisibilityMetric, VisibilityPoint[]>;
  brandSeriesByPlatform?: Record<string, VisibilityPoint[]>;
  leaderboardByMetric: Record<VisibilityMetric, EntityVisibility[]>;
  leaderboardByMetricAndWindow?: Record<
    VisibilityMetric,
    Record<number, EntityVisibility[]>
  >;
  chartEndDate?: string;
  competitorSeriesByMetric: Record<
    VisibilityMetric,
    Array<{ name: string; points: VisibilityPoint[] }>
  >;
  chartEvents?: Array<{
    date: string;
    tone: "danger" | "success" | "neutral";
    label: string;
  }>;
  /**
   * Freshness/cache hardening (2026-05-13). Optional so this client
   * stays back-compat with any caller that doesn't yet thread it
   * through; when present, the hero renders a subtle pill with the
   * label.
   */
  freshness?: {
    status: "fresh" | "stale" | "rebuilding" | "empty";
    latestSnapshotDate: string | null;
    label: string;
  };
};

export type TodayV2VisibilityGroupClientProps = {
  visibilityData: VisibilityData | null;
  enrichmentV2: EnrichmentV2Data | null;
  /**
   * Section 6 C4b (2026-05-15) — snapshot-derived per-platform primary-
   * recommendation percentage. Replaces the prior client-side
   * `platformPrimaryPct(platform)` closure that searched
   * `enrichmentV2.sparklines` with a TitleCase comparison against
   * lowercase-canonicalized sparkline keys (the closure always
   * returned null in production → pills silently hidden). Values
   * flow from `daily_metric_snapshots` via `computeTodayPrimaryShare`
   * in the server-side loader; see
   * `src/domains/daily-metric-snapshots/today-primary-share.ts`.
   * Mathematical equivalence vs the legacy path is pinned by
   * `tests/domains/today/today-primary-share-equivalence.test.ts`.
   */
  primaryShare: TodayPrimaryShare;
};

export function TodayV2VisibilityGroupClient({
  visibilityData,
  enrichmentV2,
  primaryShare,
}: TodayV2VisibilityGroupClientProps) {
  const [visibilityWindow, setVisibilityWindow] = useState<number>(14);
  const [visibilityMetric, setVisibilityMetric] =
    useState<VisibilityMetric>("composite");

  const heroProps = useMemo(() => {
    if (!visibilityData) return null;

    // Leaderboard for rank / closest challenger — composite-by-window
    // (unchanged from prior behavior; rank is intrinsically single-axis).
    const leaderboard =
      visibilityData.leaderboardByMetricAndWindow?.composite[
        visibilityWindow
      ] ??
      visibilityData.leaderboardByMetric.composite ??
      [];
    const brandRow = leaderboard.find((e) => e.isOwned) ?? null;

    // ── Hero score / delta / sample stats — match the chart headline. ──
    //
    // Read the SAME series the chart renders for the selected metric,
    // filter to the visible window via the same `chartEndDate −
    // window + 1` cutoff the chart uses, then take latest-non-empty
    // for the score and (latest − earliest) for the within-window
    // delta. This pins hero and chart to one number per render so
    // toggling 7d/14d/30d/60d/All time × Overall/Mentions/Citations
    // updates both surfaces in lockstep.
    const series = visibilityData.brandSeriesByMetric[visibilityMetric] ?? [];
    const anchor =
      visibilityData.chartEndDate ?? series[series.length - 1]?.date ?? null;
    const cutoffISO = (() => {
      if (!anchor) return null;
      const d = new Date(`${anchor}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - (visibilityWindow - 1));
      return d.toISOString().slice(0, 10);
    })();
    const visiblePoints = cutoffISO
      ? series.filter((p) => p.date >= cutoffISO)
      : series;
    const latestVisible = [...visiblePoints]
      .reverse()
      .find((p) => p.sampleSize > 0);
    const earliestVisible = visiblePoints.find((p) => p.sampleSize > 0);
    const score = latestVisible?.score ?? null;
    const delta =
      latestVisible && earliestVisible
        ? latestVisible.score - earliestVisible.score
        : null;
    const latestPointDate = latestVisible?.date ?? null;
    const currentSampledDays = visiblePoints.filter(
      (p) => p.sampleSize > 0,
    ).length;

    const closestChallenger = (() => {
      if (!brandRow) {
        const top = leaderboard.find((e) => !e.isOwned) ?? null;
        return top ? { name: top.name, score: top.score } : null;
      }
      const competitors = leaderboard.filter((e) => !e.isOwned);
      if (competitors.length === 0) return null;
      const ahead = competitors
        .filter((e) => e.rank < brandRow.rank)
        .sort((a, b) => b.rank - a.rank)[0];
      const behind = competitors
        .filter((e) => e.rank > brandRow.rank)
        .sort((a, b) => a.rank - b.rank)[0];
      const pick = ahead ?? behind ?? null;
      return pick ? { name: pick.name, score: pick.score } : null;
    })();

    // Section 6 C4b — primary-share values now arrive as a server-
    // computed prop from `loadTodayV2VisibilityData` → snapshot-
    // derived in `computeTodayPrimaryShare`. The prior client-side
    // closure that searched `enrichmentV2.sparklines` for matching
    // `platform` strings is gone (it had a casing bug that
    // suppressed the pills). The sparkline data is still read below
    // for `sampleStatus` — a separate signal from primary share.

    const sampleState: "full" | "partial" | undefined = (() => {
      const sparks = enrichmentV2?.sparklines ?? [];
      const known = sparks.filter(
        (s) => s.platform === "ChatGPT" || s.platform === "Perplexity",
      );
      if (known.length === 0) return undefined;
      const allEnough = known.every((s) => s.sampleStatus === "enough");
      return allEnough ? "full" : "partial";
    })();

    return {
      brandName: visibilityData.brandName,
      score,
      delta,
      windowDays: visibilityWindow,
      rank: brandRow?.rank ?? null,
      totalRanked: leaderboard.length,
      closestChallenger,
      currentSampledDays,
      latestReadingDate: latestPointDate,
      chatgptPrimaryPct: primaryShare.chatgptPrimaryPct,
      perplexityPrimaryPct: primaryShare.perplexityPrimaryPct,
      sampleState,
      freshness: visibilityData.freshness
        ? {
            status: visibilityData.freshness.status,
            label: visibilityData.freshness.label,
          }
        : undefined,
    };
  }, [visibilityData, visibilityWindow, visibilityMetric, enrichmentV2, primaryShare]);

  if (!visibilityData) return null;

  // Leaderboard slice — composite by window. All time falls back to
  // the bundled 14d default if the loader didn't emit an all-time slice
  // for some reason (defensive — current loader always includes it).
  const leaderboardEntities =
    visibilityData.leaderboardByMetricAndWindow?.composite[visibilityWindow] ??
    visibilityData.leaderboardByMetricAndWindow?.composite[ALL_TIME_WINDOW] ??
    visibilityData.leaderboardByMetric.composite;

  return (
    <div className="space-y-6" data-today-v2-section="visibility-group">
      {heroProps && <AIVisibilityHero {...heroProps} />}
      <section
        className="space-y-3"
        data-today-v2-section="visibility-trend"
      >
        <VisibilityScoreChart
          brandName={visibilityData.brandName}
          brandSeriesByMetric={visibilityData.brandSeriesByMetric}
          brandSeriesByPlatform={visibilityData.brandSeriesByPlatform ?? {}}
          competitorSeriesByMetric={visibilityData.competitorSeriesByMetric}
          events={visibilityData.chartEvents ?? []}
          timeRange={visibilityWindow}
          onTimeRangeChange={setVisibilityWindow}
          metric={visibilityMetric}
          onMetricChange={setVisibilityMetric}
          chartEndDate={visibilityData.chartEndDate ?? null}
        />
      </section>
      <section
        className="space-y-3"
        data-today-v2-section="visibility-leaderboard"
      >
        <VisibilityLeaderboard
          entities={leaderboardEntities}
          windowEndDate={visibilityData.chartEndDate ?? null}
        />
      </section>
    </div>
  );
}
