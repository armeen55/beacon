"use client";

/**
 * TodayV2Client — Bundle 1 of the UI redesign
 * (Plan: i-want-a-maximum-depth-curried-curry).
 *
 * Replaces the v1 19-section /today layout with a focused 4-zone view:
 *
 *   1. AIVisibilityHero  — one big number + delta + plain-English summary
 *   2. Do today          — single primary action card (no accordion)
 *   3. Working           — currently-shipping changes + pending count
 *   4. Recent wins       — last 3 measured outcomes
 *
 * Below the fold, a "Show full data" disclosure exposes the heavy
 * drilldown surfaces (visibility chart, leaderboard, enrichment, prompts
 * teaser, and change review) for operators who want the depth.
 *
 * Operator-only sections from v1 (DataFreshnessHeartbeat, PollHealthBlock,
 * CommandCenter, TodayLifecycleStrip, TodayImplementationQueue,
 * SinceLastVisit, scan-strip alerts) are intentionally NOT rendered here.
 * They remain accessible via `/today?legacy=1`. A dedicated /(operator)
 * shell can subsume them in a follow-up bundle.
 *
 * Pure presentation. Consumes the same `TodayPageData` props as
 * TodayClient — no data plumbing changes.
 */

import { useMemo, useState } from "react";
import Link from "next/link";

import type { TodayPrimaryAction } from "./today-client";
import { AIVisibilityHero } from "@/components/today/ai-visibility-hero";
import { FirstReadingWaiting } from "@/components/today/first-reading-waiting";
import { VisibilityScoreChart } from "@/components/today/visibility-score-chart";
import { VisibilityLeaderboard } from "@/components/today/visibility-leaderboard";
import { EnrichmentBadges } from "@/components/today/enrichment-badges";
import { EnrichmentV2 } from "@/components/today/enrichment-v2";
import type { PromptsTeaserSummary } from "@/components/today/prompts-teaser";
// QA cleanup (2026-05-12): the v2 client no longer renders
// PromptsTeaser, ChangeReview, or the full ActionCard "Wins to learn
// from" disclosure section — all three duplicated content that is
// already covered by:
//   - PromptsTeaser  → `/prompts?v2=1` (strategic surface, default)
//   - ChangeReview   → operator scan-diff flow (legacy `/today?legacy=1`)
//   - ActionCard wins → TodayV2RecentWins card (above the fold)
// The components stay in the codebase because legacy `today-client.tsx`
// still consumes them; only the v2 import path is trimmed here.
import { TodayV2DoToday } from "@/components/today/v2/today-v2-do-today";
import { TodayV2Working } from "@/components/today/v2/today-v2-working";
import { TodayV2RecentWins } from "@/components/today/v2/today-v2-recent-wins";

