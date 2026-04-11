"use client";

import { useState, useEffect, useRef, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TodaySummary } from "@/lib/today-summary";
import type { ChangeVerdict, ImpactConfidence, ImpactDirection } from "@/domains/attribution/types";
import { PlatformSplit } from "@/components/viz/platform-split";
import { MiniBarChart } from "@/components/viz/mini-bar-chart";
import { KpiCard } from "@/components/viz/kpi-card";
import { ConfidenceBadge } from "@/components/viz/confidence-badge";

export type TodayImpactItem = {
  changeId: string;
  assetName: string;
  verdict: ChangeVerdict;
  confidence: ImpactConfidence;
  direction: ImpactDirection;
  nextAction: string;
  topScore: number | null;
  totalEvents: number;
  platforms: string[];
  href: string;
};

export type RecResponseStatus = "accepted" | "dismissed" | "deferred" | null;

export type TodayRecommendation = {
  id: string;
  type: string;
  headline: string;
  rationale: string;
  sourceEvidence: string;
  confidence: "high" | "medium" | "low";
  sourceChangeId: string | null;
  href: string;
  responseStatus?: RecResponseStatus;
  confidenceReason?: string;
};

export type TodayPrimaryAction = {
  id: string;
  headline: string;
  rationale: string;
  expectedOutcome: string;
  sourceEvidence: string;
  priorityScore: number;
  bucket: "critical" | "high_leverage" | "opportunistic";
  type: string;
  confidence: "high" | "medium" | "low";
  href: string;
  responseStatus?: RecResponseStatus;
  confidenceReason?: string;
  watchAfter?: string;
  dataFreshness?: string | null;
  hasExperiment?: boolean;
  targetPageUrl?: string | null;
  targetPagePath?: string | null;
  baselineCitations?: number | null;
};

export type TodayExperiment = {
  id: string;
  recId: string;
  headline: string;
  recType: string;
  targetPagePath: string | null;
  watchAfter: string;
  operatorNote: string;
  startedAt: string;
  status: string;
  daysSinceStart: number;
  baselineCitations: number | null;
  latestCitations: number | null;
  citDelta: number | null;
};

export type TodayTrackRecord = {
  totalActedOn: number;
  totalValidated: number;
  overallSuccessRate: number;
  totalExplicitAccepted?: number;
  totalExplicitDismissed?: number;
  outcomeTotal?: number;
  outcomePositiveRate?: number | null;
  outcomeAvgDelta?: number | null;
};

export type VisibilitySummary = {
  totalCitations: number;
  totalMentions: number;
  platformBreakdown: { platform: string; label: string; citations: number; mentions: number }[];
  dateRange: { from: string; to: string } | null;
  latestImportDate: string | null;
  trendPct: number | null;
  resultCount: number;
};

export type TodayQueueItem = {
  id: string;
  group: "fix" | "ship" | "frontier" | "verify" | "review" | "waiting" | "wins";
  plainGroup?: "fix_this" | "in_progress" | "wins";
  label: string;
  meta: string;
  href: string;
  dot: string;
  detail: string;
  issueId?: string;
  issueStatus?: string;
  pageUrl?: string;
  pagePath?: string;
  observationRunId?: string | null;
  observationRunHref?: string | null;
};

const GROUP_CONFIG: Record<string, { label: string; order: number }> = {
  fix_this: { label: "Queue", order: 0 },
  in_progress: { label: "In progress", order: 1 },
  wins: { label: "FYI", order: 2 },
};

/** Calm, legible experiment status — watchlist only (not raw enum strings). */
const WATCHLIST_STATUS_PRESENTATION: Record<
  string,
  { label: string; pill: string }
> = {
  testing: {
    label: "Actively testing",
    pill: "border-accent-primary/35 bg-accent-primary/10 text-accent-primary",
  },
  watching: {
    label: "Collecting signal",
    pill: "border-border/80 bg-muted/30 text-muted-foreground",
  },
  promising: {
    label: "Promising signal",
    pill: "border-status-success/35 bg-status-success/10 text-status-success",
  },
  inconclusive: {
    label: "Unclear so far",
    pill: "border-status-warning/35 bg-status-warning/10 text-status-warning",
  },
  negative: {
    label: "Trending down",
    pill: "border-status-danger/35 bg-status-danger/10 text-status-danger",
  },
  dropped: {
    label: "Removed",
    pill: "border-transparent bg-muted/20 text-muted-foreground line-through",
  },
};

const MANUAL_STATUS_OPTIONS: Array<{
  value: "testing" | "watching" | "promising" | "inconclusive" | "negative";
  label: string;
}> = [
  { value: "testing", label: "Actively testing" },
  { value: "watching", label: "Collecting signal" },
  { value: "promising", label: "Looks promising" },
  { value: "inconclusive", label: "Still unclear" },
  { value: "negative", label: "Trending negative" },
];

