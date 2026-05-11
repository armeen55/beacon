"use client";

import { KpiCard } from "@/components/viz/kpi-card";
import { HealthStrip, type HealthStripProps } from "./health-strip";
import type { SamplingStatus } from "@/domains/observations/poll-health";

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
  /**
   * Poll Integrity Hardening (2026-05-04, Operator R7).
   * Sampling status of the as-of-date sample, aggregated across both
   * platforms (worst-case wins). When "proof" or "partial", the headline
   * tile renders a small-sample tag in meta and the week-over-week pill
   * stays suppressed (consistent with derivedKpiAsOfDate's existing
   * single-day semantics). "full" gets no tag. Null when there is no
   * poll-health signal yet.
   */
  derivedKpiSamplingStatus?: SamplingStatus | null;
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

/** Operator R7: short tag describing as-of-date sample size. */
function samplingStatusTag(status: SamplingStatus | null): string {
  switch (status) {
    case "proof":
      return "small sample (proof run)";
    case "partial":
      return "partial day (below 80-prompt floor)";
    case "empty":
      return "no observations today";
    case "full":
    case null:
    case undefined:
      return "";
  }
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
  // Poll Integrity Hardening (2026-05-04, Operator R7): if the as-of-date
  // is sampled below the full-day threshold, append a sampling tag to
  // the tile's meta line so the operator doesn't read a 5-obs day as a
  // full 100-obs day. Week-over-week pills are already suppressed when
  // asOfDate is non-null, so charts/headlines don't overstate confidence.
  const samplingTag = samplingStatusTag(
    scoreboard.derivedKpiSamplingStatus ?? null,
  );
  const asOfLabel = asOfDate
    ? `As of ${formatShortDate(asOfDate)}${asOfIsFallback ? " (yesterday)" : " (today)"}${samplingTag ? ` · ${samplingTag}` : ""}`
    : null;

  // D3 (operator audit, 2026-05-05) — first-run guidance copy. When a
  // tenant has zero observations on disk yet (no asOfDate, no week-over-
  // week, no cumulative result count), tiles previously read "no data
  // yet" / "vs last week" with no explanation. A first-time operator
  // needs to know data lands AFTER the daily poll runs — not because
  // the product is broken. Copy is generic-safe (no specific time
  // claims unless the app actually knows them).
  const isFirstRunNoData =
    scoreboard.totalCitations === 0 &&
    scoreboard.resultCount === 0 &&
    asOfDate === null;
  const firstRunCitationsMeta =
    "Beacon starts collecting AI answers after the next daily check.";
  const firstRunPagesMeta =
    "Most accounts show their first full daily sample after the next run.";

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
                : isFirstRunNoData
                  ? firstRunCitationsMeta
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
          meta={
            scoreboard.citedPageCount > 0
              ? "pages where AI links directly to you"
              : isFirstRunNoData
                ? firstRunPagesMeta
                : "no citations yet on this window"
          }
        />
      </div>

      {/* Health strip */}
      <HealthStrip {...health} />
    </div>
  );
}
