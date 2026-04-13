"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { TodaySummary } from "@/lib/today-summary";
import type { FindingPriority, PromotionStatus } from "@/domains/scanning/types";
import type { TodayProofContext } from "@/lib/today-proof-context";
import { deriveCoverageTone } from "@/lib/today-proof-context";
import { shouldShowTodayAllClear, computeTodayDigest } from "@/lib/today-ritual";
import {
  isTodayTruthBlocked,
  isVisibilityCoverageStaleTruth,
} from "@/lib/today-next-line";
import { deriveTodayOneDecision } from "@/lib/today-one-decision";
import { TodayOneDecisionCard } from "@/components/today/today-one-decision-card";
import {
  deriveCoverageState,
  coverageAttentionForFindings,
  type CoverageState,
} from "@/lib/coverage-state";
import { sampleQualityTierFromObservationCount } from "@/lib/sample-quality-tier";
import { TodayScanStrip } from "@/components/today/today-scan-strip";
import { TodayPrimaryAction } from "@/components/today/today-primary-action";
import { TodayFindings } from "@/components/today/today-findings";
import { TodayVisibilitySnapshot } from "@/components/today/today-visibility-snapshot";
import { TodayLocalAttentionStrip } from "@/components/today/today-local-attention";
import type { TodayLocalAttention } from "@/lib/local-presence";
import { isKeyboardTypingTarget } from "@/lib/keyboard-shortcut-scope";
import { cn } from "@/lib/utils";

/* ── Shared serialization types (consumed by page.tsx, child components) ── */

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

export type RecResponseStatus = "accepted" | "dismissed" | "deferred" | null;

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

