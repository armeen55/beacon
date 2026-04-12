"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { AreaChart, type AreaSeries } from "@/components/viz/area-chart";
import {
  computeSeriesTrend,
  type PerformanceTimeseries,
  type CompetitorRankEntry,
  type DailyPoint,
} from "@/lib/performance-timeseries";

type CompetitorType = "direct" | "directory" | "editorial" | "forum" | "other";

const COMP_TYPE_LABELS: Record<CompetitorType, string> = {
  direct: "Direct competitor",
  directory: "Directory / listing",
  editorial: "Editorial / media",
  forum: "Forum / community",
  other: "Other",
};

const COMP_TYPE_COLORS: Record<CompetitorType, string> = {
  direct: "text-status-danger bg-status-danger/10 border-status-danger/20",
  directory: "text-muted-foreground bg-surface-inset/60 border-border/40",
  editorial: "text-accent-primary bg-accent-primary/10 border-accent-primary/20",
  forum: "text-status-warning bg-status-warning/10 border-status-warning/20",
  other: "text-muted-foreground bg-surface-inset/40 border-border/30",
};

type DatePreset = "7" | "14" | "28" | "custom" | "all";

function addDaysIso(isoDate: string, deltaDays: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  return dt.toISOString().slice(0, 10);
}

function filterByDatePreset(
  points: DailyPoint[],
  preset: DatePreset,
  customFrom: string,
  customTo: string,
): DailyPoint[] {
  if (points.length === 0) return points;
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const minD = sorted[0].date;
  const maxD = sorted[sorted.length - 1].date;

  if (preset === "all") return sorted;

  if (preset === "custom") {
    const from = (customFrom && customFrom >= minD ? customFrom : minD).slice(0, 10);
    const to = (customTo && customTo <= maxD ? customTo : maxD).slice(0, 10);
    if (from > to) return sorted.filter((p) => p.date >= to && p.date <= from);
    return sorted.filter((p) => p.date >= from && p.date <= to);
  }

  const span = preset === "7" ? 7 : preset === "14" ? 14 : 28;
  const startStr = addDaysIso(maxD, -(span - 1));
  return sorted.filter((p) => p.date >= startStr && p.date <= maxD);
}

