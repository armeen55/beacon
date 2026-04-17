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
  /** Specific action to take */
  specificMove?: string | null;
  /** Which page section to target */
  targetSection?: string | null;
  /** Prior change where this move worked */
  priorSuccess?: { changeId: string; pagePath: string; description: string; citationDelta: number } | null;
  /** Per-engine expected signal timing */
  engineTiming?: { platform: string; medianDays: number; sampleCount: number }[] | null;
  /** Concrete expected metric */
  expectedMetric?: string | null;
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

/** Serialized experiment data for the proof line. */
export type TodayExperimentProof = {
  id: string;
  headline: string;
  status: string;
  daysSinceStart: number;
  citationDeltaPct: number | null;
  mentionDeltaPct: number | null;
  targetPagePath: string | null;
};

/* ── Component ── */

export function TodayClient({
  isDemoMode = false,
  scanPhaseFailed = false,
  summary,
  primaryAction = null,
  secondaryAction = null,
  moreActions = [],
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
  experimentProof = null,
  faqSchemaCoverage = null,
  platformDistribution = null,
  concentratedPlatform = null,
}: {
  isDemoMode?: boolean;
  scanPhaseFailed?: boolean;
  summary: TodaySummary;
  primaryAction?: TodayPrimaryAction | null;
  secondaryAction?: TodayPrimaryAction | null;
  moreActions?: TodayPrimaryAction[];
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
  experimentProof?: TodayExperimentProof | null;
  faqSchemaCoverage?: { covered: number; total: number } | null;
  platformDistribution?: { google_aio: number; chatgpt: number; perplexity: number; total: number } | null;
  concentratedPlatform?: "google_aio" | "chatgpt" | "perplexity" | null;
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

  // Primary brief item (the one thing to do)
  const primaryBriefItem = morningBrief?.items[0] ?? null;
  // Secondary items (go into "More")
  const secondaryBriefItems = morningBrief?.items.slice(1) ?? [];

  // Proof line — best available experiment or memory insight
  const proofLine = experimentProof
    ? formatExperimentProof(experimentProof)
    : morningBrief?.memoryInsights?.[0]
      ? formatMemoryProof(morningBrief.memoryInsights[0])
      : null;

  return (
    <div className="space-y-5 max-w-2xl">
      {/* ── Row 1: Trend — one number ── */}
      {morningBrief && (
        <TrendLine
          totalCitations={morningBrief.totalOwnedCitations}
          trendPct={morningBrief.trendPct}
          latestDataDate={morningBrief.latestDataDate}
        />
      )}

      {/* Platform distribution line */}
      {platformDistribution && platformDistribution.total > 0 && (
        <div className="text-[11px] text-muted-foreground -mt-2 tabular-nums">
          Visibility: Google {platformDistribution.google_aio}% · ChatGPT {platformDistribution.chatgpt}% · Perplexity {platformDistribution.perplexity}%
        </div>
      )}

      {/* ── Top-of-Today: scan banner + pending-changes review ──
          Moved to the very top (right below the Visibility line) so the
          operator sees pending changes without scrolling. The banner's
          "Review changes" button scrolls to the inline review card right
          below it (anchor id="change-review-section"). */}
      <TodayScanStrip
        shouldTriggerScan={shouldTriggerScan}
        pendingChangesCount={pendingContentChanges}
      />
      {onConfirmFinding && onDismissFinding && pendingFindings.length > 0 && (
        <ChangeReview
          findings={pendingFindings}
          onConfirm={onConfirmFinding}
          onDismiss={onDismissFinding}
        />
      )}

      {/* Removed: "Heavy reliance on [platform] — limited diversification" warning.
          Insight-without-action creates noise. Platform diversification is best
          handled as a brain-derived action when the pattern brain detects a
          pattern that moves a specific underweighted platform. Until then,
          showing the imbalance without a next step is analytics theater. */}

      {/* FAQ schema coverage warning — FAQ→schema only, not whether pages should have FAQ */}
      {faqSchemaCoverage && faqSchemaCoverage.covered < faqSchemaCoverage.total && (
        <div className="text-[11px] text-status-warning flex items-center gap-1.5 -mt-2">
          <span className="h-1.5 w-1.5 rounded-full bg-status-warning shrink-0" />
          FAQ schema: {faqSchemaCoverage.covered}/{faqSchemaCoverage.total} pages with FAQ have matching schema — {faqSchemaCoverage.total - faqSchemaCoverage.covered} pages need FAQPage JSON-LD
        </div>
      )}

      {/* ── Row 2: Primary action stack (brain-driven) ──
         Prefer brain actions (url-brain-recommender). Fall back to legacy
         MorningBrief primaryBriefItem ONLY if brain produced zero actions
         (rare — exploratory fallback guarantees ≥1 when citations exist). */}
      {primaryAction ? (
        <TodayActionQueue
          primaryAction={primaryAction as ActionCardAction | null}
          secondaryAction={secondaryAction as ActionCardAction | null}
          moreActions={moreActions as ActionCardAction[]}
          findings={findingsData}
          onRespondToRec={onRespondToRec}
          onStartExperiment={onStartExperiment}
          pending={pending}
          startTransition={startTransition}
          actionMsg={actionMsg}
          setActionMsg={setActionMsg}
          truthBlocked={truthBlocked}
        />
      ) : (
        primaryBriefItem && (
          <MorningBrief
            data={{
              ...morningBrief!,
              items: [primaryBriefItem],
              memoryInsights: [],
              competitorSummaries: [],
              competitorAlerts: [],
            }}
            compact
          />
        )
      )}

      {/* ── Row 3: Proof — system intelligence validation ── */}
      {proofLine && (
        <a
          href="/changes"
          className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-surface-inset/20 px-4 py-2.5 hover:bg-surface-inset/40 transition-colors group"
        >
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${proofLine.dot}`} />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 shrink-0">Latest signal</span>
          <span className="text-xs text-foreground/90 flex-1">{proofLine.text}</span>
          <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground shrink-0">→</span>
        </a>
      )}

      {/* ── More: everything else ── */}
      <details className="group">
        <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground transition-colors select-none py-2">
          <span className="inline-flex items-center gap-1.5 flex-wrap">
            <span className="transition-transform group-open:rotate-90">▶</span>
            Scoreboard, secondary actions, memory
            {secondaryBriefItems.length > 0 && (
              <span className="text-[10px] bg-accent-primary/10 text-accent-primary px-1.5 py-0.5 rounded-full tabular-nums">
                +{secondaryBriefItems.length} action{secondaryBriefItems.length !== 1 ? "s" : ""}
              </span>
            )}
            {pendingFindings.length > 0 && (
              <span className="text-[10px] bg-status-warning/10 text-status-warning px-1.5 py-0.5 rounded-full tabular-nums">
                {pendingFindings.length} change{pendingFindings.length !== 1 ? "s" : ""} detected
              </span>
            )}
            {(morningBrief?.competitorSummaries?.length ?? 0) > 0 && (
              <span className="text-[10px] bg-muted/50 text-muted-foreground px-1.5 py-0.5 rounded-full tabular-nums">
                competitor activity
              </span>
            )}
          </span>
        </summary>

        <div className="space-y-5 pt-3">
          {/* Secondary actions */}
          {secondaryBriefItems.length > 0 && morningBrief && (
            <MorningBrief
              data={{
                ...morningBrief,
                items: secondaryBriefItems,
                memoryInsights: [],
                competitorSummaries: [],
                competitorAlerts: [],
                trendPct: null,
                totalOwnedCitations: 0,
                latestDataDate: null,
              }}
              compact
            />
          )}

          {/* Memory insights */}
          {morningBrief && morningBrief.memoryInsights.length > 0 && (
            <MorningBrief
              data={{
                ...morningBrief,
                items: [],
                competitorSummaries: [],
                competitorAlerts: [],
                trendPct: null,
                totalOwnedCitations: 0,
                latestDataDate: null,
              }}
              compact
            />
          )}

          {/* Competitor activity */}
          {morningBrief && morningBrief.competitorSummaries.length > 0 && (
            <MorningBrief
              data={{
                ...morningBrief,
                items: [],
                memoryInsights: [],
                trendPct: null,
                totalOwnedCitations: 0,
                latestDataDate: null,
              }}
              compact
            />
          )}

          {/* Change review moved to top of Today (directly below Visibility line).
              See the TodayScanStrip + ChangeReview block near the top of the
              render tree. The in-place comment stays as a breadcrumb in case
              the decision is revisited. */}

          {/* Scoreboard + health */}
          <div className="grid grid-cols-1 lg:grid-cols-[2fr_3fr] gap-6">
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
            {/* Inner TodayActionQueue removed — the primary render above
               already shows the brain-driven stack. The "More" drawer now
               only carries health + findings context, not duplicate cards. */}
          </div>
        </div>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Compact trend line — one number, one trend, one freshness note
// ---------------------------------------------------------------------------

function TrendLine({
  totalCitations,
  trendPct,
  latestDataDate,
}: {
  totalCitations: number;
  trendPct: number | null;
  latestDataDate: string | null;
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

  const freshness = latestDataDate
    ? (() => {
        const days = Math.floor(
          (Date.now() - new Date(latestDataDate).getTime()) / 86_400_000,
        );
        if (days <= 1) return "Data current";
        if (days <= 3) return `Data ${days}d old`;
        return `Data ${days}d old — import fresh`;
      })()
    : null;

  return (
    <div className="flex items-baseline gap-3 flex-wrap">
      <span className="text-3xl font-bold tabular-nums">
        {totalCitations.toLocaleString()}
      </span>
      <span className="text-sm text-muted-foreground">AI citations</span>
      {trendPct !== null && (
        <span className={`text-sm font-medium ${color}`}>
          {arrow} {Math.abs(trendPct)}%
        </span>
      )}
      {freshness && (
        <span className="text-[11px] text-muted-foreground/60 ml-auto">
          {freshness}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Proof line formatters
// ---------------------------------------------------------------------------

function formatExperimentProof(exp: TodayExperimentProof): { text: string; dot: string } {
  const delta = exp.citationDeltaPct !== null
    ? `${exp.citationDeltaPct > 0 ? "+" : ""}${Math.round(exp.citationDeltaPct)}% citations`
    : "no data yet";
  const page = exp.targetPagePath ?? "tracked page";

  const statusLabel =
    exp.status === "promising" ? "Positive trend"
    : exp.status === "negative" ? "Declining"
    : exp.status === "inconclusive" ? "No clear signal"
    : "Watching";

  const dot =
    exp.status === "promising" ? "bg-status-success"
    : exp.status === "negative" ? "bg-status-danger"
    : "bg-muted-foreground/50";

  return {
    text: `${exp.headline}: ${delta} over ${exp.daysSinceStart}d (${statusLabel})`,
    dot,
  };
}

function formatMemoryProof(m: import("@/domains/product/morning-brief").SerializedMemoryInsight): { text: string; dot: string } {
  const delta = m.mentionsDeltaPct !== 0
    ? `${m.mentionsDeltaPct > 0 ? "+" : ""}${m.mentionsDeltaPct}%`
    : "stable";

  const dot =
    m.direction === "improving" ? "bg-status-success"
    : m.direction === "declining" ? "bg-status-danger"
    : "bg-muted-foreground/50";

  return {
    text: m.headline,
    dot,
  };
}
