"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type {
  MorningBriefItem,
  MorningBriefData,
  SerializedMemoryInsight,
  CompetitorSummary,
} from "@/domains/product/morning-brief";
import type { CompetitorAlert } from "@/domains/competitor-monitoring/types";
import {
  formatBriefItemForDevs,
  formatAllBriefsForEmail,
} from "@/domains/product/morning-brief";

// ---------------------------------------------------------------------------
// Data freshness indicator
// ---------------------------------------------------------------------------

// Metric-honesty fix #322 (2026-06-14): this line previously read
// "Data is current — last updated today" (green/success) whenever the
// latest data date was within ~1 day. Two problems a skeptical owner
// catches: (1) `diffDays <= 1` is true for YESTERDAY's data too, so it
// claimed "today" when the freshest reading was a day old; (2) the date
// is the latest OBSERVATION date, not a real "refresh" event — saying
// "last updated today" implies Beacon did something today when it may not
// have. Fixed to report the actual age of the latest reading honestly and
// only say "today" when diffDays is genuinely 0. Null/invalid date no
// longer collapses to a false "today" — it states the data date is
// unknown instead.
function DataFreshness({ date }: { date: string | null }) {
  const dataDate = date ? new Date(date) : null;
  if (!dataDate || Number.isNaN(dataDate.getTime())) {
    return (
      <p className="text-[11px] text-muted-foreground -mt-4 mb-2">
        Latest reading date unknown — refresh your connected data for a current picture
      </p>
    );
  }

  const now = new Date();
  const diffDays = Math.floor(
    (now.getTime() - dataDate.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays <= 0) {
    return (
      <p className="text-[11px] text-status-success -mt-4 mb-2">
        Latest reading is from today
      </p>
    );
  }

  if (diffDays === 1) {
    return (
      <p className="text-[11px] text-muted-foreground -mt-4 mb-2">
        Latest reading is from yesterday — refresh your connected data for today&apos;s picture
      </p>
    );
  }

  if (diffDays <= 3) {
    return (
      <p className="text-[11px] text-muted-foreground -mt-4 mb-2">
        Latest reading is {diffDays} days old — refresh your connected data for the latest insights
      </p>
    );
  }

  return (
    <p className="text-[11px] text-status-warning -mt-4 mb-2">
      Latest reading is {diffDays} days old — refresh your connected data to keep recommendations accurate
    </p>
  );
}

// ---------------------------------------------------------------------------
// Sparkline (simple inline SVG)
// ---------------------------------------------------------------------------

function TrendSparkline({
  trendPct,
  totalCitations,
}: {
  trendPct: number | null;
  totalCitations: number;
}) {
  const direction =
    trendPct === null ? "flat" : trendPct > 2 ? "up" : trendPct < -2 ? "down" : "flat";
  const color =
    direction === "up"
      ? "text-status-success"
      : direction === "down"
        ? "text-status-danger"
        : "text-muted-foreground";
  const arrow =
    direction === "up" ? "↑" : direction === "down" ? "↓" : "→";

  return (
    <div className="flex items-baseline gap-3 mb-6">
      <span className="text-2xl font-semibold tabular-nums">
        {totalCitations.toLocaleString()}
      </span>
      <span className="text-sm text-muted-foreground">times AI recommended you</span>
      {trendPct !== null && (
        <span className={cn("text-sm font-medium", color)}>
          {arrow} {Math.abs(trendPct)}%
          {direction === "up" ? " growing" : direction === "down" ? " declining" : ""}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Brief item card
// ---------------------------------------------------------------------------

function BriefCard({ item }: { item: MorningBriefItem }) {
  const [copied, setCopied] = useState(false);

  const isNeed = item.priority === "need";
  const borderColor = isNeed ? "border-l-status-danger" : "border-l-accent-primary";
  const badge = isNeed
    ? { text: "DO THIS FIRST", className: "bg-status-danger/10 text-status-danger" }
    : { text: "NEXT UP", className: "bg-accent-primary/10 text-accent-primary" };

  const handleCopy = useCallback(async () => {
    const text = formatBriefItemForDevs(item);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS
      const textarea = document.createElement("textarea");
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [item]);

  return (
    <div
      className={cn(
        "rounded-lg bg-card border border-border",
        "border-l-4",
        borderColor,
      )}
    >
      {/* ── Row 1: Badge + Headline + Copy — THE MOVE ── */}
      <div className="flex items-start justify-between gap-3 p-4 pb-2">
        <div className="flex-1 min-w-0">
          <span
            className={cn(
              "text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded inline-block mb-1.5",
              badge.className,
            )}
          >
            {badge.text}
          </span>
          <h3 className="text-[15px] font-semibold leading-snug">{item.headline}</h3>
          {item.keyReason && (
            <p className="text-[11px] text-muted-foreground mt-0.5">{item.keyReason}</p>
          )}
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className={cn(
            "shrink-0 text-xs px-2.5 py-1.5 rounded border transition-colors font-medium",
            copied
              ? "border-status-success text-status-success bg-status-success/10"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted",
          )}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* ── Row 2: Steps — pure execution, no interpretation ── */}
      <div className="px-4 pb-3 space-y-1">
        {item.steps.map((step, i) => (
          <div key={i} className="flex gap-2 text-[13px]">
            <span className="shrink-0 font-bold text-foreground/50 tabular-nums w-4 text-right">
              {i + 1}.
            </span>
            <span className="text-foreground font-medium whitespace-pre-wrap">{step}</span>
          </div>
        ))}
      </div>

      {/* ── Monitor line — separate from execution ── */}
      {item.monitorLine && (
        <div className="px-4 pb-2 text-[11px] text-muted-foreground/70 italic">
          {item.monitorLine}
        </div>
      )}

      {/* ── Row 3: Context + Why — collapsed detail ── */}
      <details className="border-t border-border/40 px-4 py-2 text-[11px] text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground/80 transition-colors select-none flex items-center gap-2">
          <span className="transition-transform group-open:rotate-90 text-[9px]">▶</span>
          <span>
            Why this action
            {item.contextLines.length > 0 && <> · {item.contextLines.length} data points</>}
            {item.citationCount > 0 && <> · {item.citationCount} citations</>}
          </span>
        </summary>
        <div className="pt-2 space-y-2">
          {/* Context lines */}
          {item.contextLines.length > 0 && (
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {item.contextLines.map((line, i) => (
                <span key={i} className="inline-flex items-center gap-1">
                  <span className="h-1 w-1 rounded-full bg-muted-foreground/40 shrink-0" />
                  {line}
                </span>
              ))}
            </div>
          )}
          {/* Rationale */}
          <p className="leading-relaxed">{item.rationale}</p>
          {item.aiContext && (
            <p className="leading-relaxed">{item.aiContext}</p>
          )}
        </div>
      </details>

      {/* Page link */}
      {item.pageUrl && (
        <div className="border-t border-border/40 px-4 py-2">
          <Link
            href={`/pages?url=${encodeURIComponent(item.pageUrl)}`}
            className="text-[11px] text-accent-primary hover:underline"
          >
            View page →
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Memory Insight card — "after your update X days ago — metrics moved"
// ---------------------------------------------------------------------------

function MemoryMiniSparkline({
  trendLine,
  changeIndex,
  direction,
}: {
  trendLine: SerializedMemoryInsight["trendLine"];
  changeIndex: number;
  direction: SerializedMemoryInsight["direction"];
}) {
  if (trendLine.length < 3) return null;

  const values = trendLine.map((p) => p.mentions + p.citations);
  const max = Math.max(...values, 1);
  const w = 120;
  const h = 28;
  const step = w / (values.length - 1 || 1);

  const points = values
    .map((v, i) => `${i * step},${h - (v / max) * (h - 4) - 2}`)
    .join(" ");

  const clampedIndex = Math.max(0, Math.min(changeIndex, values.length - 1));
  const markerX = clampedIndex * step;
  const lineColor =
    direction === "improving"
      ? "var(--color-status-success)"
      : direction === "declining"
        ? "var(--color-status-danger)"
        : "var(--color-muted-foreground)";

  return (
    <svg width={w} height={h} className="shrink-0">
      {/* Change date marker */}
      <line
        x1={markerX}
        y1={0}
        x2={markerX}
        y2={h}
        stroke="var(--color-accent-primary)"
        strokeWidth={1}
        strokeDasharray="2 2"
        opacity={0.6}
      />
      {/* Trend line */}
      <polyline
        points={points}
        fill="none"
        stroke={lineColor}
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MemoryInsightCard({ insight }: { insight: SerializedMemoryInsight }) {
  const isImproving = insight.direction === "improving";
  const isDeclining = insight.direction === "declining";
  const directionColor = isImproving
    ? "text-status-success"
    : isDeclining
      ? "text-status-danger"
      : "text-muted-foreground";
  const borderColor = isImproving
    ? "border-status-success/30 bg-status-success/5"
    : isDeclining
      ? "border-status-danger/30 bg-status-danger/5"
      : "border-border/60 bg-surface-inset/30";

  const deltaAbs = Math.abs(insight.mentionsDeltaPct);
  const deltaLabel = isImproving
    ? `+${deltaAbs}%`
    : isDeclining
      ? `-${deltaAbs}%`
      : "—";

  return (
    <div className={cn("flex items-center gap-3 rounded-lg border px-4 py-3", borderColor)}>
      <div className="flex flex-col items-center gap-0.5 shrink-0 w-12">
        <span className={cn("text-lg font-bold tabular-nums", directionColor)}>
          {deltaLabel}
        </span>
        <span className="text-[9px] text-muted-foreground tabular-nums">
          {insight.mentionsBefore}/d → {insight.mentionsAfter}/d
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium leading-snug">
          {insight.headline}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
          {insight.detail}
        </p>
      </div>
      <MemoryMiniSparkline
        trendLine={insight.trendLine}
        changeIndex={insight.changeIndex}
        direction={insight.direction}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Competitor activity — grouped by competitor with expandable page lists
// ---------------------------------------------------------------------------

function CompetitorRow({ summary }: { summary: CompetitorSummary }) {
  const [expanded, setExpanded] = useState(false);
  const totalChanges = summary.addedPages + summary.removedPages;
  const hasChanges = totalChanges > 0;

  return (
    <div className="rounded-lg border border-border/60 bg-surface-inset/30 overflow-hidden">
      {/* Summary row — always visible */}
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors",
          hasChanges ? "hover:bg-surface-inset/60" : "cursor-default",
        )}
        disabled={!hasChanges}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="min-w-0">
            <p className="text-xs font-semibold leading-snug truncate">
              {summary.displayName}
            </p>
            <p className="text-[10px] text-muted-foreground tabular-nums mt-0.5">
              {summary.totalPages.toLocaleString()} total pages
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {summary.addedPages > 0 && (
            <span className="text-[10px] font-bold text-status-warning tabular-nums px-1.5 py-0.5 rounded bg-status-warning/10">
              +{summary.addedPages} new
            </span>
          )}
          {summary.removedPages > 0 && (
            <span className="text-[10px] font-bold text-muted-foreground tabular-nums px-1.5 py-0.5 rounded bg-muted/30">
              -{summary.removedPages} removed
            </span>
          )}
          {hasChanges && (
            <span className="text-[10px] text-muted-foreground">
              {expanded ? "▲" : "▼"}
            </span>
          )}
        </div>
      </button>

      {/* Expanded: individual page changes */}
      {expanded && hasChanges && (
        <div className="border-t border-border/40 px-4 py-2 space-y-1.5">
          {summary.changes.slice(0, 10).map((alert, i) => (
            <div key={`${alert.path}-${i}`} className="flex items-start gap-2">
              <span className={cn(
                "shrink-0 text-[10px] font-bold mt-0.5",
                alert.changeType === "added" ? "text-status-warning" : "text-muted-foreground",
              )}>
                {alert.changeType === "added" ? "+" : "-"}
              </span>
              <div className="min-w-0">
                <p className="text-[11px] font-medium truncate">{alert.path}</p>
                <p className="text-[10px] text-muted-foreground line-clamp-1">{alert.detail}</p>
              </div>
            </div>
          ))}
          {summary.changes.length > 10 && (
            <p className="text-[10px] text-muted-foreground pt-1">
              + {summary.changes.length - 10} more changes
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export type MorningBriefProps = {
  data: MorningBriefData;
  /** When true, suppresses the trend header (parent renders it separately). */
  compact?: boolean;
};

export function MorningBrief({ data, compact = false }: MorningBriefProps) {
  const [copyAllPending, setEmailPending] = useState(false);

  const handleEmailAll = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10);
    const { subject, body } = formatAllBriefsForEmail(data.items, today);
    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.open(mailto, "_self");
  }, [data.items]);

  const handleCopyAll = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { body } = formatAllBriefsForEmail(data.items, today);
    try {
      await navigator.clipboard.writeText(body);
      setEmailPending(true);
      setTimeout(() => setEmailPending(false), 2000);
    } catch {
      // silent fail
    }
  }, [data.items]);

  if (data.items.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <p className="text-sm text-muted-foreground">
          No actions to recommend right now. Import fresh data or run a scan to generate recommendations.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Trend header + freshness — suppressed in compact mode (parent renders) */}
      {!compact && (
        <>
          <TrendSparkline
            trendPct={data.trendPct}
            totalCitations={data.totalOwnedCitations}
          />
          {data.latestDataDate && (
            <DataFreshness date={data.latestDataDate} />
          )}
        </>
      )}

      {/* Memory insights — metric trends following recent changes */}
      {data.memoryInsights.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Recent metric trends
          </h2>
          {data.memoryInsights.map((m) => (
            <MemoryInsightCard key={m.changeId} insight={m} />
          ))}
        </div>
      )}

      {/* Competitor activity — grouped by competitor */}
      {data.competitorSummaries.length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Competitor activity
          </h2>
          {data.competitorSummaries.map((summary) => (
            <CompetitorRow key={summary.domain} summary={summary} />
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 mb-2">
        <h2 className="text-sm font-medium text-muted-foreground flex-1">
          Today&apos;s actions
        </h2>
        <button
          type="button"
          onClick={handleCopyAll}
          className={cn(
            "text-xs px-2.5 py-1 rounded border transition-colors",
            copyAllPending
              ? "border-status-success text-status-success"
              : "border-border text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
        >
          {copyAllPending ? "Copied all" : "Copy all"}
        </button>
        <button
          type="button"
          onClick={handleEmailAll}
          className="text-xs px-2.5 py-1 rounded border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Email all
        </button>
      </div>

      {/* Brief cards */}
      <div className="space-y-3">
        {data.items.map((item) => (
          <BriefCard key={item.id} item={item} />
        ))}
      </div>

      {/* Freshness indicator — kept at bottom */}
      {data.latestDataDate && (
        <p className="text-[10px] text-muted-foreground/60 text-right">
          Based on data through {data.latestDataDate}
        </p>
      )}
    </div>
  );
}
