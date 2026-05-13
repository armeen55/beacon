"use client";

/**
 * Today v2 visibility group client (2026-05-12) — extracts the
 * hero + chart + leaderboard subtree from today-v2-client.tsx so the
 * section can mount inside its own Suspense boundary while still
 * sharing the `visibilityWindow` state across the three pieces.
 *
 * Pure presentation. Identical math to TodayV2Client.heroProps —
 * preserved verbatim so the rendered output matches.
 */

import { useMemo, useState } from "react";

import { AIVisibilityHero } from "@/components/today/ai-visibility-hero";
import { VisibilityScoreChart } from "@/components/today/visibility-score-chart";
import { VisibilityLeaderboard } from "@/components/today/visibility-leaderboard";

import type {
  VisibilityMetric,
  VisibilityPoint,
  EntityVisibility,
} from "@/domains/product/visibility-score";
import type { EnrichmentV2Data } from "@/domains/prompt-answer-observations/enrichment-rollup";

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
};

export type TodayV2VisibilityGroupClientProps = {
  visibilityData: VisibilityData | null;
  enrichmentV2: EnrichmentV2Data | null;
};

export function TodayV2VisibilityGroupClient({
  visibilityData,
  enrichmentV2,
}: TodayV2VisibilityGroupClientProps) {
  const [visibilityWindow, setVisibilityWindow] = useState<number>(14);

  const heroProps = useMemo(() => {
    if (!visibilityData) return null;
    const leaderboard =
      visibilityData.leaderboardByMetricAndWindow?.composite[
        visibilityWindow
      ] ??
      visibilityData.leaderboardByMetric.composite ??
      [];
    const brandRow = leaderboard.find((e) => e.isOwned) ?? null;

    const series = visibilityData.brandSeriesByMetric.composite ?? [];
    let latestPointDate: string | null = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].sampleSize > 0) {
        latestPointDate = series[i].date;
        break;
      }
    }

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

    const platformPrimaryPct = (platform: string): number | null => {
      const sparkline = enrichmentV2?.sparklines?.find(
        (s) => s.platform === platform,
      );
      if (!sparkline) return null;
      for (let i = sparkline.points.length - 1; i >= 0; i--) {
        const r = sparkline.points[i].primaryRate;
        if (r !== null) return Math.round(r * 100);
      }
      return null;
    };

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
      score: brandRow?.score ?? null,
      delta: brandRow?.delta ?? null,
      windowDays: brandRow?.deltaWindowDays ?? visibilityWindow,
      rank: brandRow?.rank ?? null,
      totalRanked: leaderboard.length,
      closestChallenger,
      currentSampledDays: brandRow?.currentSampledDays ?? 0,
      latestReadingDate: latestPointDate,
      chatgptPrimaryPct: platformPrimaryPct("ChatGPT"),
      perplexityPrimaryPct: platformPrimaryPct("Perplexity"),
      sampleState,
    };
  }, [visibilityData, visibilityWindow, enrichmentV2]);

  if (!visibilityData) return null;

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
          chartEndDate={visibilityData.chartEndDate ?? null}
        />
      </section>
      <section
        className="space-y-3"
        data-today-v2-section="visibility-leaderboard"
      >
        <VisibilityLeaderboard
          entities={
            visibilityData.leaderboardByMetricAndWindow?.composite[
              visibilityWindow
            ] ?? visibilityData.leaderboardByMetric.composite
          }
        />
      </section>
    </div>
  );
}
