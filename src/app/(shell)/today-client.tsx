"use client";

import { useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { TodaySummary } from "@/lib/today-summary";
import type { ChangeVerdict, ImpactConfidence, ImpactDirection } from "@/domains/attribution/types";
import { ConfidenceBadge } from "@/components/viz/confidence-badge";
import { FINDING_TYPE_LABELS, FINDING_PRIORITY_LABELS, PROMOTION_STATUS_LABELS } from "@/domains/scanning/types";
import type { FindingPriority, PromotionStatus } from "@/domains/scanning/types";
import { TodayPerformance, type TodayPerformanceProps } from "./today-performance";
import { HowWeKnowPanel } from "@/components/today/how-we-know-panel";
import type { TodayProofContext } from "@/lib/today-proof-context";
import { deriveCoverageTone } from "@/lib/today-proof-context";
import { shouldShowTodayAllClear } from "@/lib/today-ritual";
import { ReplicationCardsClient } from "@/components/replication/replication-cards-client";

export type SerializedFinding = {
  id: string;
  type: string;
  url: string;
  pagePath: string;
  detectedAt: string;
  previousState: string | null;
  currentState: string | null;
  severity: "high" | "medium" | "low";
  priority: FindingPriority;
  priorityScore: number;
  summary: string;
  suggestedAction: string;
  status: string;
  promotionStatus: PromotionStatus;
  citationCount: number;
  isHomepage: boolean;
  contradictsChangelog: boolean;
  /** Tier 1A: crawl comparison provenance */
  scanRunId?: string;
  provenanceSummary?: string;
  crawlProofHref?: string | null;
};

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
  /** Tier 1A: compact basis lines (same builder as primary) */
  lineageBullets?: string[];
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
  /** Tier 1A: link to scorecard row when recommendation is grounded in a change */
  sourceChangeId?: string | null;
  /** Tier 1A: bullet list shown under primary card */
  lineageBullets?: string[];
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

export type TodayMilestoneTeaser = {
  title: string;
  subtitle: string;
  proofSummary: string;
  achievedAt: string;
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
  primaryAction = null,
  onRespondToRec,
  onStartExperiment,
  pendingFindings = [],
  acceptedFindings = [],
  resolvedFindingsCount = 0,
  scanRanThisLoad = false,
  scanResult,
  onResolveFinding,
  onPromoteFinding,
  performanceData,
  proofContext,
  secondaryRecommendations = [],
  replicationCards = [],
  localUrgentStrip = null,
  milestoneTeaser = null,
}: {
  summary: TodaySummary;
  primaryAction?: TodayPrimaryAction | null;
  onRespondToRec?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred"
  ) => Promise<{ success: boolean }>;
  onStartExperiment?: (opts: {
    recId: string;
    headline: string;
    recType: string;
    targetPageUrl: string | null;
    targetPagePath: string | null;
    watchAfter: string;
    operatorNote: string;
    baselineCitations: number | null;
    replicationSourceChangeId?: string | null;
    replicationPatternId?: string | null;
    replicationEvidenceTier?: "observed" | "mixed" | "inferred";
  }) => Promise<{ success: boolean; experimentId: string }>;
  pendingFindings?: SerializedFinding[];
  acceptedFindings?: SerializedFinding[];
  resolvedFindingsCount?: number;
  scanRanThisLoad?: boolean;
  scanResult?: { pagesScanned?: number; pagesChanged?: number; alertCount?: number };
  onResolveFinding?: (findingId: string, status: string, opts?: { resolutionNote?: string; suppressDays?: number }) => Promise<{ success: boolean; consequence?: string }>;
  onPromoteFinding?: (findingId: string, promotionStatus: string) => Promise<{ success: boolean }>;
  performanceData?: TodayPerformanceProps | null;
  proofContext: TodayProofContext;
  secondaryRecommendations?: TodayRecommendation[];
  replicationCards?: import("@/domains/product/replication-serialize").SerializedReplicationCard[];
  localUrgentStrip?: import("@/domains/local-operator/types").LocalTodayUrgentStrip | null;
  milestoneTeaser?: TodayMilestoneTeaser | null;
}) {
  const [pending, startTransition] = useTransition();
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const crawl = summary.crawl;
  const vis = summary.visibility;
  const run = crawl.activeObservationRun;

  const crawlAgeDays = run?.completed_at
    ? Math.floor((Date.now() - new Date(run.completed_at).getTime()) / 86_400_000)
    : null;
  const crawlStale = crawlAgeDays !== null && crawlAgeDays > 14;
  const visStale = vis.staleVsCrawl;
  const coverageTone = deriveCoverageTone(proofContext);

  const reviewPending = summary.reviewHeuristicLine.match(/(\d+)\s*pending/)?.[1] ?? null;

  const allClear = shouldShowTodayAllClear({
    pendingFindingsCount: pendingFindings.length,
    hasPrimaryAction: !!primaryAction,
    primaryResponseStatus: primaryAction?.responseStatus ?? null,
    crawlStale,
    visibilityStaleVsCrawl: visStale,
    coverageTone,
  });

  return (
    <div className="space-y-6">
      {/* ── Scan confirmation banner ── */}
      {localUrgentStrip && (
        <div className="rounded-lg border-2 border-status-warning/35 bg-status-warning/[0.05] px-4 py-3">
          <p className="text-[11px] font-bold text-status-warning">{localUrgentStrip.title}</p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{localUrgentStrip.body}</p>
          <Link
            href={localUrgentStrip.href}
            className="inline-block mt-2 text-[11px] font-semibold text-accent-primary hover:underline"
          >
            Open local tasks →
          </Link>
        </div>
      )}

      {scanRanThisLoad && scanResult && (
        <div className="rounded-lg border-2 border-status-success/40 bg-status-success/[0.06] px-4 py-3.5">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-status-success animate-pulse shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-bold text-status-success">
                Scan complete — {new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </p>
              <p className="text-[12px] text-foreground mt-0.5">
                {scanResult.pagesScanned ?? 0} pages checked
                {(scanResult.pagesChanged ?? 0) > 0 ? (
                  <> · <span className="font-bold text-accent-primary">{scanResult.pagesChanged} changed</span></>
                ) : (
                  <> · <span className="text-status-success font-medium">no changes</span></>
                )}
                {(scanResult.alertCount ?? 0) > 0 && <> · <span className="font-semibold text-status-warning">{scanResult.alertCount} new alert{scanResult.alertCount !== 1 ? "s" : ""}</span></>}
                {pendingFindings.length > 0 && <> · <span className="font-bold text-accent-primary">{pendingFindings.length} finding{pendingFindings.length !== 1 ? "s" : ""} to review</span></>}
              </p>
            </div>
          </div>
        </div>
      )}

      <HowWeKnowPanel context={proofContext} variant="today" />
      <p className="text-[10px] text-muted-foreground px-0.5 -mt-2">
        <span className="font-medium text-foreground/90">Morning order:</span>{" "}
        clear scan findings → act on the top move (see Basis) → skim performance. Use Changes → Attribution when you need “why visibility moved.”
      </p>

      {milestoneTeaser && (
        <div className="rounded-lg border border-border/55 bg-surface-inset/25 px-4 py-3">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            Recent record
          </p>
          <p className="text-[13px] font-semibold text-foreground mt-1.5 leading-snug">
            {milestoneTeaser.title}
          </p>
          <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
            {milestoneTeaser.subtitle}
          </p>
          <p className="text-[10px] text-muted-foreground/90 mt-2 leading-relaxed">
            {milestoneTeaser.proofSummary}
          </p>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2">
            <span className="text-[9px] text-muted-foreground tabular-nums">
              {new Date(milestoneTeaser.achievedAt).toLocaleDateString(undefined, {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
            <Link
              href="/changes"
              className="text-[10px] font-medium text-accent-primary hover:underline"
            >
              Full history on Changes →
            </Link>
          </div>
        </div>
      )}

      {/* ── 1. Since last scan: findings verdict ── */}
      {pendingFindings.length === 0 && !scanRanThisLoad && (
        <div className="rounded-lg border border-border/60 overflow-hidden">
          <div className="px-4 py-3 bg-surface-inset/20 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-status-success" />
              <p className="text-[13px] font-semibold text-foreground">Since last scan</p>
              <span className="text-[11px] text-status-success font-medium">All clear</span>
            </div>
            {run?.completed_at && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {new Date(run.completed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}{" "}
                {new Date(run.completed_at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                {crawlAgeDays !== null && crawlAgeDays > 0 && (
                  <span className="text-muted-foreground/60"> ({crawlAgeDays}d ago)</span>
                )}
              </span>
            )}
          </div>
          <div className="px-4 py-2.5 text-[12px] text-muted-foreground">
            Nothing changed since the last scan. All pages match their previous state.
            {resolvedFindingsCount > 0 && (
              <span className="ml-1 text-foreground font-medium">{resolvedFindingsCount} previously resolved.</span>
            )}
          </div>
        </div>
      )}
      {pendingFindings.length > 0 && (() => {
        const criticalFindings = pendingFindings.filter((f) => f.priority === "critical");
        const importantFindings = pendingFindings.filter((f) => f.priority === "important");
        const minorFindings = pendingFindings.filter((f) => f.priority === "minor");
        const infoFindings = pendingFindings.filter((f) => f.priority === "informational");
        const fGroups = [
          { key: "critical", label: "Critical", findings: criticalFindings, accent: "text-status-danger", dot: "bg-status-danger" },
          { key: "important", label: "Important", findings: importantFindings, accent: "text-status-warning", dot: "bg-status-warning" },
          { key: "minor", label: "Minor", findings: minorFindings, accent: "text-muted-foreground", dot: "bg-muted-foreground/50" },
          { key: "informational", label: "FYI", findings: infoFindings, accent: "text-muted-foreground/60", dot: "bg-muted-foreground/30" },
        ].filter((g) => g.findings.length > 0);
        const hasCritical = criticalFindings.length > 0;
        const headerText = hasCritical
          ? `${criticalFindings.length} critical issue${criticalFindings.length !== 1 ? "s" : ""} need attention`
          : importantFindings.length > 0
            ? `${pendingFindings.length} change${pendingFindings.length !== 1 ? "s" : ""} detected — review needed`
            : `${pendingFindings.length} finding${pendingFindings.length !== 1 ? "s" : ""} since last scan`;
        return (
          <div className={cn(
            "rounded-lg border-2 overflow-hidden",
            hasCritical ? "border-status-danger/40" : "border-border/70",
          )}>
            <div className={cn(
              "px-4 py-3 border-b border-border/40 flex items-center justify-between gap-3",
              hasCritical ? "bg-status-danger/[0.06]" : "bg-surface-inset/30",
            )}>
              <div className="flex items-center gap-2">
                <span className={cn(
                  "h-2.5 w-2.5 rounded-full animate-pulse",
                  hasCritical ? "bg-status-danger" : "bg-accent-primary",
                )} />
                <p className={cn(
                  "text-[13px] font-bold",
                  hasCritical ? "text-status-danger" : "text-foreground",
                )}>
                  {headerText}
                </p>
              </div>
              {resolvedFindingsCount > 0 && (
                <span className="text-[10px] text-muted-foreground">{resolvedFindingsCount} resolved</span>
              )}
            </div>
            {fGroups.map((g) => (
              <div key={g.key}>
                <div className="px-4 py-1.5 bg-surface-inset/10 border-b border-border/30 flex items-center gap-2">
                  <span className={cn("h-1.5 w-1.5 rounded-full", g.dot)} />
                  <span className={cn("text-[10px] font-semibold uppercase tracking-wider", g.accent)}>
                    {g.label} · {g.findings.length}
                  </span>
                </div>
                <div className="divide-y divide-border/40">
                  {g.findings.map((f) => (
                    <FindingRow key={f.id} finding={f} onResolve={onResolveFinding} onPromote={onPromoteFinding} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Accepted findings awaiting promotion */}
      {acceptedFindings.length > 0 && acceptedFindings.some((f) => f.promotionStatus === "none") && (
        <div className="rounded-lg border border-status-success/30 overflow-hidden">
          <div className="px-4 py-2.5 bg-status-success/[0.03] border-b border-status-success/20 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
            <p className="text-[12px] font-semibold text-foreground">Accepted — decide what to do</p>
            <span className="text-[10px] text-muted-foreground">{acceptedFindings.filter((f) => f.promotionStatus === "none").length} awaiting</span>
          </div>
          <div className="divide-y divide-border/30">
            {acceptedFindings.filter((f) => f.promotionStatus === "none").map((f) => (
              <FindingRow key={f.id} finding={f} onPromote={onPromoteFinding} showPromotionOnly />
            ))}
          </div>
        </div>
      )}

      {/* ── 2. Primary action — always visible, above the fold ── */}
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
            {(primaryAction.lineageBullets && primaryAction.lineageBullets.length > 0) && (
              <div className="mt-3 rounded-md border border-border/40 bg-surface-inset/20 px-3 py-2">
                <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-1">Basis</p>
                <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-muted-foreground">
                  {primaryAction.lineageBullets.map((line, i) => (
                    <li key={i}>{line}</li>
                  ))}
                </ul>
                {primaryAction.sourceChangeId && (
                  <p className="mt-1.5 text-[10px]">
                    <Link
                      href={`/changes/${encodeURIComponent(primaryAction.sourceChangeId)}`}
                      className="text-accent-primary hover:underline font-medium"
                    >
                      View change record →
                    </Link>
                  </p>
                )}
              </div>
            )}
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
                          setActionMsg("Accepted & tracking — experiment started.");
                        });
                      }}
                      disabled={pending}
                      className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity"
                    >
                      Accept & test →
                    </button>
                  )}
                  {onRespondToRec && !onStartExperiment && (
                    <button
                      onClick={() => startTransition(async () => { await onRespondToRec(primaryAction.id, "accepted"); setActionMsg("Accepted."); })}
                      disabled={pending}
                      className="inline-flex items-center gap-2 rounded-md bg-foreground px-5 py-2.5 text-[13px] font-semibold text-background hover:opacity-90 transition-opacity"
                    >
                      Accept →
                    </button>
                  )}
                  {onRespondToRec && (
                    <>
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
                    Go →
                  </Link>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-status-success">
                    <span className="h-1.5 w-1.5 rounded-full bg-status-success" />
                    Accepted
                  </span>
                </>
              )}
            </div>
            {actionMsg && <p className="text-[10px] text-status-success mt-2 font-medium">{actionMsg}</p>}
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

      {secondaryRecommendations.length > 0 && (
        <SecondaryOpportunities
          moves={secondaryRecommendations}
          onRespond={onRespondToRec}
        />
      )}

      {replicationCards.length > 0 && onRespondToRec && onStartExperiment && (
        <ReplicationCardsClient
          cards={replicationCards}
          variant="today"
          respondToRecommendation={onRespondToRec}
          startExperimentAction={onStartExperiment}
        />
      )}

      {/* ── 3. Performance ── */}
      {performanceData && (
        <TodayPerformance
          timeseries={performanceData.timeseries}
          competitorRank={performanceData.competitorRank}
        />
      )}

      {/* ── 4. Coverage + freshness (merged) ── */}
      {(crawlStale || visStale || coverageTone === "partial") && (
        <div className={cn(
          "rounded-lg border-2 px-4 py-3 space-y-2",
          coverageTone === "critical"
            ? "border-status-danger/40 bg-status-danger/[0.06]"
            : coverageTone === "degraded"
              ? "border-status-warning/35 bg-status-warning/[0.05]"
              : "border-accent-primary/25 bg-accent-primary/[0.04]",
        )}>
          <div className="flex items-center gap-2">
            <span className={cn(
              "h-2.5 w-2.5 rounded-full shrink-0",
              coverageTone === "critical" ? "bg-status-danger animate-pulse"
                : coverageTone === "degraded" ? "bg-status-warning animate-pulse"
                : "bg-accent-primary",
            )} />
            <p className={cn(
              "text-[12px] font-bold",
              coverageTone === "critical" ? "text-status-danger"
                : coverageTone === "degraded" ? "text-status-warning"
                : "text-accent-primary",
            )}>
              {coverageTone === "critical"
                ? "Coverage critical — scan is very old"
                : coverageTone === "degraded"
                  ? "Coverage degraded — refresh soon"
                  : "Partial visibility sample"}
            </p>
          </div>
          <ul className="text-[11px] text-foreground leading-relaxed list-disc pl-4 space-y-1">
            {crawlStale && (
              <li>
                Website crawl is <span className="font-semibold tabular-nums">{crawlAgeDays}d</span> old — HTML findings may miss recent edits.
                <Link href="/pages" className="text-accent-primary hover:underline font-medium ml-1">Run scan →</Link>
              </li>
            )}
            {visStale && vis.staleNote && <li>{vis.staleNote}</li>}
            {coverageTone === "partial" && !visStale && (
              <li>
                {proofContext.visibilitySynthetic
                  ? "Visibility row is synthetic or demo-pinned — treat charts as directional, not ground truth until a real import is wired."
                  : "Citation rollup timestamp is missing or older than your crawl — sample may not reflect the latest HTML."}
              </li>
            )}
          </ul>
        </div>
      )}

      {/* ── 5. Done for today — completion state ── */}
      {allClear && (
        <div className="rounded-lg border-2 border-status-success/30 bg-status-success/[0.04] px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="h-3 w-3 rounded-full bg-status-success shrink-0" />
            <div>
              <p className="text-[13px] font-bold text-status-success">Nothing needs your attention</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {resolvedFindingsCount > 0 && <>{resolvedFindingsCount} finding{resolvedFindingsCount !== 1 ? "s" : ""} handled. </>}
                {primaryAction?.responseStatus === "accepted" && <>Top recommendation accepted. </>}
                Check back tomorrow.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── 6. System status — single line ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground px-1">
        <span className="font-medium text-foreground">System</span>
        <span>
          Scan: {run ? (crawlAgeDays === 0 ? "today" : crawlAgeDays === 1 ? "yesterday" : `${crawlAgeDays}d ago`) : <Link href="/pages" className="text-accent-primary hover:underline font-medium">not run</Link>}
        </span>
        <span className="text-border">·</span>
        <span>
          Visibility: {vis.hasObservationFile ? (visStale ? <span className="text-status-warning font-medium">stale</span> : "fresh") : <Link href="/settings/import" className="text-accent-primary hover:underline font-medium">no data</Link>}
        </span>
        {reviewPending && (
          <>
            <span className="text-border">·</span>
            <span>
              <Link href="/changes?tab=attribution" className="text-accent-primary hover:underline font-medium">{reviewPending} pending review</Link>
            </span>
          </>
        )}
        <span className="text-border">·</span>
        <Link href="/settings/health" className="text-accent-primary hover:underline font-medium">Details →</Link>
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
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={rec.href}
                    className="block min-w-0 flex-1 hover:opacity-90 transition-opacity"
                  >
                    <div className="flex items-center gap-2 min-w-0">
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
                    <p className="text-[11px] text-muted-foreground line-clamp-2 leading-relaxed mt-0.5 ml-[14px]">
                      {rec.rationale}
                    </p>
                  </Link>
                  <ConfidenceBadge level={rec.confidence as "high" | "medium" | "low"} />
                </div>
                {rec.lineageBullets && rec.lineageBullets.length > 0 && (
                  <div className="mt-2 ml-[14px] rounded border border-border/25 bg-surface-inset/15 px-2 py-1.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                      Basis
                    </p>
                    <ul className="list-disc pl-3 space-y-0.5 text-[9px] text-muted-foreground leading-snug">
                      {rec.lineageBullets.map((line, i) => (
                        <li key={i}>{line}</li>
                      ))}
                    </ul>
                  </div>
                )}
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

const PRIORITY_STYLE: Record<string, { badge: string; text: string }> = {
  critical: { badge: "bg-status-danger/10 text-status-danger border-status-danger/30", text: "text-status-danger" },
  important: { badge: "bg-status-warning/10 text-status-warning border-status-warning/30", text: "text-status-warning" },
  minor: { badge: "bg-muted/30 text-muted-foreground border-border/40", text: "text-muted-foreground" },
  informational: { badge: "bg-muted/20 text-muted-foreground/60 border-border/30", text: "text-muted-foreground/60" },
};

function FindingRow({
  finding,
  onResolve,
  onPromote,
  showPromotionOnly = false,
}: {
  finding: SerializedFinding;
  onResolve?: (id: string, status: string, opts?: { resolutionNote?: string; suppressDays?: number }) => Promise<{ success: boolean; consequence?: string }>;
  onPromote?: (id: string, promotionStatus: string) => Promise<{ success: boolean }>;
  showPromotionOnly?: boolean;
}) {
  const [, startT] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);
  const label = (FINDING_TYPE_LABELS as Record<string, string>)[finding.type] ?? finding.type;
  const ps = PRIORITY_STYLE[finding.priority] ?? PRIORITY_STYLE.minor;

  return (
    <div className="px-4 py-3 hover:bg-surface-inset/20 transition-colors">
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1 pt-0.5 shrink-0">
          <span className={cn("inline-flex items-center rounded border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider leading-none", ps.badge)}>
            {(FINDING_PRIORITY_LABELS as Record<string, string>)[finding.priority] ?? "—"}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[10px] font-medium text-muted-foreground bg-surface-inset/60 rounded px-1.5 py-0.5">
              {label}
            </span>
            <span className="text-[11px] font-mono text-muted-foreground truncate">{finding.pagePath}</span>
            {finding.citationCount > 0 && (
              <span className="text-[10px] text-muted-foreground/60">{finding.citationCount} citations</span>
            )}
            {finding.isHomepage && (
              <span className="text-[9px] font-semibold text-accent-primary bg-accent-primary/10 rounded px-1.5 py-0.5">Homepage</span>
            )}
            {finding.contradictsChangelog && (
              <span className="text-[9px] font-semibold text-status-danger bg-status-danger/10 rounded px-1.5 py-0.5">Mismatch</span>
            )}
            <span className="text-[10px] text-muted-foreground/50 tabular-nums ml-auto shrink-0">
              {new Date(finding.detectedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {" "}
              {new Date(finding.detectedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          </div>
          <p className="text-[12px] text-foreground mt-1 leading-snug">{finding.summary}</p>
          {finding.previousState && finding.currentState && (
            <div className="flex items-center gap-2 mt-1.5 text-[10px] text-muted-foreground">
              <span className="line-through truncate max-w-[40%]">{finding.previousState}</span>
              <span className="text-muted-foreground/40">→</span>
              <span className="font-medium text-foreground truncate max-w-[40%]">{finding.currentState}</span>
            </div>
          )}
          <p className="text-[10px] text-muted-foreground/70 mt-1">{finding.suggestedAction}</p>
          {(finding.provenanceSummary || finding.scanRunId) && (
            <div className="mt-2 rounded border border-border/30 bg-surface-inset/25 px-2 py-1.5 text-[10px] text-muted-foreground">
              <span className="font-semibold text-foreground/80">Basis: </span>
              {finding.provenanceSummary ?? "Compared consecutive full-site crawls."}
              {finding.crawlProofHref ? (
                <>
                  {" "}
                  <Link href={finding.crawlProofHref} className="text-accent-primary hover:underline font-medium">
                    View observation →
                  </Link>
                </>
              ) : finding.scanRunId ? (
                <span className="block text-[9px] text-muted-foreground/65 mt-1 leading-snug">
                  No observation index entry for this batch yet (id below).
                </span>
              ) : null}
              {finding.scanRunId && (
                <span className="block font-mono text-[9px] text-muted-foreground/60 mt-0.5 truncate" title={finding.scanRunId}>
                  Batch: {finding.scanRunId}
                </span>
              )}
            </div>
          )}
          {feedback && (
            <p className="text-[10px] text-status-success mt-1.5 font-medium">{feedback}</p>
          )}
        </div>
      </div>

      {/* Resolution actions */}
      {!showPromotionOnly && onResolve && finding.status === "pending" && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30 ml-8">
          <button
            onClick={() => startT(async () => {
              const r = await onResolve(finding.id, "accepted");
              if (r.consequence) setFeedback(r.consequence);
            })}
            className="text-[11px] font-medium text-status-success hover:text-status-success/80 transition-colors"
          >
            Accept
          </button>
          <button
            onClick={() => startT(async () => {
              const r = await onResolve(finding.id, "expected", { suppressDays: 14 });
              if (r.consequence) setFeedback(r.consequence);
            })}
            className="text-[11px] font-medium text-muted-foreground hover:text-muted-foreground/80 transition-colors"
          >
            Expected
          </button>
          <button
            onClick={() => startT(async () => {
              const r = await onResolve(finding.id, "ignored");
              if (r.consequence) setFeedback(r.consequence);
            })}
            className="text-[11px] font-medium text-muted-foreground/60 hover:text-muted-foreground transition-colors"
          >
            Ignore
          </button>
          <button
            onClick={() => startT(async () => {
              const r = await onResolve(finding.id, "rejected");
              if (r.consequence) setFeedback(r.consequence);
            })}
            className="text-[11px] font-medium text-muted-foreground/40 hover:text-muted-foreground transition-colors"
          >
            Not real
          </button>
        </div>
      )}

      {/* Promotion actions for accepted findings */}
      {(showPromotionOnly || finding.status === "accepted") && onPromote && finding.promotionStatus === "none" && (
        <div className="flex items-center gap-3 mt-2 pt-2 border-t border-border/30 ml-8">
          <span className="text-[10px] text-muted-foreground/60 mr-1">Promote:</span>
          <button
            onClick={() => startT(async () => {
              await onPromote(finding.id, "changelog");
              setFeedback("Promoted to changelog.");
            })}
            className="text-[11px] font-medium text-accent-primary hover:text-accent-primary/80 transition-colors"
          >
            Changelog
          </button>
          <button
            onClick={() => startT(async () => {
              await onPromote(finding.id, "secondary_note");
              setFeedback("Logged as secondary note.");
            })}
            className="text-[11px] font-medium text-muted-foreground hover:text-muted-foreground/80 transition-colors"
          >
            Secondary note
          </button>
          <button
            onClick={() => startT(async () => {
              await onPromote(finding.id, "history_only");
              setFeedback("Kept in history only.");
            })}
            className="text-[11px] font-medium text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            History only
          </button>
        </div>
      )}
      {finding.promotionStatus !== "none" && (
        <div className="flex items-center gap-2 mt-1.5 ml-8 text-[10px] text-muted-foreground/50">
          <span className="h-1 w-1 rounded-full bg-status-success/40" />
          {(PROMOTION_STATUS_LABELS as Record<string, string>)[finding.promotionStatus]}
        </div>
      )}
    </div>
  );
}
