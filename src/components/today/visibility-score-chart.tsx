"use client";

import { useMemo, useState } from "react";
import { AreaChart, type AreaSeries } from "@/components/viz/area-chart";
import { cn } from "@/lib/utils";
import type {
  VisibilityMetric,
  VisibilityPoint,
} from "@/domains/product/visibility-score";
import {
  VISIBILITY_METRIC_LABELS,
  VISIBILITY_METRIC_DESCRIPTIONS,
} from "@/domains/product/visibility-score";
import { WhyThisNumber } from "@/components/today/why-this-number";
import { buildOverallVisibilityProvenance } from "@/domains/today/score-provenance";
import { NATIVE_REGIME_START } from "@/domains/product/native-regime";
import {
  ALL_TIME_WINDOW,
  isActiveSnapshotPlatform,
} from "@/domains/today/visibility-read-model-constants";

/**
 * Visibility Score chart for Today.
 *
 * Left-hand dashboard panel:
 *   - Big headline score + trend delta
 *   - Line chart of score over time
 *   - Metric toggle (Mention rate / Citation rate / Visibility score)
 *   - Period toggle (Current / Previous)
 *   - Compare competitors toggle
 *
 * Receives ALREADY-COMPUTED time series from the server (see
 * `src/app/(shell)/today-data.ts`). No data fetching inside this component.
 *
 * Built 2026-04-17 (Day 6 visual rebuild). Replaces the "5,146 AI citations"
 * big-number block that previously sat at the top of Today.
 */

/**
 * Dated events the chart annotates on the x-axis. Currently used to mark
 * hurting-verdict dates so the "+10.5%" headline doesn't hide the two pages
 * that regressed. Added 2026-04-19.
 */
export type VisibilityChartEvent = {
  /** ISO date 'YYYY-MM-DD' \u2014 matched to the chart's point dates. */
  date: string;
  tone: "danger" | "success" | "neutral";
  label: string;
};

export type VisibilityChartProps = {
  /** Tenant brand name for the headline label. */
  brandName: string;
  /** Full 60-day time series for brand, per metric. Filtered client-side
   *  to the selected calendar-date window (Step 1.3 \u2014 master plan). */
  brandSeriesByMetric: Record<VisibilityMetric, VisibilityPoint[]>;
  /** Full 60-day time series broken down by platform. Each platform's points
   *  only include dates where that platform was actually sampled. */
  brandSeriesByPlatform?: Record<string, VisibilityPoint[]>;
  /** Top competitor series for "Compare competitors" toggle. */
  competitorSeriesByMetric: Record<
    VisibilityMetric,
    Array<{ name: string; points: VisibilityPoint[] }>
  >;
  /** Optional dated annotations \u2014 e.g. hurting verdicts. */
  events?: VisibilityChartEvent[];
  /** Step 1.3 (master plan) \u2014 selected window in calendar days (7/14/30/60
   *  or `ALL_TIME_WINDOW` for "All time"). Lifted to the Today v2
   *  visibility-group client so the leaderboard delta + hero score track
   *  the same toggle. Falls back to local state for non-Today consumers. */
  timeRange?: number;
  onTimeRangeChange?: (days: number) => void;
  /**
   * Phase 2B follow-up (2026-05-13) \u2014 selected metric, lifted out of
   * this component so the parent's hero can read the SAME latest-in-
   * window score the chart's headline shows. Optional; falls back to
   * local state for non-Today consumers.
   */
  metric?: VisibilityMetric;
  onMetricChange?: (m: VisibilityMetric) => void;
  /** Anchor (YYYY-MM-DD UTC) for the calendar-date filter. The chart now
   *  shows points from `chartEndDate \u2212 timeRange + 1` through `chartEndDate`
   *  rather than the last N points \u2014 which under sparse sampling silently
   *  expanded the visible window beyond the toggle label. Pass null to fall
   *  back to the latest sampled point. */
  chartEndDate?: string | null;
};

