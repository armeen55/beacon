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

/**
 * Profound-style Visibility Score chart for Today.
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
  /** Full 60-day time series for brand, per metric. Sliced client-side to
   *  the selected time range. */
  brandSeriesByMetric: Record<VisibilityMetric, VisibilityPoint[]>;
  /** Full 60-day time series broken down by platform. Each platform's points
   *  only include dates where that platform was actually sampled \u2014 matches
   *  Profound's per-platform visibility view. Optional for backwards compat. */
  brandSeriesByPlatform?: Record<string, VisibilityPoint[]>;
  /** Top competitor series for "Compare competitors" toggle. */
  competitorSeriesByMetric: Record<
    VisibilityMetric,
    Array<{ name: string; points: VisibilityPoint[] }>
  >;
  /** Optional dated annotations \u2014 e.g. hurting verdicts. */
  events?: VisibilityChartEvent[];
};

const METRICS: VisibilityMetric[] = [
  "composite",
  "mention_rate",
  "citation_rate",
];

/** Time-range toggle options (days). Server sends 60d max; client slices. */
const TIME_RANGES: Array<{ days: number; label: string }> = [
  { days: 7, label: "7d" },
  { days: 14, label: "14d" },
  { days: 30, label: "30d" },
  { days: 60, label: "60d" },
];

export function VisibilityScoreChart({
  brandName,
  brandSeriesByMetric,
  brandSeriesByPlatform = {},
  competitorSeriesByMetric,
  events = [],
}: VisibilityChartProps) {
  const [metric, setMetric] = useState<VisibilityMetric>("composite");
  const [timeRange, setTimeRange] = useState<number>(14);
  const [showCompetitors, setShowCompetitors] = useState(false);
  const [showPlatforms, setShowPlatforms] = useState(false);

  const fullBrandPoints = brandSeriesByMetric[metric];
  const fullCompetitorSeries = competitorSeriesByMetric[metric];

  // Slice the full 60d series to the selected time range. The series has
  // already skipped zero-sample dates, so we take the last N actual points
  // (not last N calendar days) to avoid gaps.
  const brandPoints = useMemo(
    () => fullBrandPoints.slice(-timeRange),
    [fullBrandPoints, timeRange],
  );

  const competitorSeries = useMemo(
    () =>
      fullCompetitorSeries.map((c) => ({
        ...c,
        points: c.points.slice(-timeRange),
      })),
    [fullCompetitorSeries, timeRange],
  );

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
      const PLATFORM_COLORS: Record<string, string> = {
        "Google AI Overviews": "stroke-[#4285F4]/80",
        "ChatGPT": "stroke-[#10A37F]/80",
        "Perplexity": "stroke-[#0D9488]/80",
        "Claude": "stroke-[#C15F3C]/80",
      };
      const DEFAULT_PLATFORM_COLOR = "stroke-muted-foreground/60";
      // Need a date-indexed lookup so each platform's points align with the
      // shared x-axis (which is brandPoints' dates).
      const dateIdx = new Map(brandPoints.map((p, i) => [p.date, i]));
      for (const [platform, points] of Object.entries(brandSeriesByPlatform)) {
        if (points.length === 0) continue;
        const aligned: number[] = new Array(brandPoints.length).fill(NaN);
        for (const p of points.slice(-timeRange)) {
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
      const COMPETITOR_COLORS = [
        "stroke-status-danger/70",
        "stroke-status-warning/70",
        "stroke-status-success/60",
        "stroke-accent-secondary/70",
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
  }, [brandName, brandPoints, competitorSeries, showCompetitors, showPlatforms, brandSeriesByPlatform, timeRange]);

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
      {/* Header row: title + metric toggle + time range toggle */}
      <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-start sm:justify-between">
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

      {/* Headline score + delta */}
      <div className="flex items-baseline gap-2 mb-3">
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
          >
            {headline.delta > 0 ? "+" : ""}
            {headline.delta.toFixed(1)}%
          </span>
        )}
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
          Not enough data yet — check back after your next scan.
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
  return (
    <div className="inline-flex rounded-md border border-border/60 bg-surface-inset/30 p-0.5 shrink-0">
      {METRICS.map((m) => (
        <button
          key={m}
          type="button"
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
  return (
    <div className="inline-flex rounded-md border border-border/60 bg-surface-inset/30 p-0.5 shrink-0">
      {TIME_RANGES.map((r) => (
        <button
          key={r.days}
          type="button"
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
