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
import { SinceLastVisit } from "@/components/today/since-last-visit";
import { PollHealthBlock } from "@/components/today/poll-health-block";
import type { PollHealthSnapshot } from "@/domains/observations/poll-health";
import { EnrichmentBadges } from "@/components/today/enrichment-badges";
import { EnrichmentV2 } from "@/components/today/enrichment-v2";
import type {
  EnrichmentRollup,
  EnrichmentV2Data,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import { PromptsTeaser, type PromptsTeaserSummary } from "@/components/today/prompts-teaser";
import { TopPickCard, type TopPickSummary } from "@/components/today/top-pick-card";
import { TodayLifecycleStrip } from "@/components/today/lifecycle-strip";
import { TodayImplementationQueue } from "@/components/today/implementation-queue";
import { TodayDoNextCard } from "@/components/today/today-do-next-card";
import { TodayMetricsDisclosure } from "@/components/today/today-metrics-disclosure";
import { ActionCard, type ActionCardAction } from "@/components/today/action-card";
import { MorningBrief } from "@/components/today/morning-brief";
import type { MorningBriefData } from "@/domains/product/morning-brief";
import { ChangeReview } from "@/components/today/change-review";
import { VisibilityScoreChart } from "@/components/today/visibility-score-chart";
import { VisibilityLeaderboard } from "@/components/today/visibility-leaderboard";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import {
  CommandCenter,
  type CommandCenterUrlMovement,
} from "@/components/today/command-center";
import type { CommandCenterData } from "@/domains/today/command-center-data";
import {
  PollHealthCalmBanner,
  isPreCronPending,
} from "@/components/today/poll-health-calm-banner";
import type {
  VisibilityMetric,
  VisibilityPoint,
  EntityVisibility,
} from "@/domains/product/visibility-score";

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
  /** Fix 2 (2026-04-21): carried so accept handler can pass auto-link
   *  context (targetPageUrl + patternId) to the response store. */
  patternId?: string | null;
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
  todayFreshness = null,
  hostedScanDisabled = false,
  summary,
  primaryAction = null,
  secondaryAction = null,
  moreActions = [],
  measuredWins = [],
  morningBrief = null,
  scoreboard,
  onRespondToRec,
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
  visibilityData = null,
  urlVerdictProof = null,
  pollHealth = null,
  enrichmentRollup = null,
  enrichmentV2 = null,
  promptsTeaser = null,
  topPick = null,
  lifecycleSummary = null,
  firstReading = { isFirstReading: false },
  commandCenter = { hasAnyData: false, brain: null, manifest: null },
  commandCenterIsOperator = false,
}: {
  isDemoMode?: boolean;
  scanPhaseFailed?: boolean;
  /** Phase 3.5F: freshness signal for the data powering visibility / rankings.
   *  Null when the newest observation is within 3 days. (Named `todayFreshness`
   *  to avoid colliding with the existing `dataFreshness: string` on rec cards.) */
  todayFreshness?: {
    lastObservationDate: string;
    daysStale: number;
  } | null;
  /** Phase 3.5F: hide the hosted Scan-now strip on Vercel until Phase 4 ships. */
  hostedScanDisabled?: boolean;
  summary: TodaySummary;
  primaryAction?: TodayPrimaryAction | null;
  secondaryAction?: TodayPrimaryAction | null;
  moreActions?: TodayPrimaryAction[];
  /** Phase 3B (2026-04-20): helping_verdict cards rendered in a
   *  visibly-secondary "Wins to learn from" stripe below the action queue. */
  measuredWins?: TodayPrimaryAction[];
  morningBrief?: MorningBriefData | null;
  scoreboard: ScoreboardData;
  visibilityData?: {
    brandName: string;
    brandSeriesByMetric: Record<VisibilityMetric, VisibilityPoint[]>;
    brandSeriesByPlatform?: Record<string, VisibilityPoint[]>;
    leaderboardByMetric: Record<VisibilityMetric, EntityVisibility[]>;
    /** Step 1.3 (master plan) — leaderboard slices per chart-toggle window
     *  so the delta column re-binds when the operator switches 7d/14d/30d/60d. */
    leaderboardByMetricAndWindow?: Record<
      VisibilityMetric,
      Record<number, EntityVisibility[]>
    >;
    /** Anchor for the chart's calendar-date filter (today's UTC date). */
    chartEndDate?: string;
    competitorSeriesByMetric: Record<
      VisibilityMetric,
      Array<{ name: string; points: VisibilityPoint[] }>
    >;
    chartEvents?: Array<{ date: string; tone: "danger" | "success" | "neutral"; label: string }>;
  } | null;
  /** 2026-04-20: URL-level proof signal for "Latest signal" strip. Replaces
   *  topic-level MemoryInsight path. Null when no URL has a current `helping` verdict. */
  urlVerdictProof?: UrlVerdictProof | null;
  onRespondToRec?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred"
  ) => Promise<{ success: boolean }>;
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
  /** Commit 1 (2026-04-24): native-poll health for today's UTC date. Renders
   *  at top of Today so silent cron failures surface immediately. Null when
   *  the Supabase fetch failed at render-time (defensive — don't block Today
   *  on poll-health availability). */
  pollHealth?: PollHealthSnapshot | null;
  /** Commit 7C (2026-04-24): schema v2+v2.1 extraction rolled up as
   *  per-platform primary-recommendation rate, avg citation rank,
   *  descriptor chip cloud, answer-structure mix. Null when today (and
   *  yesterday) has no native observations yet.
   *  Superseded by `enrichmentV2` for the v2 layout (Step 2.3); kept as
   *  a fallback for any future surface that still wants the single-day
   *  rollup. */
  enrichmentRollup?: EnrichmentRollup | null;
  /** W2 Step 2.3 (master plan, 2026-05-01): full bundle for the 4-section
   *  "How AI described you this week" v2 layout. Built server-side from
   *  pure rollup helpers in enrichment-rollup.ts. Null on bundle-build
   *  failure — UI degrades to legacy enrichmentRollup. */
  enrichmentV2?: EnrichmentV2Data | null;
  /** Phase v5 Commit 5 (2026-04-24): per-category prompt-decision summary
   *  pointing into /prompts. Small teaser card, not a mini dashboard.
   *  Null when no active prompts. */
  promptsTeaser?: PromptsTeaserSummary | null;
  /** Phase v6 Commit 5 (2026-04-23): first row of the prioritized
   *  recommendations queue, surfaced as a single opinionated card above
   *  the prompts teaser. Null when the queue is empty. */
  topPick?: TopPickSummary | null;
  /** Phase 6A.7 (2026-04-28) — lifecycle counts + accepted-edit
   *  implementation queue. Computed in today-data.ts from the same
   *  recommended_edits read /changes uses, so the strip and the
   *  /changes tab counts always reconcile. */
  lifecycleSummary?: import("./today-data").TodayLifecycleSummary | null;
  /** Gap F.1 (2026-05-07) — first-reading waiting state. When
   *  `isFirstReading` is true, TodayClient short-circuits the regular
   *  dashboard and renders the FirstReadingWaiting card instead. */
  firstReading?: import(
    "@/domains/onboarding/first-reading-state"
  ).FirstReadingDetection;
  /** UX.2 (2026-05-07) — Command Center data slice. Read-only;
   *  reuses existing brain-health JSON + manifest artifacts. Cards
   *  render empty states when slices are null. */
  commandCenter?: CommandCenterData;
  /** UX.2 (2026-05-07) — operator-mode flag for the small
   *  /diagnostics/brain link at the bottom of the Command Center. */
  commandCenterIsOperator?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [actionMsg, setActionMsg] = useState<string | null>(null);

  // Step 1.3 (master plan) — chart's selected window is hoisted here so the
  // leaderboard's delta column tracks the same toggle. Keep the default at
  // 14d to match the prior single-leaderboard behaviour.
  const [visibilityWindow, setVisibilityWindow] = useState<number>(14);

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

  // Findings strip data. Human-readable type-breakdown label replaces the old
  // "65 things to check" jargon (2026-04-19): pick the top 2 types, label them
  // by what they actually are (missing FAQ, low extractability, etc.).
  const findingsData: FindingsStripData = useMemo(() => {
    const TYPE_LABEL: Record<string, string> = {
      faq_without_schema: "missing FAQ schema",
      schema_invalid: "invalid schema",
      low_extractability: "low extractability",
      robots_txt_blocked: "robots blocked",
      deploy_mismatch: "deploy mismatch",
      missing_h1: "missing H1",
      missing_meta_description: "missing meta description",
      duplicate_title: "duplicate title",
      thin_content: "thin content",
    };
    const counts = new Map<string, number>();
    for (const f of pendingFindings) {
      counts.set(f.type, (counts.get(f.type) ?? 0) + 1);
    }
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 2);
    const rest = sorted.slice(2).reduce((acc, [, n]) => acc + n, 0);
    const topLabel = top
      .map(([type, n]) => `${n} ${TYPE_LABEL[type] ?? type.replace(/_/g, " ")}`)
      .join(" \u00b7 ");
    const restLabel = rest > 0 ? ` \u00b7 ${rest} other` : "";
    const typeBreakdownLabel = pendingFindings.length > 0 && topLabel
      ? `${topLabel}${restLabel}`
      : null;
    return {
      totalCount: pendingFindings.length,
      criticalCount: pendingFindings.filter((f) => f.priority === "critical").length,
      importantCount: pendingFindings.filter((f) => f.priority === "important").length,
      typeBreakdownLabel,
    };
  }, [pendingFindings]);

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

  // Gap F.1 (2026-05-07) — first-reading waiting state. Replaces the
  // regular /today dashboard with a friendly "preparing your first
  // reading" card when a freshly launched tenant has prompts but no
  // observations yet. Mature tenants (Ritz) have observations →
  // isFirstReading=false → flow falls through to the regular
  // dashboard render below.
  if (firstReading.isFirstReading) {
    return <FirstReadingWaiting context={firstReading.context} />;
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

  // Proof line \u2014 URL-level verdict (Z-score engine) first, then experiment
  // fallback. 2026-04-20: topic-level MemoryInsight proof source removed
  // (produced false causal claims from topic-aggregated deltas).
  const proofLine = urlVerdictProof
    ? formatUrlVerdictProof(urlVerdictProof)
    : experimentProof
      ? formatExperimentProof(experimentProof)
      : null;

  // UX.2 (2026-05-07) — Top movement payload for the Command Center.
  // Reuses the already-loaded urlVerdictProof; null when no helping
  // URL is currently in proof-eligible state.
  const topMovementForCommandCenter: CommandCenterUrlMovement = urlVerdictProof
    ? {
        pagePath: urlVerdictProof.pagePath,
        deltaLabel: urlVerdictProof.deltaLabel,
        changeDate: urlVerdictProof.changeDate ?? null,
      }
    : null;

  return (
    <div className="space-y-5 max-w-5xl" data-today-layout="phase-6a8">
      {/* ─────────────────────────────────────────────────────────────────
          UX.2 (2026-05-07) — Beacon Command Center.

          Top-of-page executive summary (5 cards) added above the prior
          7-tier layout. Cards render their own empty states when
          their data slice is null (so brand-new tenants without poll
          history just see empty cards rather than a broken layout —
          though /today's first-reading early-return short-circuits
          this entirely for activePromptCount>0 + observationCount===0).
          ─────────────────────────────────────────────────────────── */}
      {commandCenter.hasAnyData ||
      pollHealth ||
      primaryAction ||
      topMovementForCommandCenter ? (
        <CommandCenter
          brain={commandCenter.brain}
          manifest={commandCenter.manifest}
          pollHealth={pollHealth}
          primaryAction={primaryAction ?? null}
          topMovement={topMovementForCommandCenter}
          isOperator={commandCenterIsOperator}
        />
      ) : null}

      {/* ─────────────────────────────────────────────────────────────────
          Phase 6A.8 (2026-04-28) — Today command-center hierarchy.

          Tier 0: Critical alerts (only when firing).
          Tier 1: Do Next (single decision card).
          Tier 2: Lifecycle strip.
          Tier 3: Implementation queue (top 3).
          Tier 4: Action queue.
          Tier 5: Wins / latest signal.
          Tier 6: Today's metrics (collapsible disclosure).
          Tier 7: Scan diffs (collapsed accordion at the bottom).

          Pre-6A.8 the metrics tier sat above the lifecycle layer, which
          buried the operator's daily-decision surface under 6 sections
          of analytics. The audit ahead of this phase classified every
          section, the user approved the new order, and this block is
          the result. No data layer changes — this is a pure layout
          rewrite around already-loaded props.
          ─────────────────────────────────────────────────────────── */}

      {/* 2026-05-06 demo-path fix — first-run welcome card.
          A brand-new tenant (zero observations, no Do-Next, no shipped
          edits) historically saw an alerts strip + an empty queue tile
          and almost nothing else — looked broken. Show a single
          oriented welcome card that explains what to do and when the
          first reading lands. */}
      {!pollHealth &&
        !primaryAction &&
        (!lifecycleSummary ||
          (lifecycleSummary.counts.liveVerified === 0 &&
            lifecycleSummary.counts.pendingImplementation === 0)) && (
          <div
            className="rounded-md border border-status-info/40 bg-status-info/[0.04] px-4 py-3.5"
            role="status"
            data-today-first-run="true"
          >
            <p className="text-[13px] font-semibold text-foreground">
              Welcome to Beacon.
            </p>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Your first AI-visibility reading lands after the next
              scheduled poll (07:00 UTC daily). Add prompts in
              Settings → Prompts to expand the daily sample, then check
              back here tomorrow morning.
            </p>
          </div>
        )}

      {/* Tier 0 — critical alerts. Each renders only when its trigger
          is firing, so a green system shows zero alerts.
          2026-05-06 demo-path Phase 3-bis fix 8: PollHealthBlock no
          longer renders at the top when every platform is OK. When
          all platforms are status="ok", suppress the block entirely
          (the header is silent on healthy days). When any platform is
          partial / failed / pending, the block surfaces with the
          existing customer-friendly copy. Operator can always inspect
          full poll health via /diagnostics (operator-mode only).

          UX.6.1 Fix 2 (2026-05-07) — false-alarm fix. Between midnight
          UTC and 08:00 UTC (07:00 cron + 1h grace), all-pending state
          is normal scheduling, NOT a fault. Render the calm banner
          ("Next reading scheduled") instead of the alarming
          PollHealthBlock. Post-cutoff or partial/failed → warning. */}
      {pollHealth &&
        pollHealth.platforms.some((p) => p.status !== "ok") &&
        (isPreCronPending(pollHealth) ? (
          <PollHealthCalmBanner />
        ) : (
          <PollHealthBlock snapshot={pollHealth} />
        ))}
      {todayFreshness && (
        <div
          className="rounded-md border border-status-warning/40 bg-status-warning/[0.04] px-4 py-2.5 text-[12px]"
          role="status"
          data-today-alert="stale-data"
        >
          <span className="font-semibold text-status-warning">
            Visibility data is {todayFreshness.daysStale}d stale.
          </span>{" "}
          <span className="text-muted-foreground">
            Last observation:{" "}
            <span className="font-medium text-foreground">
              {todayFreshness.lastObservationDate}
            </span>
            . Check poll health above.
          </span>
        </div>
      )}
      {!hostedScanDisabled && (
        <TodayScanStrip
          shouldTriggerScan={shouldTriggerScan}
          pendingChangesCount={pendingContentChanges}
        />
      )}
      {lifecycleSummary && lifecycleSummary.counts.needsReview > 0 && (
        <Link
          href="/changes?tab=needs_review"
          className="block rounded-md border border-status-warning/50 bg-status-warning/[0.06] px-4 py-2.5 text-[12px] hover:bg-status-warning/[0.10] transition-colors"
          data-today-alert="needs-review"
        >
          <span className="font-semibold text-status-warning">
            {lifecycleSummary.counts.needsReview} edit
            {lifecycleSummary.counts.needsReview === 1 ? "" : "s"} need review
          </span>{" "}
          <span className="text-muted-foreground">
            — the match engine returned an ambiguous verdict. Open Needs review →
          </span>
        </Link>
      )}

      {/* Since-last-visit delta — surfaces above Do Next when the
          operator has new wins/hurts since their last visit. */}
      <SinceLastVisit
        currentCardIds={[
          ...(primaryAction ? [primaryAction.id] : []),
          ...(secondaryAction ? [secondaryAction.id] : []),
          ...moreActions.map((a) => a.id),
        ].filter((id) => id.startsWith("hurt-") || id.startsWith("win-"))}
      />

      {/* Tier 1.5 — Visibility headline (Phase 6B.2, 2026-04-29).
          The visibility chart + competitor leaderboard answer the
          single question Beacon exists to answer: "is AI mentioning me
          more or less, and how do I rank against the field." Pre-6B.2
          this lived inside the collapsed metrics disclosure (Tier 6),
          which buried the product's purpose under a click. Now it
          sits between alerts and the Do Next card so the operator
          sees orientation BEFORE action. The disclosure below still
          carries enrichment + prompts depth for operators who want
          to drill in. */}
      {visibilityData && (
        <section
          className="space-y-3"
          data-today-section="visibility-headline"
        >
          {/* UX.5B.1 (2026-05-07) — Visibility hero header. Sits
              above the chart + leaderboard pair so the operator sees
              the product's core question framed before the data
              renders. Visually connects to the Command Center via
              matching uppercase-tracked-wide section header style. */}
          <header
            className="flex flex-wrap items-baseline justify-between gap-2"
            data-today-section="visibility-hero-header"
          >
            <div>
              <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
                AI Visibility
              </h2>
              <p className="text-[12px] text-muted-foreground">
                How often {visibilityData.brandName} appears across
                tracked AI answers.
              </p>
            </div>
          </header>
          <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-4">
            <VisibilityScoreChart
              brandName={visibilityData.brandName}
              brandSeriesByMetric={visibilityData.brandSeriesByMetric}
              brandSeriesByPlatform={visibilityData.brandSeriesByPlatform ?? {}}
              competitorSeriesByMetric={visibilityData.competitorSeriesByMetric}
              events={visibilityData.chartEvents ?? []}
              timeRange={visibilityWindow}
              onTimeRangeChange={setVisibilityWindow}
              chartEndDate={visibilityData.chartEndDate ?? null}
            />
            <VisibilityLeaderboard
              entities={
                visibilityData.leaderboardByMetricAndWindow?.composite[
                  visibilityWindow
                ] ?? visibilityData.leaderboardByMetric.composite
              }
            />
          </div>
        </section>
      )}

      {/* Tier 1 — Do Next (single card, deterministic priority).
          UX.6.2 (2026-05-07) — priority simplified after dropping
          decide_recommendation (now owned by Command Center
          NextBestActionCard above):
          ship_pending > review_site_findings > calm.
          Logic locked in src/components/today/today-do-next-card.tsx. */}
      <TodayDoNextCard
        pendingQueue={lifecycleSummary?.queue ?? []}
        pendingCount={lifecycleSummary?.counts.pendingImplementation ?? 0}
        topPick={topPick ?? null}
        findingsCriticalCount={findingsData.criticalCount}
        findingsImportantCount={findingsData.importantCount}
        findingsTotalCount={findingsData.totalCount}
      />

      {/* Tier 2 — lifecycle strip (chips deep-link to /changes?tab=…). */}
      {lifecycleSummary && (
        <TodayLifecycleStrip counts={lifecycleSummary.counts} />
      )}

      {/* Tier 3 — implementation queue (top 3, capped server-side). */}
      {lifecycleSummary && (
        <TodayImplementationQueue
          queue={lifecycleSummary.queue}
          totalPendingCount={lifecycleSummary.counts.pendingImplementation}
        />
      )}

      {/* Tier 4 — Action queue. Stays after the lifecycle layer because
          pending implementation is operationally heavier than evaluating
          new recommendations. */}
      {primaryAction && (
        <div className="flex items-center justify-between -mb-1">
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            Action queue
          </h3>
          <span className="text-[10px] text-muted-foreground/40">
            {[primaryAction, secondaryAction, ...moreActions].filter(Boolean).length} to review
          </span>
        </div>
      )}
      {primaryAction ? (
        <TodayActionQueue
          primaryAction={primaryAction as ActionCardAction | null}
          secondaryAction={secondaryAction as ActionCardAction | null}
          moreActions={moreActions as ActionCardAction[]}
          findings={findingsData}
          onRespondToRec={onRespondToRec}
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

      {/* Tier 5 — wins / latest signal (learning section, lower priority). */}
      {measuredWins && measuredWins.length > 0 && (
        <section className="space-y-2" data-today-section="wins">
          <div className="flex items-center justify-between">
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
              Wins to learn from
            </h3>
            <span className="text-[10px] text-muted-foreground/40">
              {measuredWins.length} measured
            </span>
          </div>
          <div className="space-y-2 opacity-90">
            {measuredWins.map((win) => (
              <ActionCard
                key={win.id}
                action={win as ActionCardAction}
                variant="secondary"
                onRespondToRec={onRespondToRec}
                pending={pending}
                startTransition={startTransition}
                actionMsg={actionMsg}
                setActionMsg={setActionMsg}
              />
            ))}
          </div>
        </section>
      )}
      {proofLine && (
        <a
          href="/changes"
          className="flex items-center gap-2.5 rounded-lg border border-border/50 bg-surface-inset/20 px-4 py-2.5 hover:bg-surface-inset/40 transition-colors group"
          data-today-section="latest-signal"
        >
          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${proofLine.dot}`} />
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70 shrink-0">
            Latest signal
          </span>
          <span className="text-xs text-foreground/90 flex-1">{proofLine.text}</span>
          <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground shrink-0">
            →
          </span>
        </a>
      )}

      {/* Tier 6 — collapsible metrics disclosure. Defaults closed; state
          persists per browser via localStorage. Phase 6B.2 (2026-04-29):
          visibility chart + leaderboard surfaced above (Tier 1.5 — the
          headline answer to "is AI mentioning me more or less"). What
          remains here is secondary metric depth: enrichment-rollup
          descriptors + per-platform prompts teaser. */}
      {(enrichmentV2 || enrichmentRollup || promptsTeaser) && (
        <TodayMetricsDisclosure>
          {/* W2 Step 2.3: prefer v2 bundle (4-section layout). Falls back
              to the legacy single-day badges when the v2 bundle build
              failed for some reason — UX never goes blank. */}
          {enrichmentV2 ? (
            <EnrichmentV2 data={enrichmentV2} />
          ) : (
            enrichmentRollup && <EnrichmentBadges rollup={enrichmentRollup} />
          )}
          {promptsTeaser && <PromptsTeaser summary={promptsTeaser} />}
        </TodayMetricsDisclosure>
      )}

      {/* Tier 7 — scan diffs (collapsed accordion). Phase 6A.4 contract:
          <details> without `open` attr; sticky once user expands. */}
      {onConfirmFinding && onDismissFinding && pendingFindings.length > 0 && (
        <ChangeReview
          findings={pendingFindings}
          onConfirm={onConfirmFinding}
          onDismiss={onDismissFinding}
        />
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

/**
 * 2026-04-20: URL-verdict proof formatter. Replaces formatMemoryProof (which
 * used topic-level aggregation and produced false causal claims). Consumes
 * the `urlVerdictProof` payload from today-data (sourced directly from the
 * Z-score engine's url-change-outcomes store).
 */
type UrlVerdictProof = {
  changeId: string;
  pagePath: string;
  changeDate: string | null;
  citationDeltaPct: number;
  deltaLabel: string;
};
function formatUrlVerdictProof(p: UrlVerdictProof): { text: string; dot: string } {
  // 2026-05-06 demo-path fix: previous copy ended with "(URL-level Z-score)".
  // A small-business owner does not know what a Z-score is. Customer-friendly
  // suffix is "(measured per page)" — the underlying engine still uses the
  // Z-score model, but the surface is honest without the statistics jargon.
  const text = p.changeDate
    ? `${p.pagePath} is up ${p.deltaLabel} after your ${p.changeDate} change (measured per page)`
    : `${p.pagePath} is up ${p.deltaLabel} (measured per page)`;
  return { text, dot: "bg-status-success" };
}