const METRICS: VisibilityMetric[] = [
  "composite",
  "mention_rate",
  "citation_rate",
];

/**
 * Time-range toggle options (days). Server sends up to ~365d (capped in
 * `visibility-read-model.ts`); client slices to the picked window.
 * `ALL_TIME_WINDOW` slices every available snapshot day (earliest
 * active-provider snapshot through today).
 */
const TIME_RANGES: Array<{ days: number; label: string }> = [
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 60, label: "60d" },
  { days: ALL_TIME_WINDOW, label: "All time" },
];

export function VisibilityScoreChart({
  brandName,
  brandSeriesByMetric,
  brandSeriesByPlatform = {},
  competitorSeriesByMetric,
  events = [],
  timeRange: timeRangeProp,
  onTimeRangeChange,
  metric: metricProp,
  onMetricChange,
  chartEndDate,
}: VisibilityChartProps) {
  // Phase 2B follow-up — accept `metric` as a controlled prop so the
  // parent's hero reads the same latest-in-window score the chart's
  // headline shows. Falls back to local state for non-Today consumers.
  const [localMetric, setLocalMetric] = useState<VisibilityMetric>("composite");
  const metric = metricProp ?? localMetric;
  const setMetric = onMetricChange ?? setLocalMetric;
  // Step 1.3 (master plan) — accept timeRange as a controlled prop when the
  // parent (today-client.tsx) needs to keep the leaderboard's delta column
  // in sync. Falls back to local state for non-Today consumers.
  const [localTimeRange, setLocalTimeRange] = useState<number>(14);
  const timeRange = timeRangeProp ?? localTimeRange;
  const setTimeRange = onTimeRangeChange ?? setLocalTimeRange;
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [showPlatforms, setShowPlatforms] = useState(false);

  const fullBrandPoints = brandSeriesByMetric[metric];
  const fullCompetitorSeries = competitorSeriesByMetric[metric];

  // Step 1.3 — derive the calendar-date cutoff from `chartEndDate` so the
  // window matches the toggle label even when sampling is sparse. Falls
  // back to the latest sampled point when the parent doesn't supply an
  // anchor (preserves prior behaviour for non-Today callers).
  const cutoffDate = useMemo(() => {
    const anchor =
      chartEndDate ??
      fullBrandPoints[fullBrandPoints.length - 1]?.date ??
      null;
    if (!anchor) return null;
    const d = new Date(anchor + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - (timeRange - 1));
    return d.toISOString().slice(0, 10);
  }, [chartEndDate, fullBrandPoints, timeRange]);

  // Filter to the selected calendar-date window (replaces the prior
  // `slice(-timeRange)` last-N-points approach — Step 1.3).
  const brandPoints = useMemo(
    () =>
      cutoffDate === null
        ? fullBrandPoints
        : fullBrandPoints.filter((p) => p.date >= cutoffDate),
    [fullBrandPoints, cutoffDate],
  );

  const competitorSeries = useMemo(
    () =>
      fullCompetitorSeries.map((c) => ({
        ...c,
        points:
          cutoffDate === null
            ? c.points
            : c.points.filter((p) => p.date >= cutoffDate),
      })),
    [fullCompetitorSeries, cutoffDate],
  );

  // Sample-count strip: how many sampled days actually live inside the
  // toggle's calendar-day window? Renders below the headline so a 7d toggle
  // showing only 4 dots is honest about it instead of silently lying.
  const sampledDayCount = brandPoints.length;

  // Headline: latest non-empty score vs first non-empty score in the visible range.
  const headline = useMemo(() => {
    const latest = [...brandPoints].reverse().find((p) => p.sampleSize > 0);
    const earliest = brandPoints.find((p) => p.sampleSize > 0);
    if (!latest) return { score: 0, delta: 0, hasData: false };
    const delta = earliest ? latest.score - earliest.score : 0;
    return { score: latest.score, delta, hasData: true };
  }, [brandPoints]);

  // Build AreaChart series.
  const series: AreaSeries[] = useMemo(() => {
    const s: AreaSeries[] = [
      {
        label: brandName,
        data: brandPoints.map((p) => p.score),
        color: "stroke-accent-primary",
        fillColor: "fill-accent-primary/10",
      },
    ];
    // 2026-04-19: "Show platforms" overlay \u2014 one line per AI platform
    // (Google AIO / ChatGPT / Perplexity / Claude). Each series only has
    // points on days that platform was sampled. Matches Profound's per-
    // platform visibility view.
    if (showPlatforms) {
      // Phase 2B follow-up (2026-05-13) — color map durability pass.
      //   Brand line keeps `accent-primary` (orange in current theme).
      //   ChatGPT keeps OpenAI's brand green so users with that mental
      //   model see the expected color.
      //   Perplexity moves from teal (`#0D9488`) → purple (`#7C3AED`) so
      //   it's clearly distinct from ChatGPT's teal-green on screen.
      //   Other / unknown platforms get a muted neutral so future
      //   additions stay readable until a brand color is picked.
      //
      // Google AI Overviews is intentionally NOT in this map even
      // though its color key is preserved here — the active-provider
      // filter below skips the row entirely. Keeping the key lets us
      // re-enable GAIO trivially if it ever comes back as a live
      // provider.
      const PLATFORM_COLORS: Record<string, string> = {
        "Google AI Overviews": "stroke-[#4285F4]/80",
        "ChatGPT": "stroke-[#10A37F]/80",
        "Perplexity": "stroke-[#7C3AED]/85",
        "Claude": "stroke-[#C15F3C]/80",
      };
      const DEFAULT_PLATFORM_COLOR = "stroke-muted-foreground/60";
      // Need a date-indexed lookup so each platform's points align with the
      // shared x-axis (which is brandPoints' dates).
      const dateIdx = new Map(brandPoints.map((p, i) => [p.date, i]));
      for (const [platform, points] of Object.entries(brandSeriesByPlatform)) {
        // P0 client-side defensive filter (2026-05-13). Server already
        // excludes inactive providers via `loadVisibilityReadModelFromSnapshots`,
        // but a stale RSC payload from before that deploy could still
        // carry a "Google AI Overviews" key. Drop it here so the chart
        // + tooltip can never display a dead-provider line under any
        // cache scenario.
        if (!isActiveSnapshotPlatform(platform)) continue;
        if (points.length === 0) continue;
        const aligned: number[] = new Array(brandPoints.length).fill(NaN);
        const filteredPlatformPoints =
          cutoffDate === null
            ? points
            : points.filter((p) => p.date >= cutoffDate);
        for (const p of filteredPlatformPoints) {
          const idx = dateIdx.get(p.date);
          if (idx !== undefined) aligned[idx] = p.score;
        }
        // Substitute NaN with 0 only for rendering (chart can't handle NaN yet).
        // Unsampled days will still visually collapse but wont affect overall.
        const renderable = aligned.map((v) => (Number.isFinite(v) ? v : 0));
        s.push({
          label: platform,
          data: renderable,
          color: PLATFORM_COLORS[platform] ?? DEFAULT_PLATFORM_COLOR,
          fillColor: "fill-transparent",
        });
      }
    }
    if (showCompetitors) {
      // Phase 2B follow-up — competitor colors moved off semantic
      // status tokens (danger/warning/success read as alarms) onto
      // neutral, visually distinct hues. Order is stable so a tenant's
      // competitor row keeps the same color across renders.
      const COMPETITOR_COLORS = [
        "stroke-[#64748B]/85", // slate
        "stroke-[#0EA5E9]/85", // sky
        "stroke-[#F59E0B]/85", // amber
        "stroke-[#EC4899]/85", // pink
      ];
      competitorSeries.slice(0, 4).forEach((c, i) => {
        s.push({
          label: c.name,
          data: c.points.map((p) => p.score),
          color: COMPETITOR_COLORS[i % COMPETITOR_COLORS.length],
          fillColor: "fill-transparent",
        });
      });
    }
    return s;
  }, [brandName, brandPoints, competitorSeries, showCompetitors, showPlatforms, brandSeriesByPlatform, cutoffDate]);

  const labels = brandPoints.map((p) => {
    // Format as "Apr 17" from "2026-04-17".
    const d = new Date(p.date + "T00:00:00Z");
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
  });

  // Map dated events to chart-visible indexes. Events whose date falls outside
  // the current time-range slice (e.g. a hurting event from 30d ago when viewing
  // 7d) are silently dropped.
  const chartEvents = useMemo(() => {
    const dateIdx = new Map(brandPoints.map((p, i) => [p.date, i]));
    return events
      .map((ev) => {
        const idx = dateIdx.get(ev.date);
        if (idx === undefined) return null;
        return { index: idx, tone: ev.tone, label: ev.label };
      })
      .filter((x): x is { index: number; tone: "danger" | "success" | "neutral"; label: string } => x !== null);
  }, [events, brandPoints]);

  return (
    <div className="rounded-lg border border-border/60 bg-surface-raised/30 px-5 pt-5 pb-4">
      {/* Header row: title + metric toggle + time range toggle.
       *
       * Phase 2B follow-up (2026-05-13): broke layout at `sm` (640px+)
       * because the toggle pair (~280px combined with whitespace-nowrap)
       * crowded the title block and the metric description wrapped
       * awkwardly. Pushed the row layout to `lg` (1024px+) so narrow
       * tablets and split-screen workspaces get the stacked layout
       * with the toggles below the title, no overlap. */}
      <div className="flex flex-col gap-3 mb-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
            {VISIBILITY_METRIC_LABELS[metric]}
          </h2>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            {VISIBILITY_METRIC_DESCRIPTIONS[metric]}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <TimeRangeToggle value={timeRange} onChange={setTimeRange} />
          <MetricToggle metric={metric} onChange={setMetric} />
        </div>
      </div>

      {/* Headline score + delta. Step 1.3 (master plan) — this delta is
          latest minus earliest INSIDE the visible window. Distinct from the
          leaderboard's "vs. previous N days" delta. Labelled "within this
          window" so the two never get confused. */}
      <div className="flex flex-col gap-1 mb-3">
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-bold tabular-nums">
            {headline.hasData ? `${headline.score.toFixed(1)}%` : "—"}
          </span>
          {headline.hasData && (
            <span
              className={cn(
                "text-sm font-semibold tabular-nums",
                headline.delta > 0
                  ? "text-status-success"
                  : headline.delta < 0
                    ? "text-status-danger"
                    : "text-muted-foreground",
              )}
              title="Change from earliest to latest sample in the visible window."
            >
              {headline.delta > 0 ? "+" : ""}
              {headline.delta.toFixed(1)} pt
            </span>
          )}
          {headline.hasData && (
            <span className="text-[10px] text-muted-foreground/70 self-center">
              within this window
            </span>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          {sampledDayCount} sampled day
          {sampledDayCount === 1 ? "" : "s"} in this{" "}
          {timeRange === ALL_TIME_WINDOW
            ? "all-time"
            : `${timeRange}-day`}{" "}
          window
        </p>
        {/* T3.1 — Trust Sprint score provenance disclosure. The trust
            label here is "directional" because the chart treats every
            sampled day equally (no down-weighting for partial coverage)
            and silently mixes native + historical_recovered rows on
            windows that touch pre-cutover dates. See
            docs/BEACON_SCORE_PROVENANCE_AUDIT_2026_05_06.md. */}
        {headline.hasData && metric === "composite" && (() => {
          const hasProofDays = brandPoints.some((p) => p.sampleSize >= 1 && p.sampleSize <= 9);
          const hasPartialDays = brandPoints.some(
            (p) => p.sampleSize >= 10 && p.sampleSize <= 79,
          );
          const earliestDate = brandPoints[0]?.date ?? null;
          const windowTouchesPreCutover =
            earliestDate != null && earliestDate < NATIVE_REGIME_START;
          const prov = buildOverallVisibilityProvenance({
            scorePct: headline.score,
            windowDays: timeRange,
            windowTouchesPreCutover,
            hasPartialDays,
            hasProofDays,
          });
          return <WhyThisNumber provenance={prov} />;
        })()}
      </div>

      {/* Chart */}
      {brandPoints.length >= 2 ? (
        <AreaChart
          series={series}
          labels={labels}
          events={chartEvents}
          height={180}
          showGrid
          responsive
        />
      ) : (
        <div className="h-[180px] flex items-center justify-center text-[12px] text-muted-foreground">
          Not enough data yet — refresh your connected data to add to this chart.
        </div>
      )}

      {/* Footer controls */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mt-3 text-[11px]">
        <label className="flex items-center gap-1.5 cursor-pointer">
          <input
            type="checkbox"
            checked={showCompetitors}
            onChange={(e) => setShowCompetitors(e.target.checked)}
            className="h-3 w-3 accent-muted-foreground"
          />
          <span className="text-muted-foreground">Compare competitors</span>
        </label>
        {Object.keys(brandSeriesByPlatform).length > 0 && (
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={showPlatforms}
              onChange={(e) => setShowPlatforms(e.target.checked)}
              className="h-3 w-3 accent-muted-foreground"
            />
            <span className="text-muted-foreground">Split by platform</span>
          </label>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric toggle \u2014 small pill switcher
// ---------------------------------------------------------------------------

function MetricToggle({
  metric,
  onChange,
}: {
  metric: VisibilityMetric;
  onChange: (m: VisibilityMetric) => void;
}) {
  // a11y #398: the active pill was conveyed by color only (bg-foreground), with
  // no toggle semantics for assistive tech. Mark the group as a tablist and
  // each pill as a tab with aria-selected, matching the ViewToggle pattern
  // already used elsewhere (src/components/viz/view-toggle.tsx).
  return (
    <div
      role="tablist"
      aria-label="Metric"
      className="inline-flex rounded-md border border-border/60 bg-surface-inset/30 p-0.5 shrink-0"
    >
      {METRICS.map((m) => (
        <button
          key={m}
          type="button"
          role="tab"
          aria-selected={metric === m}
          onClick={() => onChange(m)}
          className={cn(
            "px-2.5 py-1 rounded-sm text-[10px] font-semibold transition-colors whitespace-nowrap",
            metric === m
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {shortLabel(m)}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time range toggle \u2014 7d / 14d / 30d / 60d
// ---------------------------------------------------------------------------

function TimeRangeToggle({
  value,
  onChange,
}: {
  value: number;
  onChange: (days: number) => void;
}) {
  // a11y #398 (same defect class as the metric pills): active range was
  // color-only. Same tablist/tab + aria-selected treatment.
  return (
    <div
      role="tablist"
      aria-label="Time range"
      className="inline-flex rounded-md border border-border/60 bg-surface-inset/30 p-0.5 shrink-0"
    >
      {TIME_RANGES.map((r) => (
        <button
          key={r.days}
          type="button"
          role="tab"
          aria-selected={value === r.days}
          onClick={() => onChange(r.days)}
          className={cn(
            "px-2 py-1 rounded-sm text-[10px] font-semibold transition-colors whitespace-nowrap tabular-nums",
            value === r.days
              ? "bg-foreground text-background"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {r.label}
        </button>
      ))}
    </div>
  );
}

function shortLabel(m: VisibilityMetric): string {
  switch (m) {
    case "mention_rate":
      return "Mentions";
    case "citation_rate":
      return "Citations";
    case "composite":
      return "Overall";
  }
}