function formatDate(d: string): string {
  const dt = new Date(d + "T00:00:00");
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export type TodayPerformanceProps = {
  timeseries: PerformanceTimeseries;
  competitorRank: CompetitorRankEntry[];
};

type ViewMode = "citations" | "mentions";
type CompetitorFilter = "all" | "direct" | "directory" | "editorial" | "forum";

type Verdict = {
  text: string;
  mood: "winning" | "growing" | "flat" | "declining" | "losing";
  icon: string;
};

function computeVerdict(
  trend: number | null,
  ownedRank: number | null,
  totalRanked: number,
  directAhead: number,
  directTotal: number,
): Verdict {
  if (trend !== null && trend >= 20) {
    return { text: `Gaining visibility fast (+${trend}%)`, mood: "winning", icon: "^" };
  }
  if (trend !== null && trend >= 5) {
    if (ownedRank === 1) {
      return { text: `Leading citation share and growing (+${trend}%)`, mood: "winning", icon: "^" };
    }
    return { text: `Visibility growing (+${trend}%)`, mood: "growing", icon: "^" };
  }
  if (trend !== null && trend <= -15) {
    if (directAhead > 0) {
      return { text: `Losing ground — ${directAhead} direct competitor${directAhead !== 1 ? "s" : ""} ahead of you`, mood: "losing", icon: "v" };
    }
    return { text: `Visibility declining (${trend}%)`, mood: "declining", icon: "v" };
  }
  if (trend !== null && trend <= -5) {
    return { text: `Slight decline (${trend}%) — watch closely`, mood: "declining", icon: "v" };
  }
  if (directAhead >= 3) {
    return { text: `${directAhead} direct competitors outperforming you`, mood: "losing", icon: "!" };
  }
  if (directAhead > 0 && directTotal > 0) {
    return { text: `Holding steady — ${directAhead} of ${directTotal} direct competitors ahead`, mood: "flat", icon: "-" };
  }
  if (ownedRank === 1) {
    return { text: "You lead citation share", mood: "winning", icon: "^" };
  }
  if (ownedRank && ownedRank <= 3 && totalRanked >= 5) {
    return { text: `Ranked #${ownedRank} in citation share`, mood: "growing", icon: "^" };
  }
  if (trend === null || trend === 0) {
    return { text: "Visibility stable — no significant movement", mood: "flat", icon: "-" };
  }
  return { text: "Visibility stable", mood: "flat", icon: "-" };
}

const MOOD_STYLES: Record<Verdict["mood"], { bg: string; border: string; text: string; dot: string }> = {
  winning: { bg: "bg-status-success/[0.06]", border: "border-status-success/25", text: "text-status-success", dot: "bg-status-success" },
  growing: { bg: "bg-status-success/[0.04]", border: "border-status-success/15", text: "text-status-success", dot: "bg-status-success/70" },
  flat: { bg: "bg-surface-inset/30", border: "border-border/50", text: "text-muted-foreground", dot: "bg-muted-foreground/40" },
  declining: { bg: "bg-status-warning/[0.05]", border: "border-status-warning/25", text: "text-status-warning", dot: "bg-status-warning" },
  losing: { bg: "bg-status-danger/[0.06]", border: "border-status-danger/25", text: "text-status-danger", dot: "bg-status-danger" },
};

const CHART_H = 240;

export function TodayPerformance({
  timeseries,
  competitorRank,
}: TodayPerformanceProps) {
  const { series, pointsByPlatform, platforms: platformOptions } = timeseries;

  const dataBounds = useMemo(() => {
    const pts = series.points;
    if (pts.length === 0) return { min: "", max: "" };
    const sorted = [...pts].sort((a, b) => a.date.localeCompare(b.date));
    return { min: sorted[0].date, max: sorted[sorted.length - 1].date };
  }, [series.points]);

  const [datePreset, setDatePreset] = useState<DatePreset>("28");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("citations");
  const [compFilter, setCompFilter] = useState<CompetitorFilter>("all");
  const [platformId, setPlatformId] = useState<string>("all");

  const customSeeded = useRef(false);
  useEffect(() => {
    if (customSeeded.current || !dataBounds.min || !dataBounds.max) return;
    setCustomFrom(addDaysIso(dataBounds.max, -27));
    setCustomTo(dataBounds.max);
    customSeeded.current = true;
  }, [dataBounds.min, dataBounds.max]);

  const basePoints = useMemo((): DailyPoint[] => {
    if (platformId === "all") return series.points;
    return pointsByPlatform[platformId] ?? [];
  }, [series.points, pointsByPlatform, platformId]);

  const filteredPoints = useMemo(
    () => filterByDatePreset(basePoints, datePreset, customFrom, customTo),
    [basePoints, datePreset, customFrom, customTo],
  );

  const field = viewMode === "citations" ? "citations" : "mentions";
  const trend = useMemo(
    () => computeSeriesTrend(filteredPoints, field),
    [filteredPoints, field],
  );

  const currentTotal = useMemo(
    () => filteredPoints.reduce((s, p) => s + p[field], 0),
    [filteredPoints, field],
  );

  const chartSeries: AreaSeries[] = useMemo(
    () => [
      {
        label: viewMode === "citations" ? "Citations" : "Mentions",
        data: filteredPoints.map((p) => p[field]),
        color: "var(--color-accent-primary)",
        fillColor: "var(--color-accent-primary)",
      },
    ],
    [filteredPoints, viewMode, field],
  );

  const chartLabels = useMemo(
    () => filteredPoints.map((p) => formatDate(p.date)),
    [filteredPoints],
  );

  const filteredRank = useMemo(() => {
    if (compFilter === "all") return competitorRank;
    return competitorRank.filter((r) => r.type === compFilter);
  }, [competitorRank, compFilter]);

  const ownedEntry = competitorRank.find((r) => r.isOwned);
  const ownedRank = ownedEntry ? competitorRank.indexOf(ownedEntry) + 1 : null;
  const directCompetitors = competitorRank.filter((r) => r.type === "direct" && !r.isOwned);
  const directAhead = ownedEntry
    ? directCompetitors.filter((r) => r.citations > ownedEntry.citations).length
    : 0;

  if (series.points.length < 2 && competitorRank.length === 0) return null;

  const verdict = computeVerdict(trend, ownedRank, competitorRank.length, directAhead, directCompetitors.length);
  const moodStyle = MOOD_STYLES[verdict.mood];

  const hasCompetitors = competitorRank.length > 0;
  const showCompFilters = hasCompetitors && competitorRank.length > 5;
  const showPlatformFilter = platformOptions.length > 1;

  const activePlatformLabel =
    platformId === "all"
      ? "All models"
      : (platformOptions.find((p) => p.platform === platformId)?.label ?? platformId);

  const datePresets: { id: DatePreset; label: string }[] = [
    { id: "7", label: "Last 7 days" },
    { id: "14", label: "Last 14 days" },
    { id: "28", label: "Last 28 days" },
    { id: "custom", label: "Custom range" },
    { id: "all", label: "All time" },
  ];

  return (
    <div className="space-y-4">
      <div className={cn("rounded-lg border px-4 py-3 flex items-center gap-3", moodStyle.bg, moodStyle.border)}>
        <span className={cn(
          "h-2.5 w-2.5 rounded-full shrink-0",
          moodStyle.dot,
          (verdict.mood === "winning" || verdict.mood === "losing") && "animate-pulse",
        )} />
        <p className={cn("text-[13px] font-semibold", moodStyle.text)}>
          {verdict.text}
        </p>
        {trend !== null && trend !== 0 && (
          <span className={cn("ml-auto text-[18px] font-bold tabular-nums shrink-0", moodStyle.text)}>
            {trend > 0 ? "+" : ""}{trend}%
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setViewMode("citations")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
                viewMode === "citations" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Citations
            </button>
            <button
              type="button"
              onClick={() => setViewMode("mentions")}
              className={cn(
                "rounded-md px-2.5 py-1 text-[10px] font-medium transition-colors",
                viewMode === "mentions" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Mentions
            </button>
          </div>
        </div>

        <div className="rounded-md border border-border/40 bg-surface-inset/20 px-3 py-2.5">
          <p className="mb-2 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Date range</p>
          <div className="flex flex-wrap gap-1.5">
            {datePresets.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setDatePreset(p.id)}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors",
                  datePreset === p.id
                    ? "border-accent-primary bg-accent-primary/10 text-foreground"
                    : "border-transparent text-muted-foreground hover:border-border/60 hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          {datePreset === "custom" && dataBounds.min && dataBounds.max && (
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border/30 pt-3">
              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-medium text-muted-foreground">From</span>
                <input
                  type="date"
                  min={dataBounds.min}
                  max={dataBounds.max}
                  value={customFrom || dataBounds.min}
                  onChange={(e) => setCustomFrom(e.target.value)}
                  className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-foreground"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[9px] font-medium text-muted-foreground">To</span>
                <input
                  type="date"
                  min={dataBounds.min}
                  max={dataBounds.max}
                  value={customTo || dataBounds.max}
                  onChange={(e) => setCustomTo(e.target.value)}
                  className="rounded-md border border-border/60 bg-background px-2 py-1 text-[11px] text-foreground"
                />
              </label>
            </div>
          )}
        </div>

        {showPlatformFilter && (
          <div>
            <p className="mb-1.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">Model</p>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setPlatformId("all")}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors",
                  platformId === "all"
                    ? "border-foreground bg-foreground text-background"
                    : "border-border/50 text-muted-foreground hover:text-foreground",
                )}
              >
                All models
              </button>
              {platformOptions.map((p) => (
                <button
                  key={p.platform}
                  type="button"
                  onClick={() => setPlatformId(p.platform)}
                  className={cn(
                    "rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors",
                    platformId === p.platform
                      ? "border-foreground bg-foreground text-background"
                      : "border-border/50 text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 items-stretch gap-4 lg:grid-cols-[minmax(0,1fr)_148px]">
        <div
          className={cn(
            "flex min-h-[260px] w-full min-w-0 flex-col overflow-hidden rounded-lg border",
            moodStyle.border,
            "bg-surface-raised/20",
          )}
        >
          {filteredPoints.length >= 2 ? (
            <div className="flex min-h-[240px] flex-1 flex-col px-1 pb-1 pt-0 lg:min-h-[260px]">
              <AreaChart series={chartSeries} labels={chartLabels} height={CHART_H} responsive className="min-h-0 flex-1" />
            </div>
          ) : (
            <p className="flex flex-1 items-center justify-center px-4 py-8 text-[11px] text-muted-foreground">
              Not enough data for this range or model. Try a wider date range or All models.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-2 lg:min-w-[148px]">
          <div className={cn("rounded-lg border px-3 py-2.5", moodStyle.border, "bg-surface-raised/20")}>
            <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">
              {viewMode === "citations" ? "Citations" : "Mentions"}
            </p>
            <p className="mt-0.5 text-[9px] text-muted-foreground">{activePlatformLabel}</p>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-xl font-bold tabular-nums tracking-tight">{currentTotal.toLocaleString()}</span>
              {trend !== null && trend !== 0 && (
                <span className={cn("text-[11px] font-semibold tabular-nums", moodStyle.text)}>
                  {trend > 0 ? "+" : ""}{trend}%
                </span>
              )}
            </div>
          </div>
          {ownedRank && (
            <div className={cn("rounded-lg border px-3 py-2.5", moodStyle.border, "bg-surface-raised/20")}>
              <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">Citation rank</p>
              <p className="mt-0.5 text-[9px] text-muted-foreground">All models (universe)</p>
              <div className="mt-0.5 flex items-baseline gap-1.5">
                <span className="text-xl font-bold tabular-nums tracking-tight">#{ownedRank}</span>
                <span className="text-[10px] text-muted-foreground">of {competitorRank.length}</span>
              </div>
            </div>
          )}
          {platformOptions.length > 0 && (
            <div className="rounded-lg border border-border/50 bg-surface-raised/20 px-3 py-2.5">
              <p className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground/70">Models in data</p>
              <p className="mt-0.5 text-[11px] font-medium text-foreground">{platformOptions.length} active</p>
              <p className="mt-0.5 truncate text-[9px] text-muted-foreground">
                {platformOptions.map((p) => p.label).join(", ")}
              </p>
            </div>
          )}
        </div>
      </div>

      {hasCompetitors && (
        <div className="overflow-hidden rounded-lg border border-border/50">
          <div className="flex items-center justify-between gap-3 border-b border-border/30 bg-surface-inset/20 px-4 py-2.5">
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold text-foreground">Citation share</p>
              {directAhead > 0 && (
                <span className="text-[10px] font-medium text-status-danger">
                  {directAhead} ahead of you
                </span>
              )}
            </div>
            {showCompFilters && (
              <div className="flex flex-wrap items-center gap-1">
                {([
                  { id: "all", label: "All" },
                  { id: "direct", label: "Direct" },
                  { id: "directory", label: "Directories" },
                  { id: "editorial", label: "Editorial" },
                  { id: "forum", label: "Forums" },
                ] as const)
                  .filter((f) => f.id === "all" || competitorRank.some((r) => r.type === f.id))
                  .map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setCompFilter(f.id as CompetitorFilter)}
                      className={cn(
                        "rounded px-2 py-0.5 text-[9px] font-medium transition-colors",
                        compFilter === f.id ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {f.label}
                    </button>
                  ))}
              </div>
            )}
          </div>
          <div className="divide-y divide-border/30">
            {filteredRank.slice(0, 10).map((entry, i) => {
              const rank = compFilter === "all" ? i + 1 : competitorRank.indexOf(entry) + 1;
              const typeStyle = COMP_TYPE_COLORS[entry.type as CompetitorType] ?? COMP_TYPE_COLORS.other;
              const beatsYou = ownedEntry && !entry.isOwned && entry.citations > ownedEntry.citations;
              return (
                <div
                  key={entry.domain}
                  className={cn(
                    "flex items-center gap-3 px-4 py-2 text-[11px]",
                    entry.isOwned && "bg-accent-primary/[0.04]",
                    beatsYou && entry.type === "direct" && "bg-status-danger/[0.03]",
                  )}
                >
                  <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground/50">{rank}.</span>
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className={cn(
                      "truncate font-medium",
                      entry.isOwned ? "text-accent-primary" : beatsYou && entry.type === "direct" ? "text-status-danger" : "text-foreground",
                    )}>
                      {entry.domain}
                    </span>
                    {entry.isOwned && (
                      <span className="shrink-0 rounded bg-accent-primary/10 px-1.5 py-0.5 text-[8px] font-bold text-accent-primary">YOU</span>
                    )}
                    {beatsYou && entry.type === "direct" && (
                      <span className="shrink-0 rounded bg-status-danger/10 px-1.5 py-0.5 text-[8px] font-bold text-status-danger">AHEAD</span>
                    )}
                    {!entry.isOwned && entry.type !== "direct" && (
                      <span className={cn("shrink-0 rounded border px-1 py-0.5 text-[8px] font-medium leading-none", typeStyle)}>
                        {COMP_TYPE_LABELS[entry.type as CompetitorType] ?? entry.type}
                      </span>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span className="font-semibold tabular-nums">{entry.share}%</span>
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border/30">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          entry.isOwned ? "bg-accent-primary"
                            : entry.type === "direct" ? "bg-status-danger/60"
                            : "bg-muted-foreground/30",
                        )}
                        style={{ width: `${Math.min(100, (entry.share / (filteredRank[0]?.share || 1)) * 100)}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
