"use client";

import { KpiCard } from "@/components/viz/kpi-card";
import { HealthStrip, type HealthStripProps } from "./health-strip";

export type ScoreboardData = {
  totalCitations: number;
  totalMentions: number;
  trendPct: number | null;
  platformBreakdown: { platform: string; label: string; citations: number; mentions: number }[];
  citedPageCount: number;
  resultCount: number;
  dateRange: { from: string; to: string } | null;
  mentionRate: number | null;
  decliningTopicCount: number;
  risingTopicCount: number;
  weekOverWeekCitations: number | null;
  weekOverWeekMentions: number | null;
};

/** Compact platform breakdown as text, not a chart */
function platformSummary(
  breakdown: ScoreboardData["platformBreakdown"],
): string | undefined {
  const active = breakdown.filter((p) => p.citations > 0);
  if (active.length === 0) return undefined;
  return active
    .sort((a, b) => b.citations - a.citations)
    .slice(0, 3)
    .map((p) => `${p.label} ${p.citations}`)
    .join(" · ");
}

export function TodayScoreboard({
  scoreboard,
  health,
}: {
  scoreboard: ScoreboardData;
  health: HealthStripProps;
}) {
  const mentionRatePct = scoreboard.mentionRate != null
    ? Math.round(scoreboard.mentionRate * 100)
    : null;

  const topicMeta = [
    scoreboard.risingTopicCount > 0 ? `${scoreboard.risingTopicCount} growing` : null,
    scoreboard.decliningTopicCount > 0 ? `${scoreboard.decliningTopicCount} slipping` : null,
  ].filter(Boolean).join(" · ");

  const platMeta = platformSummary(scoreboard.platformBreakdown);

  const wowCit = scoreboard.weekOverWeekCitations;
  const wowMen = scoreboard.weekOverWeekMentions;

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3">
        <KpiCard
          label="Times AI recommended you"
          value={scoreboard.totalCitations}
          delta={wowCit}
          deltaSuffix="%"
          meta={
            wowCit !== null
              ? `vs last week${platMeta ? ` · ${platMeta}` : ""}`
              : platMeta
                ? platMeta
                : scoreboard.dateRange
                  ? `through ${scoreboard.dateRange.to}`
                  : undefined
          }
        />
        {mentionRatePct !== null && (
          <KpiCard
            label="How often AI mentions you"
            value={`${mentionRatePct}%`}
            delta={wowMen}
            deltaSuffix="%"
            meta={
              wowMen !== null
                ? `vs last week${topicMeta ? ` · ${topicMeta}` : ""}`
                : topicMeta || `across ${scoreboard.resultCount.toLocaleString()} AI answers`
            }
          />
        )}
        <KpiCard
          label="Your pages AI sends people to"
          value={scoreboard.citedPageCount}
          meta={scoreboard.citedPageCount > 0 ? "pages where AI links directly to you" : "no data yet"}
        />
      </div>

      {/* Health strip */}
      <HealthStrip {...health} />
    </div>
  );
}
