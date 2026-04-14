"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import type { TodaySummary } from "@/lib/today-summary";
import type { FindingPriority, PromotionStatus } from "@/domains/scanning/types";
import type { TodayProofContext } from "@/lib/today-proof-context";
import {
  isTodayTruthBlocked,
} from "@/lib/today-next-line";
import {
  deriveCoverageState,
  type CoverageState,
} from "@/lib/coverage-state";
import { sampleQualityTierFromObservationCount } from "@/lib/sample-quality-tier";
import { TodayScanStrip } from "@/components/today/today-scan-strip";
import { TodayScoreboard, type ScoreboardData } from "@/components/today/today-scoreboard";
import { TodayActionQueue, type FindingsStripData } from "@/components/today/today-action-queue";
import type { ActionCardAction } from "@/components/today/action-card";
import { MorningBrief } from "@/components/today/morning-brief";
import type { MorningBriefData } from "@/domains/product/morning-brief";
import { ChangeReview } from "@/components/today/change-review";

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
  /** AI answer context — mention rate, positioning, trend for matched topic */
  answerContext?: string | null;
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
  secondaryAction = null,
  morningBrief = null,
  scoreboard,
  onRespondToRec,
  onStartExperiment,
  pendingFindings = [],
  shouldTriggerScan = false,
  proofContext,
  localAttentionStrip = null,
  onConfirmFinding,
  onDismissFinding,
}: {
  isDemoMode?: boolean;
  scanPhaseFailed?: boolean;
  summary: TodaySummary;
  primaryAction?: TodayPrimaryAction | null;
  secondaryAction?: TodayPrimaryAction | null;
  morningBrief?: MorningBriefData | null;
  scoreboard: ScoreboardData;
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
  shouldTriggerScan?: boolean;
  proofContext: TodayProofContext;
  localAttentionStrip?: import("@/lib/local-presence").TodayLocalAttention | null;
  onConfirmFinding?: (findingId: string) => Promise<{ success: boolean; changeId?: string }>;
  onDismissFinding?: (findingId: string) => Promise<{ success: boolean }>;
}) {
  const [pending, startTransition] = useTransition();
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  const crawl = summary.crawl;
  const run = crawl.activeObservationRun;

  const crawlAgeDays = run?.completed_at
    ? Math.floor((Date.now() - new Date(run.completed_at).getTime()) / 86_400_000)
    : null;

  const coverageState: CoverageState = deriveCoverageState({
    crawlAgeDays,
    visibilityStaleVsCrawl: summary.visibility.staleVsCrawl,
    sampleQualityTier: sampleQualityTierFromObservationCount(proofContext.resultsRowCount),
    isDemoMode,
    treatMissingPrimaryCrawlAsNoData: !isDemoMode && !run,
  });

  const truthBlocked = useMemo(
    () =>
      isTodayTruthBlocked({
        scanPhaseFailed,
        crawlStale: crawlAgeDays !== null && crawlAgeDays > 14,
        visibilityStaleVsCrawl: summary.visibility.staleVsCrawl,
        coverageState,
        coverageTone: proofContext.crawlStale ? "degraded" : "ok",
      }),
    [scanPhaseFailed, crawlAgeDays, summary.visibility.staleVsCrawl, coverageState, proofContext.crawlStale],
  );

  // Findings strip data
  const findingsData: FindingsStripData = useMemo(() => ({
    totalCount: pendingFindings.length,
    criticalCount: pendingFindings.filter((f) => f.priority === "critical").length,
    importantCount: pendingFindings.filter((f) => f.priority === "important").length,
  }), [pendingFindings]);

  if (isDemoMode) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
          <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
            Import your data to see your real command center
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Today shows your visibility scoreboard and ranked actions once you import
            your first visibility data set.
          </p>
          <Link
            href="/settings/import"
            className="mt-4 inline-flex text-[13px] font-semibold text-accent-primary underline underline-offset-2 hover:text-accent-primary/85"
          >
            Go to Import →
          </Link>
        </div>
      </div>
    );
  }

  // Count content-type pending changes for scan banner
  const CONTENT_TYPES = new Set([
    "title_changed", "meta_changed", "h1_changed", "faq_changed",
    "schema_changed", "content_changed", "canonical_changed",
    "links_changed", "page_added", "page_removed",
  ]);
  const pendingContentChanges = pendingFindings.filter((f) => CONTENT_TYPES.has(f.type)).length;

  return (
    <div className="space-y-6">
      <TodayScanStrip
        shouldTriggerScan={shouldTriggerScan}
        pendingChangesCount={pendingContentChanges}
      />

      {/* Morning Brief — primary content */}
      {morningBrief && morningBrief.items.length > 0 && (
        <MorningBrief data={morningBrief} />
      )}

      {/* Change Review — detected changes from scan */}
      {onConfirmFinding && onDismissFinding && pendingFindings.length > 0 && (
        <div id="change-review-section">
          <ChangeReview
            findings={pendingFindings}
            onConfirm={onConfirmFinding}
            onDismiss={onDismissFinding}
          />
        </div>
      )}

      {/* Command center: two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
        {/* Left: Visibility Scoreboard */}
        <TodayScoreboard
          scoreboard={scoreboard}
          health={{
            coverageState,
            crawlAgeDays,
            hasScanRun: !!run,
            localNeedsAttention: !!localAttentionStrip,
            proofContext,
          }}
        />

        {/* Right: Action Queue */}
        <TodayActionQueue
          primaryAction={primaryAction as ActionCardAction | null}
          secondaryAction={secondaryAction as ActionCardAction | null}
          findings={findingsData}
          onRespondToRec={onRespondToRec}
          onStartExperiment={onStartExperiment}
          pending={pending}
          startTransition={startTransition}
          actionMsg={actionMsg}
          setActionMsg={setActionMsg}
          truthBlocked={truthBlocked}
        />
      </div>
    </div>
  );
}