export type TodayMilestoneTeaser = {
  title: string;
  subtitle: string;
  proofSummary: string;
  achievedAt: string;
  magnitude?: "major" | "minor";
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

/* ── Component ── */

export function TodayClient({
  isDemoMode = false,
  scanPhaseFailed = false,
  summary,
  primaryAction = null,
  onRespondToRec,
  onStartExperiment,
  pendingFindings = [],
  acceptedAwaitingPromotionCount = 0,
  resolvedFindingsCount = 0,
  shouldTriggerScan = false,
  onResolveFinding,
  onPromoteFinding,
  proofContext,
  replicationSummary = null,
  localUrgentStrip = null,
  localAttentionStrip = null,
  milestoneTeaser = null,
}: {
  /** True when no import runs exist — same as shell demo mode (Phase 2A / `seed-data.server.ts`). */
  isDemoMode?: boolean;
  /** From `.data/scan-state.json` — last finished phase was `failed`. */
  scanPhaseFailed?: boolean;
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
  /** Accepted scan findings still awaiting promote decision — Today shows count + link only. */
  acceptedAwaitingPromotionCount?: number;
  resolvedFindingsCount?: number;
  /** When true, daily scan is due — ScanStatusBanner calls triggerScan on mount. */
  shouldTriggerScan?: boolean;
  onResolveFinding?: (findingId: string, status: string, opts?: { resolutionNote?: string; suppressDays?: number }) => Promise<{ success: boolean; consequence?: string }>;
  onPromoteFinding?: (findingId: string, promotionStatus: string) => Promise<{ success: boolean }>;
  proofContext: TodayProofContext;
  /** When set, Today shows a one-line link to Changes → Replicate instead of full replication cards. */
  replicationSummary?: { pageCount: number } | null;
  localUrgentStrip?: import("@/domains/local-operator/types").LocalTodayUrgentStrip | null;
  /** Track 1.4 Phase 4: passive local signal when listing/reviews need attention (null = healthy). */
  localAttentionStrip?: TodayLocalAttention | null;
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

  const coverageState: CoverageState = deriveCoverageState({
    crawlAgeDays,
    visibilityStaleVsCrawl: visStale,
    sampleQualityTier: sampleQualityTierFromObservationCount(proofContext.resultsRowCount),
    isDemoMode,
    treatMissingPrimaryCrawlAsNoData: !isDemoMode && !run,
  });

  const reviewPending = summary.reviewHeuristicLine.match(/(\d+)\s*pending/)?.[1] ?? null;

  const allClear = shouldShowTodayAllClear({
    pendingFindingsCount: pendingFindings.length,
    hasPrimaryAction: !!primaryAction,
    primaryResponseStatus: primaryAction?.responseStatus ?? null,
    crawlStale,
    visibilityStaleVsCrawl: visStale,
    coverageTone,
    coverageState,
    isDemoMode,
  });

  const actionableFindingsCount = pendingFindings.filter(
    (f) => f.priority === "critical" || f.priority === "important",
  ).length;
  const lowPriorityFindingsCount = pendingFindings.length - actionableFindingsCount;
  const hasCriticalFinding = pendingFindings.some((f) => f.priority === "critical");
  const coverageFindingsAttention = coverageAttentionForFindings(
    coverageState,
    hasCriticalFinding,
    actionableFindingsCount,
  );

  const truthBlocked = useMemo(
    () =>
      isTodayTruthBlocked({
        scanPhaseFailed,
        crawlStale,
        visibilityStaleVsCrawl: visStale,
        coverageState,
        coverageTone,
      }),
    [scanPhaseFailed, crawlStale, visStale, coverageState, coverageTone],
  );

  const hasImportedVisibility = useMemo(
    () =>
      proofContext.resultsRowCount > 0 ||
      Boolean(proofContext.visibilityCompletedAt) ||
      Boolean(proofContext.visibilityRunId) ||
      vis.hasObservationFile,
    [
      proofContext.resultsRowCount,
      proofContext.visibilityCompletedAt,
      proofContext.visibilityRunId,
      vis.hasObservationFile,
    ],
  );

  const hardVisibilityStale = useMemo(
    () =>
      isVisibilityCoverageStaleTruth({
        isDemoMode,
        scanPhaseFailed,
        visibilityStaleVsCrawl: visStale,
        coverageState,
        coverageTone,
      }),
    [isDemoMode, scanPhaseFailed, visStale, coverageState, coverageTone],
  );

  const digest = useMemo(() => {
    const d = computeTodayDigest({
      allClear,
      hasPrimaryAction: !!primaryAction,
      primaryResponseStatus: primaryAction?.responseStatus ?? null,
      actionableFindingsCount,
      lowPriorityFindingsCount,
      crawlStale,
      coverageState,
    });
    if (truthBlocked && d.criticalWorkDone) {
      return { criticalWorkDone: false, line: null as string | null };
    }
    return d;
  }, [
    truthBlocked,
    allClear,
    primaryAction,
    actionableFindingsCount,
    lowPriorityFindingsCount,
    crawlStale,
    coverageState,
  ]);

  const oneDecision = useMemo(
    () =>
      deriveTodayOneDecision({
        isDemoMode,
        scanPhaseFailed,
        hasImportedVisibility,
        crawlStale,
        visibilityStaleVsCrawl: visStale,
        coverageState,
        coverageTone,
        localUrgentStrip,
        localAttentionStrip,
        primaryAction,
        pendingFindings,
        allClear,
      }),
    [
      isDemoMode,
      scanPhaseFailed,
      hasImportedVisibility,
      crawlStale,
      visStale,
      coverageState,
      coverageTone,
      localUrgentStrip,
      localAttentionStrip,
      primaryAction,
      pendingFindings,
      allClear,
    ],
  );

  const primaryFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (isDemoMode) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isKeyboardTypingTarget(e.target)) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key !== "a") return;
      const el = primaryFocusRef.current;
      if (!el) return;
      if (el instanceof HTMLButtonElement && el.disabled) return;
      e.preventDefault();
      el.focus({ preventScroll: true });
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isDemoMode]);

  const autoFocusPrimary =
    !isDemoMode && !localUrgentStrip && !localAttentionStrip && !truthBlocked;

  return (
    <div className="space-y-6">
      <TodayScanStrip shouldTriggerScan={shouldTriggerScan} />

      <TodayOneDecisionCard d={oneDecision} />

      {!isDemoMode && (
      <>
      <div
        className={cn(
          "space-y-6",
          hardVisibilityStale && "opacity-[0.55] contrast-[0.97]",
        )}
      >
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

      {localAttentionStrip && (
        <TodayLocalAttentionStrip attention={localAttentionStrip} />
      )}

      {/* ── 1. Primary action — the single most important thing ── */}
      <TodayPrimaryAction
        primaryAction={primaryAction}
        nextMove={summary.nextMove}
        onRespondToRec={onRespondToRec}
        onStartExperiment={onStartExperiment}
        pending={pending}
        startTransition={startTransition}
        actionMsg={actionMsg}
        setActionMsg={setActionMsg}
        primaryFocusRef={primaryFocusRef}
        autoFocusPrimary={autoFocusPrimary}
        truthDataSecondary={truthBlocked}
        visibilityImportDeferred={hardVisibilityStale}
      />

      {/* ── 1b. Digest line — single-line completion signal ── */}
      {digest.line && (
        <p className="text-[11px] text-muted-foreground px-0.5 -mt-2">
          {digest.criticalWorkDone ? (
            <span className="text-status-success font-medium">{digest.line}</span>
          ) : (
            <span>{digest.line}</span>
          )}
        </p>
      )}

      {/* ── 2. Findings queue ── */}
      <TodayFindings
        pendingFindings={pendingFindings}
        resolvedFindingsCount={resolvedFindingsCount}
        scanCompletedAt={run?.completed_at ?? null}
        crawlAgeDays={crawlAgeDays}
        coverageState={coverageState}
        coverageFindingsAttention={coverageFindingsAttention}
        onResolveFinding={onResolveFinding}
        onPromoteFinding={onPromoteFinding}
        acceptedAwaitingPromotionCount={acceptedAwaitingPromotionCount}
        truthDataCompromised={truthBlocked}
        staleTruthDominant={hardVisibilityStale}
      />

      </div>

      {/* ── 3. Coverage / freshness / all-clear / system — bottom context block ── */}
      <TodayVisibilitySnapshot
        proofContext={proofContext}
        coverageTone={coverageTone}
        coverageState={coverageState}
        crawlStale={crawlStale}
        visStale={visStale}
        visStaleNote={vis.staleNote}
        crawlAgeDays={crawlAgeDays}
        allClear={allClear}
        resolvedFindingsCount={resolvedFindingsCount}
        primaryAccepted={primaryAction?.responseStatus === "accepted"}
        reviewPending={reviewPending}
        hasScanRun={!!run}
        hasObservationFile={vis.hasObservationFile}
        milestoneTeaser={milestoneTeaser}
        replicationSummary={replicationSummary}
        staleTruthGateActive={hardVisibilityStale}
      />
      </>
      )}
    </div>
  );
}