import type { TodaySummary } from "@/lib/today-summary";
import type { TodayProofContext } from "@/lib/today-proof-context";
import type { PollHealthSnapshot } from "@/domains/observations/poll-health";
import type {
  EnrichmentRollup,
  EnrichmentV2Data,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import type {
  VisibilityMetric,
  VisibilityPoint,
  EntityVisibility,
} from "@/domains/product/visibility-score";
import type { TopPickSummary } from "@/components/today/top-pick-card";
import type { CommandCenterData } from "@/domains/today/command-center-data";
import type { SerializedFinding } from "./today-client";

type UrlVerdictProof = {
  changeId: string;
  pagePath: string;
  changeDate: string | null;
  citationDeltaPct: number;
  deltaLabel: string;
};

type TodayV2Props = {
  isDemoMode?: boolean;
  scanPhaseFailed?: boolean;
  todayFreshness?: { lastObservationDate: string; daysStale: number } | null;
  hostedScanDisabled?: boolean;
  summary: TodaySummary;
  primaryAction?: TodayPrimaryAction | null;
  secondaryAction?: TodayPrimaryAction | null;
  moreActions?: TodayPrimaryAction[];
  measuredWins?: TodayPrimaryAction[];
  morningBrief?: unknown | null;
  scoreboard: unknown;
  visibilityData?: {
    brandName: string;
    brandSeriesByMetric: Record<VisibilityMetric, VisibilityPoint[]>;
    brandSeriesByPlatform?: Record<string, VisibilityPoint[]>;
    leaderboardByMetric: Record<VisibilityMetric, EntityVisibility[]>;
    leaderboardByMetricAndWindow?: Record<
      VisibilityMetric,
      Record<number, EntityVisibility[]>
    >;
    chartEndDate?: string;
    competitorSeriesByMetric: Record<
      VisibilityMetric,
      Array<{ name: string; points: VisibilityPoint[] }>
    >;
    chartEvents?: Array<{
      date: string;
      tone: "danger" | "success" | "neutral";
      label: string;
    }>;
  } | null;
  urlVerdictProof?: UrlVerdictProof | null;
  onRespondToRec?: (
    recId: string,
    status: "accepted" | "dismissed" | "deferred",
  ) => Promise<{ success: boolean }>;
  pendingFindings?: SerializedFinding[];
  shouldTriggerScan?: boolean;
  proofContext: TodayProofContext;
  localAttentionStrip?: unknown | null;
  onConfirmFinding?: (
    findingId: string,
  ) => Promise<{ success: boolean; changeId?: string }>;
  onDismissFinding?: (findingId: string) => Promise<{ success: boolean }>;
  experimentProof?: unknown | null;
  faqSchemaCoverage?: { covered: number; total: number } | null;
  platformDistribution?: {
    google_aio: number;
    chatgpt: number;
    perplexity: number;
    total: number;
  } | null;
  concentratedPlatform?: "google_aio" | "chatgpt" | "perplexity" | null;
  pollHealth?: PollHealthSnapshot | null;
  siteScan?: {
    completedAt: string | null;
    status: "completed" | "partial" | "failed" | null;
  } | null;
  enrichmentRollup?: EnrichmentRollup | null;
  enrichmentV2?: EnrichmentV2Data | null;
  promptsTeaser?: PromptsTeaserSummary | null;
  topPick?: TopPickSummary | null;
  lifecycleSummary?: import("./today-data").TodayLifecycleSummary | null;
  firstReading?: import(
    "@/domains/onboarding/first-reading-state"
  ).FirstReadingDetection;
  commandCenter?: CommandCenterData;
  commandCenterIsOperator?: boolean;
};

export function TodayV2Client({
  isDemoMode = false,
  primaryAction = null,
  measuredWins = [],
  visibilityData = null,
  urlVerdictProof = null,
  enrichmentRollup = null,
  enrichmentV2 = null,
  lifecycleSummary = null,
  firstReading = { isFirstReading: false },
}: TodayV2Props) {
  // QA cleanup (2026-05-12): `useTransition` + `actionMsg` state were
  // wired to the disclosure's ActionCard rendering for `measuredWins`.
  // That section was removed (duplicated TodayV2RecentWins above the
  // fold). Same with `pendingFindings` / `onRespondToRec` /
  // `onConfirmFinding` / `onDismissFinding` / `promptsTeaser` —
  // their consumers (ChangeReview, ActionCard, PromptsTeaser) no
  // longer mount in the v2 tree. The props stay typed as optional so
  // the caller signature (`today-data.ts`) doesn't have to change.
  const [visibilityWindow, setVisibilityWindow] = useState<number>(14);

  // Same hero-props derivation as today-client.tsx — kept inline so v2
  // is a fully self-contained client without coupling to v1 internals.
  // Math + sources unchanged; this is pure projection over already-
  // computed visibilityData + enrichmentV2 inputs.
  const heroProps = useMemo(() => {
    if (!visibilityData) return null;
    const leaderboard =
      visibilityData.leaderboardByMetricAndWindow?.composite[
        visibilityWindow
      ] ??
      visibilityData.leaderboardByMetric.composite ??
      [];
    const brandRow = leaderboard.find((e) => e.isOwned) ?? null;

    const series = visibilityData.brandSeriesByMetric.composite ?? [];
    let latestPointDate: string | null = null;
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i].sampleSize > 0) {
        latestPointDate = series[i].date;
        break;
      }
    }

    const closestChallenger = (() => {
      if (!brandRow) {
        const top = leaderboard.find((e) => !e.isOwned) ?? null;
        return top ? { name: top.name, score: top.score } : null;
      }
      const competitors = leaderboard.filter((e) => !e.isOwned);
      if (competitors.length === 0) return null;
      const ahead = competitors
        .filter((e) => e.rank < brandRow.rank)
        .sort((a, b) => b.rank - a.rank)[0];
      const behind = competitors
        .filter((e) => e.rank > brandRow.rank)
        .sort((a, b) => a.rank - b.rank)[0];
      const pick = ahead ?? behind ?? null;
      return pick ? { name: pick.name, score: pick.score } : null;
    })();

    const platformPrimaryPct = (platform: string): number | null => {
      const sparkline = enrichmentV2?.sparklines?.find(
        (s) => s.platform === platform,
      );
      if (!sparkline) return null;
      for (let i = sparkline.points.length - 1; i >= 0; i--) {
        const r = sparkline.points[i].primaryRate;
        if (r !== null) return Math.round(r * 100);
      }
      return null;
    };

    const sampleState: "full" | "partial" | undefined = (() => {
      const sparks = enrichmentV2?.sparklines ?? [];
      const known = sparks.filter(
        (s) => s.platform === "ChatGPT" || s.platform === "Perplexity",
      );
      if (known.length === 0) return undefined;
      const allEnough = known.every((s) => s.sampleStatus === "enough");
      return allEnough ? "full" : "partial";
    })();

    return {
      brandName: visibilityData.brandName,
      score: brandRow?.score ?? null,
      delta: brandRow?.delta ?? null,
      windowDays: brandRow?.deltaWindowDays ?? visibilityWindow,
      rank: brandRow?.rank ?? null,
      totalRanked: leaderboard.length,
      closestChallenger,
      currentSampledDays: brandRow?.currentSampledDays ?? 0,
      latestReadingDate: latestPointDate,
      chatgptPrimaryPct: platformPrimaryPct("ChatGPT"),
      perplexityPrimaryPct: platformPrimaryPct("Perplexity"),
      sampleState,
    };
  }, [visibilityData, visibilityWindow, enrichmentV2]);

  if (isDemoMode) {
    return (
      <div className="space-y-6">
        <div className="rounded-lg border border-border/60 bg-surface-inset/30 px-5 py-5">
          <h2 className="text-[13px] font-semibold text-foreground tracking-tight">
            Import your data to see your real command center
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
            Today shows your visibility scoreboard and ranked actions once you
            import your first visibility data set.
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

  if (firstReading.isFirstReading) {
    return <FirstReadingWaiting context={firstReading.context} />;
  }

  const liveChanges = lifecycleSummary?.liveChanges ?? [];
  const pendingImplementationCount =
    lifecycleSummary?.counts.pendingImplementation ?? 0;

  return (
    <div className="space-y-5 max-w-5xl" data-today-layout="v2-bundle1">
      {/* Hero — one big number + delta + per-platform primary %. Owns the
          executive answer to "is my AI visibility healthy and improving?".
          Reuses the existing AIVisibilityHero (UX.6.3 component) verbatim;
          only the surrounding layout has changed. */}
      {heroProps && <AIVisibilityHero {...heroProps} />}

      {/* Visibility trend chart — sits with the hero as the proof
          layer ("here is the score, here is the trend behind it").
          Below the chart sits the leaderboard so the hero +
          chart + leaderboard form one tight "visibility block":
          headline number → trend → competitive context. The
          three-action-card row follows. */}
      {visibilityData && (
        <section
          className="space-y-3"
          data-today-v2-section="visibility-trend"
        >
          <VisibilityScoreChart
            brandName={visibilityData.brandName}
            brandSeriesByMetric={visibilityData.brandSeriesByMetric}
            brandSeriesByPlatform={
              visibilityData.brandSeriesByPlatform ?? {}
            }
            competitorSeriesByMetric={
              visibilityData.competitorSeriesByMetric
            }
            events={visibilityData.chartEvents ?? []}
            timeRange={visibilityWindow}
            onTimeRangeChange={setVisibilityWindow}
            chartEndDate={visibilityData.chartEndDate ?? null}
          />
        </section>
      )}

      {/* AI Visibility Leaderboard — promoted into the main flow on
          2026-05-12 in response to operator feedback. The leaderboard
          answers "who am I beating / losing to?" — a core Today
          question, not "extra data". Pre-promote, it was buried in
          the "Show full data" disclosure and the customer-vs-tracked-
          competitor framing was lost. */}
      {visibilityData && (
        <section
          className="space-y-3"
          data-today-v2-section="visibility-leaderboard"
        >
          <VisibilityLeaderboard
            entities={
              visibilityData.leaderboardByMetricAndWindow?.composite[
                visibilityWindow
              ] ?? visibilityData.leaderboardByMetric.composite
            }
          />
        </section>
      )}

      {/* Three cards above the fold. Equal-weight 3-col on desktop,
          stacked on mobile. Each card is self-contained: hero answers
          "how am I doing?", these answer "what should I do, what is in
          motion, what already worked?". */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <TodayV2DoToday primaryAction={primaryAction} />
        <TodayV2Working
          liveChanges={liveChanges}
          pendingImplementationCount={pendingImplementationCount}
        />
        <TodayV2RecentWins
          measuredWins={measuredWins}
          urlVerdictProof={urlVerdictProof}
        />
      </div>

      {/* Show full data — disclosure for true secondary detail only.
          Post-2026-05-12 cleanup: this collapsed from a 4-section
          drawer (leaderboard + descriptors + prompts-teaser + wins
          detail + scan review) down to the descriptors block alone +
          the legacy escape. Everything else either lives on its
          own route (prompts → /prompts, changes → /changes) or is
          already covered by a main-flow surface (leaderboard above,
          Recent wins card above). The legacy 19-section layout is
          reachable via /today?legacy=1 for operators who need it. */}
      <details
        className="rounded-lg border border-border/60 bg-surface-inset/30"
        data-today-v2-disclosure="show-full-data"
      >
        <summary className="cursor-pointer select-none px-4 py-3 text-[12px] font-semibold text-foreground hover:bg-surface-inset/40 rounded-lg transition-colors flex items-center justify-between">
          <span>Show full data</span>
          <span className="text-[10px] text-muted-foreground/70 font-normal">
            descriptors AI used near you
          </span>
        </summary>

        <div className="px-4 pb-4 pt-2 space-y-5">
          {/* Descriptors AI used near the brand (legacy Tier 6).
              Unique to Today — the only place a customer sees what
              WORDS AI is actually using when it answers buyer
              questions. Kept in the disclosure because it's depth,
              not headline. */}
          {(enrichmentV2 || enrichmentRollup) && (
            <section
              className="space-y-3"
              data-today-v2-section="topic-depth"
            >
              {enrichmentV2 ? (
                <EnrichmentV2 data={enrichmentV2} />
              ) : (
                enrichmentRollup && (
                  <EnrichmentBadges rollup={enrichmentRollup} />
                )
              )}
            </section>
          )}

          {/* Escape hatch for operators who need the full v1 layout. */}
          <div className="pt-2 border-t border-border/40 text-[11px] text-muted-foreground/70">
            Need the old layout?{" "}
            <Link
              href="/today?legacy=1"
              className="text-accent-primary hover:underline font-medium"
              data-today-v2-cta="legacy"
            >
              Open legacy view →
            </Link>
          </div>
        </div>
      </details>
    </div>
  );
}
