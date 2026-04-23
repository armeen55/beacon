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
  /**
   * Commit 5 (2026-04-24). When non-null, `totalCitations`/`totalMentions`
   * are read from `daily_metric_snapshots source_type='derived'` for the
   * given ISO date (today or yesterday), not from the cumulative raw
   * `results` totals. The tile meta renders "As of Apr 23" so the operator
   * reads the single-day semantics plainly.
   */
  derivedKpiAsOfDate?: string | null;
  /** True when derivedKpiAsOfDate fell back to yesterday's row. */
  derivedKpiIsFallback?: boolean;
};

/** "2026-04-23" → "Apr 23". Used by the derivedKpiAsOfDate meta line. */
function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return iso;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

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

  // Commit 5 (2026-04-24): when derivedKpiAsOfDate is present, the headline
  // count tiles render today's (or yesterday's) native-poll totals instead
  // of cumulative raw-results counts. Meta line leads with the date so the
  // operator reads single-day semantics. Week-over-week pills suppressed
  // because they're computed from cumulative raw-results and would
  // conflict with the single-day tile value.
  const asOfDate = scoreboard.derivedKpiAsOfDate ?? null;
  const asOfIsFallback = scoreboard.derivedKpiIsFallback ?? false;
  const asOfLabel = asOfDate
    ? `As of ${formatShortDate(asOfDate)}${asOfIsFallback ? " (yesterday)" : " (today)"}`
    : null;

  return (
    <div className="space-y-5">
      {/* KPI cards */}
      <div className="grid grid-cols-1 gap-3">
        <KpiCard
          label="Times AI recommended you"
          value={scoreboard.totalCitations}
          delta={asOfDate ? null : wowCit}
          deltaSuffix="%"
          meta={
            asOfLabel
              ? `${asOfLabel}${platMeta ? ` · ${platMeta}` : ""}`
              : wowCit !== null
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
            delta={asOfDate ? null : wowMen}
            deltaSuffix="%"
            meta={
              asOfLabel
                ? `${asOfLabel}${topicMeta ? ` · ${topicMeta}` : ""}`
                : wowMen !== null
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