function formatExperimentStarted(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function recTypeDisplayLabel(recType: string): string {
  return REC_ACCENT[recType]?.label ?? recType.replace(/_/g, " ");
}

function WatchlistExperimentCard({
  exp,
  pending,
  onUpdateExperiment,
  startTransition,
  setActionMsg,
}: {
  exp: TodayExperiment;
  pending: boolean;
  onUpdateExperiment?: (
    id: string,
    status: "testing" | "watching" | "promising" | "inconclusive" | "negative" | "dropped",
  ) => Promise<{ success: boolean }>;
  startTransition: (cb: () => void) => void;
  setActionMsg: (s: string | null) => void;
}) {
  const st =
    WATCHLIST_STATUS_PRESENTATION[exp.status] ?? WATCHLIST_STATUS_PRESENTATION.watching;
  const typeLabel = recTypeDisplayLabel(exp.recType);

  let signalLine: ReactNode;
  if (exp.baselineCitations !== null && exp.latestCitations !== null) {
    signalLine = (
      <>
        <span className="tabular-nums font-medium text-foreground">
          {exp.latestCitations}
        </span>
        <span className="text-muted-foreground"> citations now</span>
        <span className="text-muted-foreground"> · baseline </span>
        <span className="tabular-nums font-medium text-foreground">
          {exp.baselineCitations}
        </span>
        {exp.citDelta !== null && exp.citDelta !== 0 && (
          <span
            className={cn(
              "tabular-nums font-semibold",
              exp.citDelta > 0 ? "text-status-success" : "text-status-danger",
            )}
          >
            {" "}
            ({exp.citDelta > 0 ? "+" : ""}
            {exp.citDelta})
          </span>
        )}
        {exp.citDelta === 0 && (
          <span className="text-muted-foreground"> · flat vs baseline</span>
        )}
      </>
    );
  } else if (exp.baselineCitations !== null) {
    signalLine = (
      <>
        <span className="text-muted-foreground">Baseline </span>
        <span className="tabular-nums font-medium text-foreground">
          {exp.baselineCitations}
        </span>
        <span className="text-muted-foreground">
          {" "}
          citations · waiting for a newer import to compare
        </span>
      </>
    );
  } else {
    signalLine = (
      <span className="text-muted-foreground">
        No baseline citation snapshot yet — next import will anchor the watch.
      </span>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2 gap-y-1.5">
            <span
              className={cn(
                "inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-xs font-medium",
                st.pill,
              )}
            >
              {st.label}
            </span>
            <span className="text-xs text-muted-foreground">
              Day {exp.daysSinceStart + 1} of watch · started{" "}
              {formatExperimentStarted(exp.startedAt)}
            </span>
          </div>

          <p className="text-sm font-semibold leading-snug text-foreground">{exp.headline}</p>

          <p className="text-xs text-muted-foreground leading-relaxed">
            <span className="font-medium text-foreground/90">{typeLabel}</span>
            {exp.targetPagePath ? (
              <>
                {" "}
                ·{" "}
                <span className="break-all text-foreground/80">{exp.targetPagePath}</span>
              </>
            ) : null}
          </p>

          <div className="rounded-md border border-border/50 bg-muted/20 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Citation readout · </span>
            {signalLine}
          </div>

          {exp.operatorNote ? (
            <p className="text-xs text-muted-foreground border-l-2 border-border/80 pl-2.5 leading-relaxed">
              <span className="font-medium text-foreground/80">Your note · </span>
              {exp.operatorNote}
            </p>
          ) : null}

          {exp.watchAfter ? (
            <details className="group/wa rounded-md border border-border/40 bg-surface-raised/30">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground list-none [&::-webkit-details-marker]:hidden hover:bg-muted/20 rounded-md">
                What Beacon is watching for
              </summary>
              <p className="px-3 pb-3 pt-0 text-xs text-muted-foreground leading-relaxed border-t border-border/30">
                {exp.watchAfter}
              </p>
            </details>
          ) : null}

          {onUpdateExperiment && exp.status !== "dropped" && (
            <details className="rounded-md border border-border/40">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted-foreground list-none [&::-webkit-details-marker]:hidden hover:text-foreground hover:bg-muted/15 rounded-md">
                Adjust outcome (optional)
              </summary>
              <div className="border-t border-border/30 px-3 py-3 space-y-3">
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  Override how this watch reads to you. Fresh imports still update citations and may
                  move status automatically when the delta is clear.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {MANUAL_STATUS_OPTIONS.filter((o) => o.value !== exp.status).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      disabled={pending}
                      onClick={() =>
                        startTransition(async () => {
                          await onUpdateExperiment(exp.id, o.value);
                          setActionMsg(`Watch marked: ${o.label}.`);
                        })
                      }
                      className="rounded-md border border-border/70 bg-background px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-muted/30 transition-colors disabled:opacity-50"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await onUpdateExperiment(exp.id, "dropped");
                      setActionMsg("Removed from watchlist.");
                    })
                  }
                  className="text-[11px] font-medium text-muted-foreground/70 hover:text-status-danger transition-colors disabled:opacity-50"
                >
                  Remove from watchlist
                </button>
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}

function formatScanTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const BUCKET_STYLE: Record<string, { border: string; bg: string; label: string; accent: string }> = {
  critical: { border: "border-status-danger", bg: "bg-status-danger/8", label: "Critical", accent: "text-status-danger" },
  high_leverage: { border: "border-status-success", bg: "bg-status-success/8", label: "High leverage", accent: "text-status-success" },
  opportunistic: { border: "border-accent-primary", bg: "bg-accent-primary/5", label: "Opportunistic", accent: "text-accent-primary" },
};

const REC_ACCENT: Record<string, { border: string; bg: string; dot: string; label: string }> = {
  replicate: { border: "border-status-success/30", bg: "bg-status-success/5", dot: "bg-status-success", label: "Apply pattern" },
  strengthen: { border: "border-status-warning/30", bg: "bg-status-warning/5", dot: "bg-status-warning", label: "Strengthen" },
  investigate: { border: "border-status-danger/30", bg: "bg-status-danger/5", dot: "bg-status-danger", label: "Investigate" },
  strengthen_structure: { border: "border-accent-primary/30", bg: "bg-accent-primary/5", dot: "bg-accent-primary", label: "Add structure" },
  improve_internal_links: { border: "border-accent-primary/30", bg: "bg-accent-primary/5", dot: "bg-accent-primary", label: "Add links" },
  refresh_content: { border: "border-status-warning/30", bg: "bg-status-warning/5", dot: "bg-status-warning", label: "Refresh" },
  competitive_displacement: { border: "border-status-danger/30", bg: "bg-status-danger/5", dot: "bg-status-danger", label: "Close gap" },
  cross_page_pattern: { border: "border-status-success/30", bg: "bg-status-success/5", dot: "bg-status-success", label: "Apply pattern" },
  topic_cluster_gap: { border: "border-accent-primary/30", bg: "bg-accent-primary/5", dot: "bg-accent-primary", label: "Expand" },
  refresh_stale_citation: { border: "border-status-warning/30", bg: "bg-status-warning/5", dot: "bg-status-warning", label: "Refresh" },
};

export function TodayClient({
  summary,
  visibilitySummary,
  items,
  impactSignals = [],
  recommendedMoves = [],
  primaryAction = null,
  trackRecord = null,
  onUpdateIssue,
  onVerifyIssue,
  onRespondToRec,
  experiments = [],
  onStartExperiment,
  onUpdateExperiment,
}: {
  summary: TodaySummary;
  visibilitySummary?: VisibilitySummary;
  items: TodayQueueItem[];
  impactSignals?: TodayImpactItem[];
  recommendedMoves?: TodayRecommendation[];
  primaryAction?: TodayPrimaryAction | null;
  trackRecord?: TodayTrackRecord | null;
  onUpdateIssue?: (
    issueId: string,
    status: string,
    meta?: { pageUrl?: string; pagePath?: string }
  ) => Promise<{ success: boolean }>;
  onVerifyIssue?: (
    issueId: string,
    pageUrl: string
  ) => Promise<{
    success: boolean;
    cleared: boolean;
    remaining: string[];
    summary: string;
    error?: string;
  }>;
  onRespondToRec?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred"
  ) => Promise<{ success: boolean }>;
  experiments?: TodayExperiment[];
  onStartExperiment?: (opts: {
    recId: string;
    headline: string;
    recType: string;
    targetPageUrl: string | null;
    targetPagePath: string | null;
    watchAfter: string;
    operatorNote: string;
    baselineCitations: number | null;
  }) => Promise<{ success: boolean; experimentId: string }>;
  onUpdateExperiment?: (
    id: string,
    status: "testing" | "watching" | "promising" | "inconclusive" | "negative" | "dropped"
  ) => Promise<{ success: boolean }>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const groups = Object.entries(GROUP_CONFIG)
    .map(([key, cfg]) => ({
      key,
      label: cfg.label,
      order: cfg.order,
      items: items.filter((i) => (i.plainGroup ?? "fix_this") === key),
    }))
    .filter((g) => g.items.length > 0)
    .sort((a, b) => a.order - b.order);

  const flatItems = groups.flatMap((g) => g.items);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const selected = flatItems[selectedIdx] ?? null;
  const queueWork = items.filter(
    (i) => i.plainGroup !== "wins" && i.group !== "waiting"
  ).length;

  const flatItemsRef = useRef(flatItems);
  const selectedIdxRef = useRef(selectedIdx);
  useEffect(() => {
    flatItemsRef.current = flatItems;
    selectedIdxRef.current = selectedIdx;
  }, [flatItems, selectedIdx]);

  useEffect(() => {
    const url = selectedIdx > 0 ? `/?i=${selectedIdx}` : "/";
    window.history.replaceState(null, "", url);
  }, [selectedIdx]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      )
        return;
      const len = flatItemsRef.current.length;
      if (e.key === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, Math.max(0, len - 1)));
      } else if (e.key === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        const sel = flatItemsRef.current[selectedIdxRef.current];
        if (sel) {
          e.preventDefault();
          router.push(sel.href);
        }
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [router]);

  useEffect(() => {
    const el = document.querySelector(`[data-today-idx="${selectedIdx}"]`);
    if (el) el.scrollIntoView({ block: "nearest" });
  }, [selectedIdx]);

  const crawl = summary.crawl;
  const vis = summary.visibility;
  const run = crawl.activeObservationRun;
  const [systemOpen, setSystemOpen] = useState(false);
  const [queueOpen, setQueueOpen] = useState(false);

  const importFreshness = (() => {
    if (!visibilitySummary?.latestImportDate) return null;
    const daysOld = Math.floor((new Date().getTime() - new Date(visibilitySummary.latestImportDate).getTime()) / 86_400_000);
    return { daysOld, stale: daysOld > 7 };
  })();

  const crawlAgeDays = run?.completed_at
    ? Math.floor((Date.now() - new Date(run.completed_at).getTime()) / 86_400_000)
    : null;
  const crawlStale = crawlAgeDays !== null && crawlAgeDays > 14;
  const visStale = vis.staleVsCrawl;
  const dataStale = importFreshness?.stale || crawlStale || visStale;

  return (
    <div className="space-y-6">
      {/* ── 0. Stale / freshness warnings — always visible ── */}
      {dataStale && (
        <div className="rounded-lg border border-status-warning/30 bg-status-warning/[0.05] px-4 py-3 space-y-1.5">
          <p className="text-[12px] font-semibold text-status-warning">Data freshness</p>
          {crawlStale && (
            <p className="text-[11px] text-foreground leading-relaxed">
              Last crawl was <span className="font-semibold">{crawlAgeDays} days ago</span>.
              Page structure data may not reflect current production HTML.
              <Link href="/pages" className="text-accent-primary hover:underline font-medium ml-1">Run crawl →</Link>
            </p>
          )}
          {!crawlStale && crawlAgeDays !== null && !visStale && importFreshness?.stale && (
            <p className="text-[11px] text-foreground leading-relaxed">
              Visibility data is <span className="font-semibold">{importFreshness.daysOld} days old</span>.
              Citation and mention counts may have changed.
              <Link href="/import" className="text-accent-primary hover:underline font-medium ml-1">Import fresh data →</Link>
            </p>
          )}
          {visStale && vis.staleNote && (
            <p className="text-[11px] text-foreground leading-relaxed">{vis.staleNote}</p>
          )}
        </div>
      )}

      {/* ── 1. Visibility summary — KPI strip + platform visual ── */}
      {visibilitySummary && visibilitySummary.resultCount > 0 && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <KpiCard
              label="Citations"
              value={visibilitySummary.totalCitations}
              delta={visibilitySummary.trendPct}
              deltaSuffix="%"
              size="lg"
            />
            <KpiCard
              label="Mentions"
              value={visibilitySummary.totalMentions}
              meta={visibilitySummary.dateRange ? `${visibilitySummary.dateRange.from} → ${visibilitySummary.dateRange.to}` : undefined}
            />
            <KpiCard
              label="Platforms"
              value={visibilitySummary.platformBreakdown.length}
              meta={visibilitySummary.platformBreakdown.slice(0, 2).map((p) => p.label).join(", ")}
            />
            <KpiCard
              label="Snapshots"
              value={visibilitySummary.resultCount}
              meta={importFreshness ? (importFreshness.stale ? `${importFreshness.daysOld}d old` : `${importFreshness.daysOld}d ago`) : undefined}
            />
          </div>
          {visibilitySummary.platformBreakdown.length > 1 && (
            <div className="rounded-lg border border-border/40 px-4 py-3">
              <PlatformSplit
                entries={visibilitySummary.platformBreakdown.slice(0, 5).map((p) => ({
                  platform: p.platform,
                  label: p.label,
                  value: p.citations > 0 ? p.citations : p.mentions,
                }))}
                title="Platform distribution"
              />
            </div>
          )}
        </div>
      )}

      {/* ── 2. Primary action ── */}
      {primaryAction ? (() => {
        const bs = BUCKET_STYLE[primaryAction.bucket] ?? BUCKET_STYLE.opportunistic;
        return (
          <div className={cn("rounded-lg border-2 px-5 pt-4 pb-5", bs.border, bs.bg)}>
            <div className="flex items-center gap-2 mb-3">
              <span className={cn("h-1.5 w-1.5 rounded-full", bs.accent.replace("text-", "bg-"))} />
              <span className={cn("text-[11px] font-semibold", bs.accent)}>{bs.label}</span>
            </div>
            <p className="text-base font-bold tracking-tight leading-snug mb-2">
              {primaryAction.headline}
            </p>
            <p className="text-[13px] text-muted-foreground leading-relaxed">
              {primaryAction.rationale}
              {primaryAction.expectedOutcome && (
                <span className="text-foreground/80"> → {primaryAction.expectedOutcome}</span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-3">
              <span className={cn(
                "font-medium",
                primaryAction.confidence === "high" ? "text-status-success" : primaryAction.confidence === "medium" ? "text-foreground" : "text-muted-foreground",
              )}>{primaryAction.confidence} confidence</span>
              {primaryAction.confidenceReason && <span> · {primaryAction.confidenceReason}</span>}
              {primaryAction.dataFreshness && <span> · {primaryAction.dataFreshness.toLowerCase()}</span>}
            </p>
            {primaryAction.watchAfter && (
              <p className="text-[11px] text-muted-foreground/50 mt-1">
                Watch after: {primaryAction.watchAfter.charAt(0).toLowerCase() + primaryAction.watchAfter.slice(1)}
              </p>
            )}
            <div className="flex items-center gap-3 mt-4 flex-wrap">
              {primaryAction.responseStatus !== "accepted" && (
                <>
                  {onStartExperiment && onRespondToRec && (
                    <button
                      onClick={() => {
                        const note = prompt("What did you change or plan to change? (short note)");
                        if (note === null) return;
                        startTransition(async () => {
                          await onRespondToRec(primaryAction.id, "accepted");
                          await onStartExperiment({
                            recId: primaryAction.id,
                            headline: primaryAction.headline,
                            recType: primaryAction.type,
                            targetPageUrl: primaryAction.targetPageUrl ?? null,
                            targetPagePath: primaryAction.targetPagePath ?? null,
                            watchAfter: primaryAction.watchAfter ?? "",
                            operatorNote: note,
                            baselineCitations: primaryAction.baselineCitations ?? null,
                          });
                          setActionMsg("Accepted & tracking — added to watchlist.");
                        });
                      }}
                      disabled={pending}
                      className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity"
                    >
                      Accept & test →
                    </button>
                  )}
                  {onRespondToRec && (
                    <button
                      onClick={() => startTransition(async () => { await onRespondToRec(primaryAction.id, "accepted"); setActionMsg("Accepted."); })}
                      disabled={pending}
                      className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Accept only
                    </button>
                  )}
                  {onRespondToRec && (
                    <>
                      <span className="text-border">·</span>
                      <button
                        onClick={() => startTransition(async () => { await onRespondToRec(primaryAction.id, "deferred"); setActionMsg("Deferred."); })}
                        disabled={pending}
                        className="text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                      >
                        Not now
                      </button>
                      <button
                        onClick={() => startTransition(async () => { await onRespondToRec(primaryAction.id, "dismissed"); setActionMsg("Dismissed."); })}
                        disabled={pending}
                        className="text-[11px] font-medium text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                      >
                        Dismiss
                      </button>
                    </>
                  )}
                </>
              )}
              {primaryAction.responseStatus === "accepted" && (
                <>
                  <Link
                    href={primaryAction.href}
                    className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity"
                  >
                    {primaryAction.hasExperiment ? "Continue" : "Go"} →
                  </Link>
                  {!primaryAction.hasExperiment && onStartExperiment && (
                    <button
                      onClick={() => {
                        const note = prompt("What did you change? (short note)");
                        if (note === null) return;
                        startTransition(async () => {
                          await onStartExperiment({
                            recId: primaryAction.id,
                            headline: primaryAction.headline,
                            recType: primaryAction.type,
                            targetPageUrl: primaryAction.targetPageUrl ?? null,
                            targetPagePath: primaryAction.targetPagePath ?? null,
                            watchAfter: primaryAction.watchAfter ?? "",
                            operatorNote: note,
                            baselineCitations: primaryAction.baselineCitations ?? null,
                          });
                          setActionMsg("Experiment started — added to watchlist.");
                        });
                      }}
                      disabled={pending}
                      className="text-[11px] font-medium text-accent-primary hover:text-accent-primary/80 transition-colors"
                    >
                      Start testing
                    </button>
                  )}
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-status-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                    {primaryAction.hasExperiment ? "Testing" : "Accepted"}
                  </span>
                </>
              )}
            </div>
          </div>
        );
      })() : (
        <div className="rounded-lg border border-border/60 bg-surface-raised/40 px-5 py-4">
          <p className="text-base font-semibold mb-1">{summary.nextMove.title}</p>
          <p className="text-[13px] text-muted-foreground leading-relaxed">
            {summary.nextMove.evidence}
          </p>
          <Link
            href={summary.nextMove.href}
            className="inline-flex mt-3 items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90"
          >
            Go →
          </Link>
        </div>
      )}

      {/* ── 3. Track record (momentum) ── */}
      {trackRecord && (trackRecord.totalActedOn > 0 || (trackRecord.totalExplicitAccepted ?? 0) > 0 || (trackRecord.outcomeTotal ?? 0) > 0) && (
        <div className="rounded-lg border border-border/40 px-4 py-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Momentum</span>
            {trackRecord.outcomeAvgDelta !== null && trackRecord.outcomeAvgDelta !== undefined && (
              <span className={cn(
                "text-[11px] font-bold tabular-nums",
                trackRecord.outcomeAvgDelta > 0 ? "text-status-success" : trackRecord.outcomeAvgDelta < 0 ? "text-status-danger" : "text-muted-foreground",
              )}>
                {trackRecord.outcomeAvgDelta > 0 ? "+" : ""}{trackRecord.outcomeAvgDelta} cit/action
              </span>
            )}
          </div>
          {((trackRecord.totalExplicitAccepted ?? 0) > 0 || trackRecord.totalActedOn > 0 || trackRecord.totalValidated > 0) && (
            <MiniBarChart
              entries={[
                ...(trackRecord.totalExplicitAccepted ? [{ label: "Accepted", value: trackRecord.totalExplicitAccepted, color: "bg-accent-primary" }] : []),
                ...(trackRecord.totalActedOn > 0 ? [{ label: "Acted on", value: trackRecord.totalActedOn, color: "bg-muted-foreground/30" }] : []),
                ...(trackRecord.totalValidated > 0 ? [{ label: "Confirmed positive", value: trackRecord.totalValidated, color: "bg-status-success" }] : []),
                ...((trackRecord.outcomeTotal ?? 0) > 0 ? [{ label: "Total outcomes", value: trackRecord.outcomeTotal!, color: "bg-border/40", meta: trackRecord.outcomePositiveRate !== null && trackRecord.outcomePositiveRate !== undefined ? `${Math.round(trackRecord.outcomePositiveRate * 100)}% positive rate` : "Not enough resolved data for rates" }] : []),
              ]}
              height={5}
            />
          )}
        </div>
      )}

      {/* ── 3b. Watchlist / experiments ── */}
      {experiments && experiments.length > 0 && (
        <section className="pt-3 border-t border-border/40">
          <div className="mb-4">
            <p className="text-xs text-muted-foreground">Follow-through</p>
            <h3 className="text-sm font-semibold text-foreground mt-0.5 tracking-tight">
              Experiments on your watchlist
            </h3>
            <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed max-w-xl">
              Living continuation of recommendations you chose to test. Citation counts refresh when
              you import; status can move on its own when the signal is clear — use this strip to
              remember what you changed and what you are judging.
            </p>
          </div>
          <div className="space-y-3">
            {experiments.map((exp) => (
              <WatchlistExperimentCard
                key={exp.id}
                exp={exp}
                pending={pending}
                onUpdateExperiment={onUpdateExperiment}
                startTransition={startTransition}
                setActionMsg={setActionMsg}
              />
            ))}
          </div>
        </section>
      )}

      {/* ── 4. What changed ── */}
      {impactSignals.length > 0 && (
        <div className="pt-2">
          <p className="text-xs font-semibold text-foreground mb-3">
            What changed
          </p>
          <div className="space-y-1.5">
            {impactSignals.map((s) => (
              <Link
                key={s.changeId}
                href={s.href}
                className={cn(
                  "block rounded-lg border px-4 py-2.5 hover:bg-surface-inset/50 transition-colors",
                  s.verdict === "validated"
                    ? "border-status-success/30 bg-status-success/5"
                    : s.verdict === "negative"
                      ? "border-status-danger/30 bg-status-danger/5"
                      : "border-border/60",
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className={cn(
                      "h-1.5 w-1.5 rounded-full shrink-0",
                      s.verdict === "validated" ? "bg-status-success"
                        : s.verdict === "negative" ? "bg-status-danger"
                        : s.verdict === "partial" ? "bg-status-warning"
                        : "bg-muted-foreground",
                    )} />
                    <span className="text-[13px] font-medium truncate">
                      {s.assetName}
                    </span>
                    <ConfidenceBadge level={s.confidence} size="sm" />
                  </div>
                  <span className="text-[11px] text-muted-foreground/60 shrink-0">
                    {s.totalEvents} event{s.totalEvents !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground line-clamp-1 leading-relaxed mt-0.5 ml-[14px]">
                  {s.nextAction}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* ── 5. Other opportunities ── */}
      {recommendedMoves.length > 0 && (
        <SecondaryOpportunities moves={recommendedMoves} onRespond={onRespondToRec} />
      )}

      {/* ── 6. Work queue (collapsed by default) ── */}
      {flatItems.length > 0 && (
        <div className="pt-1">
          <button
            onClick={() => setQueueOpen((v) => !v)}
            className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <span className={cn("transition-transform text-[9px]", queueOpen ? "rotate-90" : "")}>
              ▶
            </span>
            Work queue ({queueWork})
          </button>
          {queueOpen && (
            <div className="mt-3 grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-5">
              <div className="rounded-lg border border-border overflow-hidden bg-background">
                <div className="max-h-[calc(100vh-320px)] overflow-y-auto">
                  {groups.map((group) => (
                    <div key={group.key}>
                      <div className="px-3 py-1.5 border-b border-border/60">
                        <p className="text-[11px] font-semibold text-muted-foreground/60">
                          {group.label}
                        </p>
                      </div>
                      {group.items.map((item) => {
                        const idx = flatItems.indexOf(item);
                        return (
                          <button
                            key={item.id}
                            data-today-idx={idx}
                            onClick={() => {
                              setSelectedIdx(idx);
                              setActionMsg(null);
                            }}
                            className={cn(
                              "w-full text-left px-3 py-2.5 transition-colors border-b border-border/30 last:border-b-0",
                              idx === selectedIdx
                                ? "bg-accent-primary/8 border-l-[3px] border-l-accent-primary"
                                : "hover:bg-surface-inset/60 border-l-[3px] border-l-transparent"
                            )}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className={cn("h-[6px] w-[6px] rounded-full shrink-0", item.dot)} />
                              <p className="text-[11px] font-semibold truncate">{item.label}</p>
                            </div>
                            <p className="text-[9px] text-muted-foreground/70 truncate mt-0.5 ml-[18px]">
                              {item.meta}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-lg border border-border overflow-hidden bg-background">
                {selected ? (
                  <div className="overflow-y-auto max-h-[calc(100vh-320px)]">
                    <div className="px-6 pt-5 pb-4 border-b border-border/40">
                      <div className="flex items-center gap-2.5 mb-1.5">
                        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", selected.dot)} />
                        <h3 className="text-[15px] font-semibold tracking-tight">{selected.label}</h3>
                      </div>
                      <p className="text-[11px] text-muted-foreground/70">{selected.meta}</p>
                    </div>
                    <div className="px-6 py-5 space-y-5">
                      <p className="text-[12px] text-muted-foreground leading-relaxed">{selected.detail}</p>
                      {selected.observationRunHref && (
                        <p className="text-[10px] text-muted-foreground">
                          Evidence:{" "}
                          <Link href={selected.observationRunHref} className="text-accent-primary hover:underline font-medium">
                            Open run
                          </Link>
                        </p>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link
                          href={selected.href}
                          className="inline-flex items-center gap-2 rounded-md bg-accent-primary px-4 py-2 text-[11px] font-semibold text-white hover:bg-accent-primary/90 transition-colors"
                        >
                          {(selected.plainGroup ?? "fix_this") === "fix_this" ? "Open" : selected.plainGroup === "in_progress" ? "Check status" : "View"}
                          <span className="text-white/60">→</span>
                        </Link>
                        {selected.issueId && selected.issueStatus === "new" && onUpdateIssue && (
                          <button
                            onClick={() => startTransition(async () => { await onUpdateIssue(selected.issueId!, "dismissed", { pageUrl: selected.pageUrl, pagePath: selected.pagePath }); setActionMsg("Dismissed"); })}
                            disabled={pending}
                            className="px-3 py-2 rounded-md border border-border text-[10px] font-medium text-muted-foreground hover:bg-surface-inset transition-colors"
                          >
                            Dismiss
                          </button>
                        )}
                        {selected.issueId && (selected.issueStatus === "handed_off" || selected.issueStatus === "in_progress") && onUpdateIssue && (
                          <button
                            onClick={() => startTransition(async () => { await onUpdateIssue(selected.issueId!, "shipped", { pageUrl: selected.pageUrl, pagePath: selected.pagePath }); setActionMsg("Updated"); })}
                            disabled={pending}
                            className="px-3 py-2 rounded-md border border-accent-primary/30 text-[10px] font-semibold text-accent-primary hover:bg-accent-primary/10 transition-colors"
                          >
                            Mark shipped
                          </button>
                        )}
                        {selected.issueId && (selected.issueStatus === "shipped" || selected.issueStatus === "not_fixed") && selected.pageUrl && onVerifyIssue && (
                          <button
                            onClick={() => startTransition(async () => { const r = await onVerifyIssue(selected.issueId!, selected.pageUrl!); setActionMsg(r.success ? (r.cleared ? "Working" : r.summary) : `Issue: ${r.error?.slice(0, 60)}`); })}
                            disabled={pending}
                            className="px-3 py-2 rounded-md border border-status-success/30 text-[10px] font-semibold text-status-success hover:bg-status-success/10 transition-colors"
                          >
                            {pending ? "Checking…" : "Verify fix"}
                          </button>
                        )}
                        {selected.issueId && (selected.issueStatus === "verified" || selected.issueStatus === "dismissed") && onUpdateIssue && (
                          <button
                            onClick={() => startTransition(async () => { await onUpdateIssue(selected.issueId!, "new", { pageUrl: selected.pageUrl, pagePath: selected.pagePath }); setActionMsg("Re-opened"); })}
                            disabled={pending}
                            className="px-3 py-2 rounded-md border border-border text-[10px] font-medium text-muted-foreground hover:bg-surface-inset transition-colors"
                          >
                            Re-open
                          </button>
                        )}
                      </div>
                      {actionMsg && <p className="text-[10px] text-muted-foreground">{actionMsg}</p>}
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-48 text-[12px] text-muted-foreground/50">
                    Select an item · <span className="font-mono text-[10px] ml-1">j/k</span>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 7. Data sources ── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold text-foreground">Data sources</p>
          <button
            onClick={() => setSystemOpen((v) => !v)}
            className="text-[10px] text-accent-primary hover:underline font-medium"
          >
            {systemOpen ? "Less detail" : "More detail"}
          </button>
        </div>

        {/* ── Compact status (always visible) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className={cn(
            "rounded-lg border px-4 py-3 text-[11px]",
            crawlStale ? "border-status-warning/30 bg-status-warning/[0.03]" : "border-border/60",
          )}>
            <p className="font-semibold text-foreground mb-1">Website crawl</p>
            {run ? (
              <div className="space-y-1 text-muted-foreground">
                <p>{run.pages_scanned} pages · {run.pages_changed} changed · {run.pages_with_errors} errors</p>
                <p className={crawlStale ? "text-status-warning font-medium" : ""}>
                  {crawlAgeDays === 0 ? "Today" : crawlAgeDays === 1 ? "Yesterday" : `${crawlAgeDays} days ago`}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">No crawl on file. <Link href="/pages" className="text-accent-primary hover:underline font-medium">Run one →</Link></p>
            )}
          </div>
          <div className={cn(
            "rounded-lg border px-4 py-3 text-[11px]",
            importFreshness?.stale ? "border-status-warning/30 bg-status-warning/[0.03]" : "border-border/60",
          )}>
            <p className="font-semibold text-foreground mb-1">Visibility data</p>
            {visibilitySummary ? (
              <div className="space-y-1 text-muted-foreground">
                <p>{visibilitySummary.resultCount} samples · {visibilitySummary.totalCitations} citations</p>
                <p className={importFreshness?.stale ? "text-status-warning font-medium" : ""}>
                  {importFreshness ? (importFreshness.daysOld === 0 ? "Today" : `${importFreshness.daysOld} days old`) : "Unknown age"}
                </p>
              </div>
            ) : (
              <p className="text-muted-foreground">No visibility data. <Link href="/import" className="text-accent-primary hover:underline font-medium">Import →</Link></p>
            )}
          </div>
        </div>

        {/* ── Expanded details ── */}
        {systemOpen && (
          <div className="space-y-4 mt-1">
            <div className="rounded-lg border border-border bg-surface-raised/40 p-4 space-y-3">
              <p className="text-[10px] font-semibold text-muted-foreground">Crawl details</p>
              {crawl.hasObservationFile && run ? (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <KpiCard label="Pages Scanned" value={run.pages_scanned} />
                    <KpiCard label="Changed" value={run.pages_changed} delta={crawl.deltaVsPrior?.pagesChanged ?? null} />
                    <KpiCard label="Errors" value={run.pages_with_errors} />
                    <KpiCard label="Alerts" value={run.guardrail_alerts} />
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span>Completed {formatScanTime(run.completed_at)}</span>
                    {crawl.activeObservationHref && (
                      <Link href={crawl.activeObservationHref} className="text-accent-primary hover:underline font-medium">Open run →</Link>
                    )}
                  </div>
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">No crawl data yet. Run a scan from Pages.</p>
              )}
            </div>

            {/* Visibility observation */}
            <div className="rounded-lg border border-border bg-surface-raised/40 p-4 space-y-3">
              <p className="text-[10px] font-semibold text-muted-foreground">Visibility sample</p>
              {vis.hasObservationFile && vis.activeObservationRun ? (
                <div className="space-y-3">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{vis.activeObservationRun.scope_label}</p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <KpiCard label="Topics" value={vis.activeObservationRun.counts.topic_buckets} />
                    <KpiCard label="Rollup Rows" value={vis.activeObservationRun.counts.page_topic_rollup_rows} />
                    <KpiCard label="Citations" value={vis.activeObservationRun.counts.total_citations_accounted} />
                    <KpiCard label="Ext. Domains" value={vis.activeObservationRun.counts.distinct_external_domains_sampled} />
                  </div>
                  {vis.staleVsCrawl && vis.staleNote && (
                    <p className="text-[10px] text-status-warning font-medium">{vis.staleNote}</p>
                  )}
                  {vis.activeObservationHref && (
                    <Link href={vis.activeObservationHref} className="text-[10px] text-accent-primary hover:underline font-medium inline-block">Open visibility run →</Link>
                  )}
                </div>
              ) : (
                <p className="text-[11px] text-muted-foreground">No visibility sample loaded.</p>
              )}
              {summary.competitorLine && (
                <p className="text-[10px] text-muted-foreground border-t border-border/60 pt-2">{summary.competitorLine}</p>
              )}
            </div>

            {/* Review line */}
            <p className="text-[10px] text-muted-foreground border border-dashed border-border rounded-md px-3 py-2">
              <span className="font-semibold text-foreground">Attribution: </span>
              {summary.reviewHeuristicLine}
            </p>

            {/* Verified fixes */}
            {summary.verifiedFixes.length > 0 && (
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground mb-2">Recently verified</p>
                <ul className="space-y-1">
                  {summary.verifiedFixes.map((v) => (
                    <li key={v.issueId}>
                      <Link href={v.href} className="text-[11px] text-accent-primary hover:underline">{v.pagePath}</Link>
                      <span className="text-[10px] text-muted-foreground ml-2">
                        {v.summary.slice(0, 100)}{v.summary.length > 100 ? "…" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function SecondaryOpportunities({
  moves,
  onRespond,
}: {
  moves: TodayRecommendation[];
  onRespond?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred",
  ) => Promise<{ success: boolean }>;
}) {
  const [open, setOpen] = useState(false);
  const [, startT] = useTransition();

  return (
    <div className="pt-1">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors w-full"
      >
        <span className={cn("transition-transform text-[9px]", open ? "rotate-90" : "")}>
          ▶
        </span>
        Other opportunities ({moves.length})
      </button>
      {open && (
        <div className="space-y-2 mt-3">
          {moves.map((rec) => {
            const accent = REC_ACCENT[rec.type] ?? REC_ACCENT.replicate;
            return (
              <div
                key={rec.id}
                className={cn(
                  "rounded-lg border px-4 py-3 transition-colors",
                  accent.border,
                  accent.bg,
                )}
              >
                <Link href={rec.href} className="block hover:opacity-80 transition-opacity">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", accent.dot)} />
                      <span className="text-[13px] font-medium truncate">
                        {rec.headline}
                      </span>
                      {rec.responseStatus === "accepted" && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-status-success shrink-0">
                          <span className="h-1 w-1 rounded-full bg-status-success" />
                          Accepted
                        </span>
                      )}
                    </div>
                    <ConfidenceBadge level={rec.confidence as "high" | "medium" | "low"} />
                  </div>
                  <p className="text-[11px] text-muted-foreground line-clamp-1 leading-relaxed mt-0.5 ml-[14px]">
                    {rec.rationale}
                  </p>
                </Link>
                {onRespond && rec.responseStatus !== "accepted" && (
                  <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30 ml-[14px]">
                    <button
                      onClick={() => startT(async () => { await onRespond(rec.id, "accepted"); })}
                      className="text-[11px] font-medium text-status-success hover:text-status-success/80 transition-colors"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => startT(async () => { await onRespond(rec.id, "deferred"); })}
                      className="text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
                    >
                      Not now
                    </button>
                    <button
                      onClick={() => startT(async () => { await onRespond(rec.id, "dismissed"); })}
                      className="text-[11px] font-medium text-muted-foreground/40 hover:text-muted-foreground transition-colors"
                    >
                      Dismiss
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
