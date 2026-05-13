/**
 * Today route (/) — server-side data prep for `TodayClient`.
 * Read-only on render (Track 1C). Phase 4-8 extraction from `page.tsx`.
 */

import {
  getResults,
  getChangelogEntries,
  getOpportunities,
  getCompetitors,
  hasActiveExperiment,
} from "@/lib/seed-data.server";
import { getEventDecisions } from "@/domains/attribution/store";
import { computeScorecard } from "@/domains/attribution/scorecard";
import { enrichWithImpact } from "@/domains/attribution/change-impact";
import { detectOutcomeEvents } from "@/domains/attribution/events";
import { discoverCandidates } from "@/domains/attribution/candidates";
import { triageCandidates } from "@/domains/attribution/triage";
import { partitionResultsByMode } from "@/domains/attribution/result-mode";
import { getOwnedPages } from "@/domains/pages/page-store";
import { warmPageRegistry } from "@/domains/attribution/candidates";
import { readStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import { getTenantScanFindingsCached } from "@/domains/scanning/scan-findings-cached";
import { currentTenantId, currentTenant } from "@/lib/tenant-context";
import {
  detectFirstReadingState,
  type FirstReadingDetection,
} from "@/domains/onboarding/first-reading-state";
import {
  resolveCommandCenterData,
  isOperatorMode as commandCenterIsOperatorMode,
  deriveBrainSummaryFromCounts,
  type CommandCenterData,
} from "@/domains/today/command-center-data";
import { getOutcomesForTenant } from "@/lib/tenant-data";
import { getCitationEvidenceIndex } from "@/domains/pages/citation-evidence-store";
import {
  getPageIssues,
  getRolloutExecutions,
  getPatternEvidence,
} from "@/domains/pages/issues";
import { minePatterns, generateBriefs } from "@/domains/pages/playbook";
import {
  planWaves,
  getRolloutWaves,
  computeWaveProgress,
  deriveWaveStatus,
} from "@/domains/pages/wave-planner";
import { stripSiteOrigin, getSiteConfig } from "@/lib/site-config";
import { buildTodaySummary, type TodayNextMove } from "@/lib/today-summary";
import { computeRecommendations } from "@/domains/product/recommendation-engine";
import { rankAndSelect } from "@/domains/product/priority-engine";
import { computeTrackRecord } from "@/domains/product/recommendation-tracker";
import { classifyEvidenceBasis } from "@/domains/product/evidence-basis";
import {
  isRecSuppressedFromMap,
  getResponseFromMap,
  ensureRecommendationResponsesSeeded,
  type RecommendationResponse,
} from "@/domains/product/recommendation-response-store";
// Phase 4 (2026-04-19): experiment-store deleted. url-change-outcomes is now
// the single source of truth for tracking. See getWatchingUrlOutcomes().
// outcome-store backfill/persist moved to post-import (Phase 1C-1)
import { computeCitationDecay, getDecayAlerts } from "@/domains/attribution/citation-decay";
import { extractEntities } from "@/domains/entity/entity-extract";
import { detectDiscrepancies } from "@/domains/entity/discrepancy-detect";
import { computeGeoCoverage } from "@/domains/geo/coverage";
import { getActivePrompts, getPromptLibrary } from "@/domains/prompts/prompt-library";
import { computeJourneyCoverage } from "@/domains/prompts/journey-coverage";
import { JOURNEY_STAGE_LABELS } from "@/domains/prompts/journey-stages";
import { analyzeAllExtractability } from "@/domains/pages/extractability";
import { computeSnippetIntelligence } from "@/domains/competitors/snippet-intel";
import {
  latestWebsiteCrawlRun,
  listObservationRuns,
  getObservationRun,
} from "@/domains/observations/read";
import {
  fetchPollHealthForDate,
  aggregateSamplingStatus,
  todayISOUtc,
  type PollHealthSnapshot,
} from "@/domains/observations/poll-health";
import {
  fetchTodayDerivedKpis,
  type TodayDerivedKpis,
} from "@/domains/daily-metric-snapshots/today-kpis";
import {
  buildEnrichmentRollup,
  buildEnrichmentWindowRollup,
  buildCompetitorEnrichmentRollup,
  buildCompetitorDropdown,
  buildPlatformPrimaryRateSparklines,
  buildFormatWinsRollup,
  type EnrichmentRollup,
  type CompetitorEnrichmentRollup,
  type EnrichmentV2Data,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import { buildPromptDecisionMatrix } from "@/domains/prompts/decision-matrix";
import { generateRecommendations } from "@/domains/recommendations/generate";
import { resolvePageIntent } from "@/domains/recommendations/resolve-page-intent";
import { buildPageInventory } from "@/domains/recommendations/page-inventory";
import { prioritizeRecommendations } from "@/domains/recommendations/prioritize";
import type { PromptsTeaserSummary } from "@/components/today/prompts-teaser";
import type { TopPickSummary } from "@/components/today/top-pick-card";
import { buildTopPickSummary } from "@/components/today/top-pick-builder";
import { primaryVisibilityRunForResults } from "@/domains/observations/visibility-context";
import { loadCompetitorUniverseRuntime } from "@/domains/competitors/universe-read";
import { buildTodayCompetitorLine } from "@/domains/competitors/today-competitor-line";
import { PLATFORM_LABELS, type Platform } from "@/lib/constants";
import { getScanSettings, isScanOverdue } from "@/domains/scanning/scan-settings";
import { readScanState } from "@/domains/scanning/scan-state";
import { FINDING_PRIORITY_ORDER } from "@/domains/scanning/types";
// buildCompetitorRank / classifyCompetitorType moved to post-import milestone sync (Phase 1C-3)
import { getBusinessConfig, getSectionAnalyzerConfig, getFaqTemplates } from "@/lib/business-config";
import { getLocalPresenceSnapshot, buildTodayLocalAttention } from "@/lib/local-presence";
import {
  computeLocalOperatorSurface,
  loadLocalOperatorImport,
} from "@/domains/local-operator/surface";
import {
  buildReplicationCards,
  buildPromisingReplicationCards,
} from "@/domains/product/replication-engine";
import type { TodayProofContext } from "@/lib/today-proof-context";
import {
  serializeFindingForToday,
  recommendationLineageBullets,
} from "@/lib/today-proof-serialize";
import {
  getMilestoneState,
  pickTodayMilestoneTeaser,
} from "@/domains/milestones";
import { getAnswerIntelligenceIndex } from "@/domains/answer-intelligence/store";
import type { AnswerIntelligenceIndex } from "@/domains/answer-intelligence/types";
import { buildMorningBrief, type MorningBriefData } from "@/domains/product/morning-brief";
import { buildQueryKeywordIndex, type QueryKeywordIndex } from "@/domains/answer-intelligence/query-index";
// 2026-04-20: MemoryInsight (topic-level attribution) removed in favor of
// url-change-outcomes (URL-level Z-score). See win-card logic below.
import {
  ensureCanonicalStoresSeeded,
  loadFreshCanonicalData,
} from "@/storage/canonical-store";
// url-brain-recommender removed 2026-04-18 (Phase 7 cleanup) \u2014 was producing
// vague "Investigate h1 regression" shrug cards with low-sample pattern math
// (often 2-of-3 cases). Being replaced by data-grounded keyword-gap scanner +
// LLM-as-judge ablation (see docs/IDEAS_PARKING_LOT.md for ablation roadmap).
import {
  getUrlChangeOutcomes,
  ensureUrlChangeOutcomesSeeded,
  type UrlChangeOutcome,
} from "@/domains/attribution/url-change-outcome";
import type { ChangelogEntry } from "@/domains/changelog/types";
import {
  buildTodayLiveChanges,
  type TodayLiveChange,
} from "@/domains/today/live-changes-data";
import type { UrlChangePattern } from "@/domains/learning/change-patterns";
import { buildSchemaParityActions } from "@/domains/actions/schema-parity-actions";
import { getCompetitorMonitoringState } from "@/domains/competitor-monitoring/store";
import { generateCompetitorAlerts } from "@/domains/competitor-monitoring/detect-changes";
import {
  computeVisibilityTimeSeries,
  computeVisibilityTimeSeriesByPlatform,
  computeLeaderboard,
  computeCompetitorSeries,
  type VisibilityMetric,
  type VisibilityPoint,
  type EntityVisibility,
} from "@/domains/product/visibility-score";
import { buildObservationRollup } from "@/domains/today/observation-rollup";


import type { ComponentProps } from "react";
import { TodayClient, type TodayQueueItem } from "./today-client";

/**
 * T-WorseningSuffix (2026-05-08) — direction-aware hurting trend suffix.
 *
 * Pre-T-WorseningSuffix, the hurting action card on /today appended
 * " · worsening" whenever `transitions > 1`. The transitions counter
 * (see `url_change_outcomes.transitions`) increments on ANY material
 * recorder update — including the demotion path where a hurting row
 * recovers from z=−3.5 toward z=−2.1. Calling that "worsening" was
 * a direction-blind read of a count, not a trend signal.
 *
 * Until the recorder persists a verdict_history (z + verdict per
 * transition), there is no safe way to infer trend direction from
 * the existing fields alone. Returning "" keeps the rationale honest:
 * we say "hurting for Nd" without claiming to know whether it's
 * accelerating or recovering.
 *
 * When verdict_history lands (next bundle), this helper becomes the
 * one place to compute "improving" / "worsening" / "holding" by
 * comparing the most recent two stamps' z-magnitudes.
 *
 * Pure. No I/O.
 */
export function hurtingTrendSuffix(_args: { transitions: number }): string {
  return "";
}

export type TodayPageData = Omit<
  ComponentProps<typeof TodayClient>,
  | "onRespondToRec"
  | "onStartExperiment"
>;

export async function loadTodayPageData(): Promise<TodayPageData> {
  // Phase 3.5C (2026-04-22): on Vercel, the module-level response-store and
  // url-change-outcomes arrays are empty (readStore() returned [] because
  // `.data/*.json` doesn't exist). Seed them from Supabase once per request
  // before any sync consumer (the module-level suppression/lookup helpers,
  // the `.filter`/`for..of` bodies below) runs against them.
  //
  // Phase 3.5E (2026-04-22): same problem for canonical-store exports that
  // drive the visibility score, rankings, competitor comparison, and entity
  // universe (`promptAnswerObservations`, `dailyMetricSnapshots`,
  // `trackedEntities`, `trackedPrompts`). Run all seeds in parallel.
  await Promise.all([
    ensureRecommendationResponsesSeeded(),
    ensureUrlChangeOutcomesSeeded(),
    ensureCanonicalStoresSeeded(),
  ]);

  // Phase 7.8e-4a/b/c: hoist citation + answer-intelligence + prompt-library reads once per request.
  const [citationEvidenceIndex, answerIntelligenceIndex, promptLibrary, activePrompts] = await Promise.all([
    getCitationEvidenceIndex(),
    getAnswerIntelligenceIndex(),
    getPromptLibrary(),
    getActivePrompts(),
  ]);

  // Sprint 7 Phase 7.5b Commit 4 (2026-04-25) — resolve tenant once and
  // thread it into every Tier A repository read below. Header-injected by
  // middleware (Phase 7.4) or env-fallback (Phase 7.3). Throws if neither
  // is set — fail-loud posture.
  const tenantId = await currentTenantId();

  // EGRESS-P0 (2026-05-07) — single-render memoization for
  // page_snapshots. Pre-fix the table was fetched twice per /today
  // render (top-pick page-inventory + general use), pulling the
  // capped+projected ~500-row payload twice. Now both call sites
  // share one promise.
  let _pageSnapshotsPromise: Promise<
    Awaited<ReturnType<ReturnType<ReturnType<typeof getRepository>["forTenant"]>["getPageSnapshots"]>>
  > | null = null;
  const getPageSnapshotsShared = (): Promise<
    Awaited<ReturnType<ReturnType<ReturnType<typeof getRepository>["forTenant"]>["getPageSnapshots"]>>
  > => {
    if (!_pageSnapshotsPromise) {
      _pageSnapshotsPromise = getRepository()
        .forTenant(tenantId)
        .getPageSnapshots();
    }
    return _pageSnapshotsPromise;
  };

  // Sprint 7 Phase 7.8e-1 (2026-04-26) — seed-data exports are now cached
  // async getters; resolve once at the top of the render so the body
  // below can use the arrays as local consts. 7.8e-3 (2026-04-26) added
  // the per-tenant arrays from issues / wave-planner / url-change-outcome
  // here too.
  const [
    results,
    changelogEntries,
    opportunities,
    competitors,
    pageIssues,
    rolloutExecutions,
    persistedPatternEvidence,
    persistedWaves,
    urlChangeOutcomes,
  ] = await Promise.all([
    getResults(),
    getChangelogEntries(),
    getOpportunities(),
    getCompetitors(),
    getPageIssues(),
    getRolloutExecutions(),
    getPatternEvidence(),
    getRolloutWaves(),
    getUrlChangeOutcomes(),
  ]);

  // Sprint 7 Phase 7.5c/3 (2026-04-25) — fetch tenant pages once and warm
  // the candidates page registry so downstream evidence-tier classification
  // sees the right data.
  const allPages = await getOwnedPages();
  await warmPageRegistry();

  // Phase 4.3 (Sprint 4, 2026-04-24): fetch recommendation responses FRESH
  // from the repository per render. The prior implementation read the
  // module-level response-store array + used the module-level suppression
  // and lookup helpers. That array is seeded once per Vercel lambda behind
  // a `_dbSeeded` one-shot flag, so a dismiss/defer/accept performed on
  // lambda B stays invisible on lambda A whose seed cache is already primed.
  // Operator symptom: a dismissed rec keeps reappearing as the Top Pick
  // until the lambda cold-recycles.
  //
  // Fix mirrors Phase 4.2 on /recommendations: fetch once, build a Map,
  // use the pure `*FromMap` helpers for suppression + decoration. Module-
  // level readers stay alive for non-render callers (replication-engine).
  // Sprint 5 sweeps the remaining cross-lambda call sites.
  let freshRecommendationResponses: RecommendationResponse[];
  try {
    freshRecommendationResponses =
      await getRepository().forTenant(tenantId).getRecommendationResponses();
  } catch (err) {
    console.error(
      "[today] fresh recommendation_responses read failed — continuing without response state",
      err,
    );
    freshRecommendationResponses = [];
  }
  const freshResponsesByRecId = new Map(
    freshRecommendationResponses.map((r) => [r.recId, r]),
  );

  // Phase 4.9 (Sprint 4, 2026-04-24): fresh canonical data per render.
  // Module-level arrays in canonical-store.ts are seeded once per Vercel
  // lambda behind `_canonSeeded`. After the 07:00 UTC poll writes fresh
  // observations to Supabase, already-warm lambdas served yesterday's
  // data forever. Fetch all four canonical tables fresh here and pass
  // into every downstream derivation. Module-level arrays remain for
  // non-render consumers (prompt-library, url-citation-history, etc.).
  //
  // On repo failure: graceful degrade to empty arrays — Today still
  // renders, other signals (changelog, scan findings, URL watcher) are
  // unaffected. Never fall back to the stale module state.
  let trackedPrompts: Awaited<
    ReturnType<typeof loadFreshCanonicalData>
  >["trackedPrompts"] = [];
  let promptAnswerObservations: Awaited<
    ReturnType<typeof loadFreshCanonicalData>
  >["promptAnswerObservations"] = [];
  let trackedEntities: Awaited<
    ReturnType<typeof loadFreshCanonicalData>
  >["trackedEntities"] = [];
  let dailyMetricSnapshots: Awaited<
    ReturnType<typeof loadFreshCanonicalData>
  >["dailyMetricSnapshots"] = [];
  // E3 (operator audit, 2026-05-05) — bound canonical reads by date.
  //
  // /today renders need:
  //   • Today's per-platform rollup (1 day of observations)
  //   • 7-day descriptor cloud + prior-7d-window deltas (14 days of obs)
  //   • Visibility chart (90 days of snapshots is the max range the
  //     chart toggle exposes; older data is /diagnostics territory)
  //
  // We were pulling the FULL ~14k-row observation table on every render
  // of /today, /prompts, and /diagnostics — a tens-of-MB Supabase egress
  // cost per page load (the dominant 5.7 GB/month bill driver). The
  // window below caps the read at 60 days for observations and 120 days
  // for snapshots — comfortably wider than every consumer in this file
  // needs, with margin for cron-lag / TZ slop / future timeRange chart
  // expansions.
  const NOW_MS = Date.now();
  const observationsSince = new Date(NOW_MS - 60 * 86_400_000)
    .toISOString();
  const snapshotsSince = new Date(NOW_MS - 120 * 86_400_000)
    .toISOString()
    .slice(0, 10); // for_date is YYYY-MM-DD, not full ISO
  try {
    const fresh = await loadFreshCanonicalData({
      observationsSince,
      snapshotsSince,
    });
    trackedPrompts = fresh.trackedPrompts;
    promptAnswerObservations = fresh.promptAnswerObservations;
    trackedEntities = fresh.trackedEntities;
    dailyMetricSnapshots = fresh.dailyMetricSnapshots;
  } catch (err) {
    console.error(
      "[today] fresh canonical read failed — continuing with empty canonical arrays",
      err,
    );
  }

  // Perf bundle 4 (2026-05-12) — build the shared per-request rollup ONCE
  // right after observations are loaded. Earlier today-data hoisted this
  // construction to immediately before the visibility-score fan-out (line
  // ~2324); hoisting it here lets inline observation loops earlier in the
  // function (freshness check at line 386, scanner mention counts at line
  // 1085) also read from the pre-bucketed rollup instead of walking the
  // observation array again.
  //
  // `brandAliases` is `businessConfig.name` + its first word, dedup-ed —
  // identical to the construction further down (the older second
  // declaration is preserved for readability and pinned by the
  // architecture test to be equivalent).
  const todayBusinessConfig = getBusinessConfig();
  const brandAliases = [
    todayBusinessConfig.name,
    todayBusinessConfig.name.split(" ")[0],
  ].filter((a, i, arr) => a && arr.indexOf(a) === i);
  const observationRollup = buildObservationRollup({
    observations: promptAnswerObservations,
    brandAliases,
  });

  // Phase 3.5F (2026-04-22): freshness signal derived from the fresh
  // `promptAnswerObservations` array. Today's visibility/ranking/competitor
  // charts all roll up from this table. When the newest observation is more
  // than 3 days old, surface a thin banner so the operator reads the cutoff
  // as "known state" not "broken product". Null when fresh.
  //
  // Perf bundle 4 (2026-05-12) — replaced the prior `.reduce(...)` walk
  // over ~14k observations with a lookup into the shared rollup. The
  // rollup builder tracks `latestObservedAt` in its single observation
  // pass; an equivalence test pins identical behaviour with the old
  // reduce.
  const lastObservationAt = observationRollup.latestObservedAt;
  let todayFreshness: {
    lastObservationDate: string;
    daysStale: number;
  } | null = null;
  if (lastObservationAt) {
    const lastMs = new Date(lastObservationAt).getTime();
    const ageDays = Math.floor((Date.now() - lastMs) / 86_400_000);
    if (ageDays >= 3) {
      todayFreshness = {
        lastObservationDate: lastObservationAt.slice(0, 10),
        daysStale: ageDays,
      };
    }
  }

  // Phase 3.5F: on Vercel the serverless scan path is incomplete (Phase 4 work).
  // Suppress the auto-scan strip + trigger so the hosted UI doesn't surface a
  // feature that would 500. Local dev keeps the button.
  const hostedScanDisabled = process.env.VERCEL === "1";

  // Commit 1 (2026-04-24): fetch today's per-platform native-poll health for
  // the top-of-Today status strip. Defensive: render-time Supabase hiccups
  // must not crash /today — we degrade to null and the PollHealthBlock is
  // simply not rendered. The 10:45 UTC canary workflow is the primary alert
  // channel; this block is the passive-observation one.
  let pollHealth: PollHealthSnapshot | null = null;
  try {
    // Bug-1 fix (2026-05-04): pass tenantId so poll-health can
    // cross-check actual prompt_answer_observations row counts against
    // the scope_label parsed from observation_runs. Catches the silent
    // dual-write failure pattern that surfaced May 2-4.
    pollHealth = await fetchPollHealthForDate(todayISOUtc(), tenantId);
  } catch (err) {
    console.error("Today poll-health fetch failed:", err);
    pollHealth = null;
  }

  // Commit 5 (2026-04-24): flip today's headline KPI tiles (Times AI
  // recommended you / How often AI mentions you) off raw `results` (frozen at
  // the Profound cliff — last row Apr 21) and onto `daily_metric_snapshots`
  // rows with source_type='derived' scope_type='platform'. Fallback policy:
  // today → yesterday → null (caller handles null by retaining old results-
  // based values; never falls through to source_type='benchmark'). Defensive:
  // Supabase hiccup at render-time degrades to null.
  let todayKpis: TodayDerivedKpis | null = null;
  try {
    todayKpis = await fetchTodayDerivedKpis();
  } catch (err) {
    console.error("Today derived KPI fetch failed:", err);
    todayKpis = null;
  }

  // Commit 7C (2026-04-24): roll up today's native observations into
  // extraction-v1/v2 badges. Reads from the already-seeded
  // promptAnswerObservations canonical store (no extra Supabase round-trip).
  // Renders nothing when rollup is null or totalObservations=0.
  //
  // T1 (operator audit, 2026-05-05) — pass tenant `stripWords` through
  // so the runtime descriptor-quality filter knows about Bay-Area cities
  // and brand parts on top of the global stopword list.
  const tenantStripWordsForRollups = getBusinessConfig().stripWords ?? [];
  let enrichmentRollup: EnrichmentRollup | null = null;
  try {
    // Phase 4.9: using fresh `promptAnswerObservations` from outer scope.
    enrichmentRollup = buildEnrichmentRollup({
      observations: promptAnswerObservations,
      date: todayISOUtc(),
      tenantStripWords: tenantStripWordsForRollups,
    });
    if (enrichmentRollup.totalObservations === 0) {
      // Fall back to yesterday (mirrors today-kpis fallback behavior) so
      // a pre-cron /today load still surfaces the latest native signal.
      const yesterdayISO = new Date(Date.now() - 86_400_000)
        .toISOString()
        .slice(0, 10);
      const fallback = buildEnrichmentRollup({
        observations: promptAnswerObservations,
        date: yesterdayISO,
        tenantStripWords: tenantStripWordsForRollups,
      });
      if (fallback.totalObservations > 0) enrichmentRollup = fallback;
    }
  } catch (err) {
    console.error("Today enrichment rollup failed:", err);
    enrichmentRollup = null;
  }

  // W2 Step 2.3 (master plan, 2026-05-01) — "How AI described you THIS WEEK"
  // v2 bundle. Six rollups fed into one component. All pure aggregators
  // over the already-loaded `promptAnswerObservations` array; no extra
  // Supabase reads. Each step is independently try/catched so a single
  // rollup failure can't black out the whole section. The brand display
  // name (`brandAliases[0]`) is set further down — capture it inline so
  // the bundle is self-contained.
  let enrichmentV2: EnrichmentV2Data | null = null;
  try {
    const v2EndDate = todayISOUtc();
    const v2WindowDays = 7;
    const v2BrandAliases = [
      getBusinessConfig().name,
      getBusinessConfig().name.split(" ")[0],
    ].filter((a, i, arr) => a && arr.indexOf(a) === i);
    const v2BrandName = v2BrandAliases[0] ?? "You";

    // T1 — pass tenant stripWords to v2 rollups too.
    const brandV2Rollup = buildEnrichmentWindowRollup({
      observations: promptAnswerObservations,
      endDate: v2EndDate,
      windowDays: v2WindowDays,
      maxDescriptors: 5,
      tenantStripWords: tenantStripWordsForRollups,
    });

    const competitorOptions = buildCompetitorDropdown({
      observations: promptAnswerObservations,
      trackedEntities,
      endDate: v2EndDate,
      windowDays: v2WindowDays,
      limit: 8,
    });

    const competitorRollups: Record<string, CompetitorEnrichmentRollup> = {};
    for (const opt of competitorOptions) {
      competitorRollups[opt.name] = buildCompetitorEnrichmentRollup({
        observations: promptAnswerObservations,
        competitorName: opt.name,
        endDate: v2EndDate,
        windowDays: v2WindowDays,
        maxDescriptors: 5,
        tenantStripWords: tenantStripWordsForRollups,
      });
    }

    const sparklines = buildPlatformPrimaryRateSparklines({
      observations: promptAnswerObservations,
      endDate: v2EndDate,
      windowDays: 14,
    });

    const formatWins = buildFormatWinsRollup({
      observations: promptAnswerObservations,
      endDate: v2EndDate,
      windowDays: v2WindowDays,
    });

    enrichmentV2 = {
      brandName: v2BrandName,
      windowEndDate: v2EndDate,
      windowDays: v2WindowDays,
      brand: brandV2Rollup,
      competitorOptions,
      competitorRollups,
      sparklines,
      formatWins,
    };
  } catch (err) {
    console.error("Today enrichment-v2 bundle failed:", err);
    enrichmentV2 = null;
  }

  // Phase v5 Commit 5 (2026-04-24): prompts decision teaser — tiny card that
  // points into /prompts with category counts + a one-line summary sentence.
  // Uses the same aggregator /prompts uses; no Supabase round-trip of its
  // own. Defensive null fallback when something's off.
  //
  // Phase v6 Commit 5 (2026-04-23): piggyback on the same matrix to build the
  // Top Pick card. Queue top-1 lands as a single opinionated Today card so
  // the operator sees the day's prioritized work at a glance.
  let promptsTeaser: PromptsTeaserSummary | null = null;
  let topPick: TopPickSummary | null = null;
  try {
    // Phase 4.9: using fresh canonical arrays from outer scope.
    const matrix = buildPromptDecisionMatrix({
      prompts: trackedPrompts,
      observations: promptAnswerObservations,
      activeEntities: trackedEntities,
      now: new Date(),
    });
    if (matrix.prompts.length > 0) {
      promptsTeaser = {
        totalPrompts: matrix.prompts.length,
        groupSummaries: matrix.groupSummaries,
      };
      const candidates = generateRecommendations({
        matrix,
        activeEntities: trackedEntities,
        trackedPrompts,
      });
      // v7 Commit 1 + 2 (2026-04-23): observation-led resolver + page
      // inventory fallback. Top Pick card gets a resolved URL either
      // from cluster observations or from the site inventory when AI
      // hasn't cited the page yet.
      // Sprint 7 Phase 7.5c/3 (2026-04-25) — replaced dynamic import of
      // module-level `allPages` with the lazy tenant-scoped function.
      const inventoryPages = await getOwnedPages();
      // EGRESS-P0 (2026-05-07) — page_snapshots was previously fetched
      // twice per /today render (once here, once below for general
      // use), pulling ~50MB twice from the wire. Hoisted to a single
      // shared promise via getPageSnapshotsShared() — same tenant repo
      // backs both call sites, so the result is identical.
      const pageSnapshotsForInventory = await getPageSnapshotsShared();
      const pageInventoryForTopPick = buildPageInventory({
        pages: inventoryPages,
        snapshots: pageSnapshotsForInventory,
        activeEntities: trackedEntities,
      });
      const resolved = resolvePageIntent({
        candidates,
        observations: promptAnswerObservations,
        activeEntities: trackedEntities,
        pageInventory: pageInventoryForTopPick,
      });
      const { queue } = prioritizeRecommendations(resolved);
      // Phase 4.3 hotfix (2026-04-24): the new-pipeline topPick carries
      // a `stableKey` that matches the canonical key /recommendations
      // writes to `recommendation_responses.rec_id`. Suppress dismissed
      // / future-deferred recs here so a rec the operator dismissed on
      // /recommendations doesn't reappear as Today's Top Pick. Previously
      // the queue was consumed raw (queue[0]) and the old-engine
      // suppression (via `primaryAction.id`) was in a different key
      // space — so /recommendations dismissals never reached Today.
      // Fall-through: skip any suppressed rec and take the next best.
      const unsuppressedQueue = queue.filter(
        (rec) =>
          !isRecSuppressedFromMap(rec.stableKey, freshResponsesByRecId),
      );
      const top = unsuppressedQueue[0];
      if (top) {
        topPick = buildTopPickSummary(top);
      }
    }
  } catch (err) {
    console.error("Today prompts teaser / top pick failed:", err);
    promptsTeaser = null;
    topPick = null;
  }

  // Same signal as shell `isDemoMode` (Phase 2A): no import runs ⇒ sample seed data, not operator briefing.
  const isDemoMode = !hasActiveExperiment();

  // Overdue signal for client-side scan trigger (Phase 1A-5); scan never runs during this render.
  const scanSettings = getScanSettings();
  const lastCrawlRun = await latestWebsiteCrawlRun();
  const scanOverdue = isScanOverdue(lastCrawlRun?.completed_at ?? null, scanSettings);

  const repo = getRepository().forTenant(tenantId);
  // EGRESS-P0 (2026-05-07) — share the page_snapshots fetch with the
  // top-pick path above (~50MB savings per /today render).
  const pageSnapshots = await getPageSnapshotsShared();
  const guardrailAlerts = await repo.getGuardrailAlerts();

  // Phase 6A.7 (2026-04-28) — lifecycle status strip + implementation queue.
  // Reads recommended_edits from the same tenant-scoped repo as /changes
  // (Phase 6A.2) so the counts on Today and the tabs on /changes always
  // reconcile. Non-fatal: a Supabase blip degrades the strip to zeros.
  // T-LiveChanges (2026-05-08) — pass already-loaded changelog +
  // url_change_outcomes through so the lifecycle summary can also
  // surface actual verified_live rows alongside the count chips.
  const lifecycleSummary = await buildTodayLifecycleSummary(
    repo,
    changelogEntries,
    urlChangeOutcomes,
    new Date(),
  );

  // Perf+egress bundle (2026-05-12) — `getTenantScanFindingsCached`
  // wraps the same `getRepository().forTenant().getScanFindings()`
  // call in `React.cache`, so repeated reads inside one render pay
  // a single Supabase round-trip. Today this call site is the only
  // hot consumer; the wrapper is in place for any future caller
  // (shell layout, action handlers) that needs the same data.
  const allScanFindings = await getTenantScanFindingsCached();
  const pendingFindings = allScanFindings
    .filter((f) => f.status === "pending")
    .sort((a, b) => {
      const po =
        (FINDING_PRIORITY_ORDER[a.priority] ?? 3) -
        (FINDING_PRIORITY_ORDER[b.priority] ?? 3);
      if (po !== 0) return po;
      return b.priorityScore - a.priorityScore;
    });
  const resolvedFindingsCount = allScanFindings.filter(
    (f) => f.status !== "pending",
  ).length;

  const { attribution: attrResults } = partitionResultsByMode(results);
  const events = detectOutcomeEvents(attrResults);
  const eventDecisions = await getEventDecisions();
  const decidedEventIds = new Set(eventDecisions.map((d) => d.event_id));
  const scorecardRows = computeScorecard(
    changelogEntries,
    results,
    opportunities,
    eventDecisions
  );

  const impactRows = enrichWithImpact(scorecardRows);
  const IMPACT_VERDICT_PRIORITY: Record<string, number> = {
    validated: 0,
    negative: 1,
    partial: 2,
    inconclusive: 3,
    no_impact: 4,
    too_early: 5,
    pending: 6,
  };
  const IMPACT_CONF_PRIORITY: Record<string, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };
  // ── Visibility summary from results ──
  const dates = results.map((r) => r.snapshot_date).sort();
  const latestDate = dates[dates.length - 1] ?? null;
  const earliestDate = dates[0] ?? null;

  const totalCitations = results.reduce((s, r) => s + r.citation_count, 0);
  const totalMentions = results.reduce((s, r) => s + r.mention_count, 0);

  const platformCounts = new Map<string, { citations: number; mentions: number }>();
  for (const r of results) {
    if (r.platform === "all") continue;
    const p = platformCounts.get(r.platform) ?? { citations: 0, mentions: 0 };
    p.citations += r.citation_count;
    p.mentions += r.mention_count;
    platformCounts.set(r.platform, p);
  }
  const platformBreakdown = [...platformCounts.entries()]
    .map(([platform, counts]) => ({
      platform,
      label: PLATFORM_LABELS[platform as Platform] ?? platform,
      citations: counts.citations,
      mentions: counts.mentions,
    }))
    .sort((a, b) => b.citations - a.citations || b.mentions - a.mentions);

  const midDate = earliestDate && latestDate
    ? new Date(
        (new Date(earliestDate).getTime() + new Date(latestDate).getTime()) / 2
      ).toISOString().slice(0, 10)
    : null;

  let trendPct: number | null = null;
  if (midDate && results.length > 20) {
    const firstHalf = results.filter((r) => r.snapshot_date <= midDate);
    const secondHalf = results.filter((r) => r.snapshot_date > midDate);
    const firstCit = firstHalf.reduce((s, r) => s + r.citation_count, 0);
    const secondCit = secondHalf.reduce((s, r) => s + r.citation_count, 0);
    if (firstCit > 0) {
      trendPct = Math.round(((secondCit - firstCit) / firstCit) * 100);
    }
  }

  // ── Week-over-week deltas ──
  let weekOverWeekCitations: number | null = null;
  let weekOverWeekMentions: number | null = null;
  if (latestDate) {
    const latestMs = new Date(latestDate).getTime();
    const thisWeek = results.filter((r) => {
      const d = new Date(r.snapshot_date).getTime();
      return d > latestMs - 7 * 86_400_000;
    });
    const lastWeek = results.filter((r) => {
      const d = new Date(r.snapshot_date).getTime();
      return d > latestMs - 14 * 86_400_000 && d <= latestMs - 7 * 86_400_000;
    });
    if (lastWeek.length > 0) {
      const twCit = thisWeek.reduce((s, r) => s + r.citation_count, 0);
      const lwCit = lastWeek.reduce((s, r) => s + r.citation_count, 0);
      if (lwCit > 0) {
        weekOverWeekCitations = Math.round(((twCit - lwCit) / lwCit) * 100);
      }
      const twMen = thisWeek.reduce((s, r) => s + r.mention_count, 0);
      const lwMen = lastWeek.reduce((s, r) => s + r.mention_count, 0);
      if (lwMen > 0) {
        weekOverWeekMentions = Math.round(((twMen - lwMen) / lwMen) * 100);
      }
    }
  }

  const visibilitySummary = {
    totalCitations,
    totalMentions,
    platformBreakdown,
    dateRange: earliestDate && latestDate ? { from: earliestDate, to: latestDate } : null,
    latestImportDate: latestDate,
    trendPct,
    resultCount: results.length,
    weekOverWeekCitations,
    weekOverWeekMentions,
  };

  const actionableImpact = impactRows
    .filter(
      (r) =>
        r.verdict !== "too_early" &&
        r.verdict !== "pending" &&
        r.totalEventsLinked > 0,
    )
    .sort(
      (a, b) =>
        (IMPACT_VERDICT_PRIORITY[a.verdict] ?? 9) -
          (IMPACT_VERDICT_PRIORITY[b.verdict] ?? 9) ||
        (IMPACT_CONF_PRIORITY[a.impact.confidence] ?? 9) -
          (IMPACT_CONF_PRIORITY[b.impact.confidence] ?? 9) ||
        (b.topScore ?? 0) - (a.topScore ?? 0),
    )
    .slice(0, 3)
    .map((r) => ({
      changeId: r.change.id,
      assetName: r.change.asset_name,
      verdict: r.verdict,
      confidence: r.impact.confidence,
      direction: r.impact.direction,
      nextAction: r.impact.nextAction,
      topScore: r.topScore,
      totalEvents: r.totalEventsLinked,
      platforms: r.platforms,
      href: `/changes/${r.change.id}`,
    }));

  let easyCalls = 0;
  let undecidedCount = 0;
  for (const event of events) {
    if (decidedEventIds.has(event.id)) continue;
    const result = results.find((r) => r.id === event.anchor_result_id);
    if (!result) continue;
    const candidates = discoverCandidates(result, changelogEntries, opportunities);
    if (candidates.length === 0) continue;
    const triage = triageCandidates(candidates);
    if (triage.autoResolved || triage.needsReview.length === 0) continue;
    undecidedCount++;
    const actionable = [
      ...(triage.primary ? [triage.primary] : []),
      ...triage.contributing,
      ...triage.needsReview,
    ].sort((a, b) => b.score - a.score);
    const top = actionable[0];
    const second = actionable.length > 1 ? actionable[1] : null;
    const gap = second ? Math.round(top.score - second.score) : top.score;
    if ((triage.primary && gap >= 10) || (!triage.primary && gap >= 15))
      easyCalls++;
  }

  const warningAlerts = guardrailAlerts.filter(
    (a) =>
      a.severity === "warning" ||
      a.severity === "critical" ||
      a.severity === "regression"
  );

  const activeCrawl = await latestWebsiteCrawlRun();
  const activeCrawlId = activeCrawl?.run_id ?? null;

  const citationIndex2 = citationEvidenceIndex as {
    by_page_and_topic: {
      page_url: string;
      is_owned: boolean;
      total_citations: number;
    }[];
    by_topic: { topic: string }[];
  } | null;

  const citMap = new Map<string, number>();
  if (citationIndex2) {
    for (const r of citationIndex2.by_page_and_topic) {
      if (!r.is_owned) continue;
      const key = r.page_url.replace(/\/+$/, "").toLowerCase();
      citMap.set(key, (citMap.get(key) ?? 0) + r.total_citations);
    }
  }

  const patterns = minePatterns(
    pageSnapshots,
    citMap,
    scorecardRows,
    rolloutExecutions,
    persistedPatternEvidence
  );
  const playbookBriefs = generateBriefs(pageSnapshots, citMap, patterns);
  const topBriefs = playbookBriefs
    .filter((b) => b.type === "growth")
    .slice(0, 2);

  const newIssues = pageIssues.filter((i) => i.status === "new");
  const shippedIssues = pageIssues.filter((i) => i.status === "shipped");
  const handedOffIssues = pageIssues.filter(
    (i) => i.status === "handed_off" || i.status === "in_progress"
  );
  const verifiedIssues = pageIssues.filter((i) => i.status === "verified");

  const urlToPageId = new Map<string, string>();
  for (const p of allPages) {
    urlToPageId.set(p.url.replace(/\/+$/, "").toLowerCase(), p.id);
  }

  function pagesHref(pageUrl: string, briefId?: string): string {
    const pageId = urlToPageId.get(pageUrl.replace(/\/+$/, "").toLowerCase());
    if (!pageId) return "/pages";
    return briefId ? `/pages?p=${pageId}&b=${briefId}` : `/pages?p=${pageId}`;
  }

  type PlainGroup = "fix_this" | "in_progress" | "wins";
  function toPlainGroup(g: string): PlainGroup {
    if (g === "fix" || g === "ship" || g === "frontier" || g === "review")
      return "fix_this";
    if (g === "verify" || g === "waiting") return "in_progress";
    return "wins";
  }

  const items: TodayQueueItem[] = [];

  for (const a of warningAlerts) {
    const matchingIssue = newIssues.find((i) => i.pageUrl === a.url);
    const runId = a.observation_run_id ?? activeCrawlId;
    items.push({
      id: `alert-${a.category}-${a.url}`,
      group: "fix",
      label: a.message
        .replace(/citations/g, "tracked mentions")
        .replace(/no FAQ or schema/g, "missing Q&A content"),
      meta: runId
        ? "Found during crawl"
        : "Found during crawl (older scan, no run ID)",
      href: pagesHref(a.url),
      dot: "bg-status-danger",
      detail: a.detail
        .replace(/citation/gi, "tracked mention")
        .replace(/FAQ/g, "Q&A")
        .replace(/schema/g, "structured data")
        .replace(/structural/gi, "page"),
      issueId: matchingIssue?.issueId,
      issueStatus: matchingIssue?.status ?? "new",
      pageUrl: a.url,
      pagePath: stripSiteOrigin(a.url),
      observationRunId: runId,
      observationRunHref: runId
        ? `/observations/${encodeURIComponent(runId)}`
        : null,
    });
  }

  for (const issue of shippedIssues) {
    items.push({
      id: `verify-${issue.issueId}`,
      group: "verify",
      label: `Verify ship · ${issue.pagePath || "/"}`,
      meta: "Ship verification pending",
      href: pagesHref(issue.pageUrl),
      dot: "bg-accent-primary",
      detail:
        issue.verifyResult?.summary ??
        "Re-fetch the page and compare to the expected fix checklist.",
      issueId: issue.issueId,
      issueStatus: issue.status,
      pageUrl: issue.pageUrl,
      pagePath: issue.pagePath,
    });
  }

  if (easyCalls > 0) {
    items.push({
      id: "review-easy",
      group: "review",
      label: `${easyCalls} Review item${easyCalls !== 1 ? "s" : ""} with wider score gap`,
      meta: "Why did visibility change? · attribution",
      href: "/changes?tab=attribution",
      dot: "bg-muted-foreground",
      detail:
        "Review the suggested cause and lock it if it matches what you know. This is about why visibility shifted, not what changed on your site.",
    });
  }
  if (undecidedCount - easyCalls > 0) {
    items.push({
      id: "review-remaining",
      group: "review",
      label: `${undecidedCount - easyCalls} more visibility shifts in Review`,
      meta: "Why did visibility change? · needs decision",
      href: "/changes?tab=attribution",
      dot: "bg-status-warning",
      detail:
        "Each row links a visibility shift to a possible cause. Lock the best match when you know what happened.",
    });
  }

  for (const pb of topBriefs) {
    const rolloutIssue = pageIssues.find(
      (i) =>
        i.issueId ===
        `rollout-${pb.id}-${(pb.pageUrl.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "") || "/").replace(/\//g, "-").replace(/^-/, "")}`
    );
    const rs = rolloutIssue?.status;
    if (rs === "verified" || rs === "dismissed") continue;

    const group =
      rs === "shipped"
        ? ("verify" as const)
        : rs === "handed_off" || rs === "in_progress"
          ? ("waiting" as const)
          : ("ship" as const);
    const dot =
      rs === "shipped"
        ? "bg-accent-primary"
        : rs === "handed_off" || rs === "in_progress"
          ? "bg-status-warning"
          : "bg-muted-foreground";
    const meta =
      rs === "shipped"
        ? "Awaiting ship verification"
        : rs === "handed_off"
          ? `Handed off · ${pb.patternName}`
          : `Pattern gap · ${pb.patternName}`;

    items.push({
      id: `brief-${pb.id}`,
      group,
      label: pb.title,
      meta,
      href: pagesHref(pb.pageUrl, pb.id),
      dot,
      detail: pb.rationale,
      issueId: rolloutIssue?.issueId,
      issueStatus: rs ?? undefined,
      pageUrl: pb.pageUrl,
      pagePath: pb.pagePath,
    });
  }

  // ── Citation decay: detect declining pages ──
  const { siteDomain } = getSiteConfig();
  const decayResults = computeCitationDecay(siteDomain);
  const decayAlerts = getDecayAlerts(decayResults);
  const geoForLocal = computeGeoCoverage(
    allPages,
    citationEvidenceIndex?.by_page_and_topic ?? [],
    activePrompts,
  );
  const topLocalGap = geoForLocal.gaps[0] ?? null;
  const meaningfulDecayCount = decayAlerts.filter(
    (d) => d.status === "meaningful_decline",
  ).length;
  const localOperatorSurface = computeLocalOperatorSurface({
    business: getBusinessConfig(),
    importRow: await loadLocalOperatorImport(),
    geoGap: topLocalGap
      ? {
          city: topLocalGap.city,
          competitor_pages: topLocalGap.competitor_pages,
          owned_pages: topLocalGap.owned_pages,
        }
      : null,
    meaningfulDecayCount,
  });

  // change-patterns: GLOBAL store (cross-tenant aggregate by design) — direct
  // readStore stays. change-outcomes: tenant-scoped (Phase 7.5a stamped the
  // .data file); read via the tenant adapter so the filter fires.
  const changePatterns = await readStore<import("@/domains/learning/change-patterns").ChangePattern>("change-patterns");
  const changeOutcomes = await getOutcomesForTenant(tenantId);
  // Phase 4 (2026-04-19): "active experiments" concept removed. Scanner watches
  // every URL change automatically via url-watcher; no opt-in required. The
  // gap-scanner still wants to avoid recommending on URLs where we're already
  // watching \u2014 feed it the current watchlist from url-change-outcomes.
  const { getWatchingUrlOutcomes } = await import("@/domains/attribution/url-change-outcome");
  const activeExperimentUrls = new Set<string>(
    (await getWatchingUrlOutcomes()).map((o) => o.url.replace(/\/+$/, "").toLowerCase()),
  );
  // Build query keyword index from fan-out data — unlocks 5,289 real search
  // queries for keyword optimization recs AND morning brief step generation.
  // Phase 4.9: using fresh `promptAnswerObservations` from outer scope.
  const queryIndex = buildQueryKeywordIndex(citationEvidenceIndex, promptAnswerObservations);

  // Phase 7 Part 1b (2026-04-18): load answer-texts from disk so the
  // data-grounded keyword-gap scanner has the raw AI answer corpus to mine
  // for competitor-citing vs you-citing phrase deltas. Cheap read (~38 MB
  // hit once per render; cold-store internally caches).
  const { readAnswerTextsFromDisk } = await import("@/lib/persistence/cold-store");
  const answerTexts = readAnswerTextsFromDisk();

  // Brand aliases for the scanner. Pre-bundle-4 today-data built a
  // separate `scannerBrandAliases` array here that was identical to the
  // `brandAliases` declared near the top of the function. The rollup
  // builder handles brand-alias exclusion using that single source of
  // truth, so the scanner's local copy is no longer needed.
  const scannerBusinessConfig = getBusinessConfig();

  // Phase 7 Part 1b-v2: dynamic competitor exclusion list. businessConfig
  // lists only the top 5 primaryCompetitors, but observation data surfaces
  // 30+ competitor brands. Use top-40 non-brand mentions to keep
  // competitor names out of concept extraction.
  //
  // Perf bundle 4 (2026-05-12) — replaced the prior `for (const o of
  // promptAnswerObservations) { for (const m of o.mentions) { ... } }`
  // walk with a read from the shared rollup. The rollup builder pre-
  // computes `mentionCountsByOriginalName` (per-original-case key,
  // excluding brand aliases via lowercase comparison) in its single
  // observation pass. `brandAliases` (built at the top of this
  // function from `businessConfig.name` + first word, dedup-ed) is
  // the single source of truth, so the rollup-filtered counts are
  // byte-equivalent to the old inline result. Pinned by equivalence
  // test (`observation-rollup-equivalence.test.ts`).
  const scannerTopMentioned = [
    ...observationRollup.mentionCountsByOriginalName.entries(),
  ]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)
    .map(([name]) => name);
  const scannerCompetitorExclusions = Array.from(
    new Set([
      ...((scannerBusinessConfig as unknown as { competitors?: string[] }).competitors ?? []),
      ...(scannerBusinessConfig.primaryCompetitors ?? []),
      ...scannerTopMentioned,
    ]),
  );

  // Known city/location labels for the city-filter. Expand beyond
  // businessConfig.locations to include commonly-co-occurring neighbors
  // that AI frequently mentions together.
  const scannerKnownLocations: string[] = [
    ...(scannerBusinessConfig.locations ?? []),
    "Atherton", "Menlo Park", "Palo Alto", "Los Altos", "Los Altos Hills",
    "Cupertino", "Saratoga", "Portola Valley", "Woodside", "Mountain View",
    "Emerald Hills", "Redwood City", "San Carlos", "Hillsborough",
    "Silicon Valley", "Bay Area", "San Francisco", "Peninsula",
    "California", "CA", "USA",
  ];

  const allRecommendations = computeRecommendations({
    impactRows,
    patterns,
    briefs: playbookBriefs,
    pageSnapshots,
    citationCountMap: citMap,
    citationIndex: citationEvidenceIndex,
    allPages,
    decayResults,
    answerIntelligence: answerIntelligenceIndex,
    changelogEntries,
    changePatterns,
    activeExperimentUrls,
    // 2026-04-20: changeOutcomes (topic-level) no longer used for prior-success
    // attribution. urlChangeOutcomes (URL-level Z-score) is the new source.
    urlChangeOutcomes,
    sectionAnalyzerConfig: getSectionAnalyzerConfig(),
    queryIndex,
    observations: promptAnswerObservations,
    answerTexts,
    // Perf bundle 4 (2026-05-12) — `scannerBrandAliases` was identical
    // to the top-of-function `brandAliases`; reusing the latter.
    brandAliases,
    competitorExclusions: scannerCompetitorExclusions,
    knownLocations: scannerKnownLocations,
    // Phase 3-post (2026-04-20): widen tenant scope for the page-job-fit
    // router beyond current-site vocabulary. Optional and non-blocking — if
    // business-config lacks these fields, fallback is corpus-derived only.
    tenantServices: scannerBusinessConfig.services ?? [],
    additionalGenerics: scannerBusinessConfig.stripWords ?? [],
  });

  // Filter out dismissed / deferred-but-not-due recommendations.
  // Phase 4.3: uses fresh repo map, not module-level array.
  const recommendations = allRecommendations.filter(
    (r) => !isRecSuppressedFromMap(r.id, freshResponsesByRecId),
  );

  const briefPatternCounts = new Map<string, number>();
  for (const b of playbookBriefs) {
    briefPatternCounts.set(
      b.patternId,
      (briefPatternCounts.get(b.patternId) ?? 0) + 1,
    );
  }

  const trackRecord = computeTrackRecord({
    impactRows,
    patterns,
    // Phase 4.3: fresh repo array, not module-level.
    responses: freshRecommendationResponses,
    recommendations: allRecommendations,
  });

  // Phase 4 (2026-04-19): recIds-with-accepted-status now come from the
  // recommendation-response store directly (what the operator clicked "Apply
  // this" on), not from a separate experiment table.
  // Phase 4.3: fresh repo array, not module-level.
  const activeExperimentRecIdSet = new Set(
    freshRecommendationResponses
      .filter((r) => r.status === "accepted")
      .map((r) => r.recId),
  );
  const replicationResponsesByRecId = new Map(
    freshRecommendationResponses.map((r) => [r.recId, r]),
  );
  const replicationImpactCards = buildReplicationCards({
    recommendations,
    impactRows,
    patterns,
    rolloutExecutions,
    pageIssues,
    activeExperimentRecIds: activeExperimentRecIdSet,
    responsesByRecId: replicationResponsesByRecId,
  });
  const replicationExcludeRecIds = new Set(
    replicationImpactCards.flatMap((c) => c.targets.map((t) => t.recId)),
  );
  // Phase 4 (2026-04-19): experiment-based promising seed removed. Replication
  // "promising" seeding is disabled for now; will be rebuilt on top of
  // url-change-outcomes `helping` verdicts in a later phase.
  const replicationPromisingCards = buildPromisingReplicationCards(
    [],
    allRecommendations,
    impactRows,
    patterns,
    rolloutExecutions,
    pageIssues,
    replicationExcludeRecIds,
  );
  const replicationWorkspaceCards = [
    ...replicationImpactCards,
    ...replicationPromisingCards,
  ];
  const replicationBeneficiaryPages = new Set<string>();
  for (const card of replicationWorkspaceCards) {
    for (const t of card.targets) {
      replicationBeneficiaryPages.add(
        t.targetPageUrl.replace(/\/+$/, "").toLowerCase(),
      );
    }
  }
  const replicationSummaryForToday =
    replicationBeneficiaryPages.size > 0
      ? { pageCount: replicationBeneficiaryPages.size }
      : null;

  const { primaryAction, secondary: secondaryActions } = rankAndSelect({
    recommendations,
    impactRows,
    patterns,
    briefPatternCounts,
    patternTrackRecords: trackRecord.patternRecords,
  });

  // 2026-04-20: topic-level MemoryInsight pipeline removed. Attribution now
  // lives entirely in url-change-outcomes (URL-level Z-score engine).

  // ── Competitor monitoring alerts (Phase 5) ──
  const competitorMonState = await getCompetitorMonitoringState();
  const competitorAlerts = generateCompetitorAlerts(competitorMonState.recentChanges);

  // queryIndex already built above — used in both rec engine and morning brief.

  const morningBrief: MorningBriefData = buildMorningBrief({
    primaryAction,
    secondaryActions,
    answerIntelligence: answerIntelligenceIndex,
    citationIndex: citationEvidenceIndex,
    trendPct: visibilitySummary.trendPct,
    totalOwnedCitations: visibilitySummary.totalCitations,
    latestDataDate: visibilitySummary.dateRange?.to ?? null,
    memoryInsights: [],
    competitorAlerts,
    competitorSnapshots: competitorMonState.snapshots,
    faqTemplates: getFaqTemplates(),
    pageSnapshots,
    queryIndex,
  });

  function recHref(r: { type: string; targetPageUrl: string | null; sourceChangeId: string | null }): string {
    if (r.targetPageUrl) return pagesHref(r.targetPageUrl);
    if (r.sourceChangeId) return `/changes/${r.sourceChangeId}`;
    if (r.type === "competitive_displacement" || r.type === "topic_cluster_gap") return "/competitors";
    return "/pages";
  }

  // Outcome backfill moved to post-import (Phase 1C-1) — Today render is now read-only
  // for the outcome store. See src/domains/product/outcome-backfill.ts.

  /** Phase 2 (2026-04-20): classify the strongest honest evidence basis for a
   *  recommendation-engine rec (primary / secondary). Hurting / helping /
   *  schema-parity cards are classified separately at their build sites
   *  below. */
  function buildEvidenceBasis(rec: typeof primaryAction): "heuristic" | "tenant_history" | "current_dataset" | "shared_pattern" {
    if (!rec) return "heuristic";
    const patternTr = rec.patternId
      ? trackRecord.patternRecords.find((p) => p.patternId === rec.patternId)
      : null;
    const minedPattern = rec.patternId
      ? patterns.find((p) => p.id === rec.patternId)
      : null;
    return classifyEvidenceBasis({
      recType: rec.type,
      hasPriorSuccess: Boolean(rec.priorSuccess),
      patternTrackRecord: patternTr
        ? { successRate: patternTr.successRate, actedOn: patternTr.actedOn }
        : null,
      minedPatternStrength: minedPattern?.strength ?? null,
      baselineCitations:
        typeof rec.citationOpportunity === "number" ? rec.citationOpportunity : null,
      // shared-brain not consulted at render time (Phase 2 stays honest:
      // no cross-site label without explicit BrainPattern evidence).
      brainPatternStrength: null,
    });
  }

  function buildConfidenceReason(rec: typeof primaryAction): string {
    if (!rec) return "";
    const parts: string[] = [];
    if (rec.confidence === "high") {
      if (rec.sourceChangeId) parts.push("validated source change");
      if (rec.citationOpportunity >= 50) parts.push(`${rec.citationOpportunity} existing citations`);
      if (!parts.length) parts.push("strong evidence match");
    } else if (rec.confidence === "medium") {
      if (rec.sourceChangeId) parts.push("partial source evidence");
      if (rec.citationOpportunity >= 10) parts.push(`${rec.citationOpportunity} citations`);
      if (!parts.length) parts.push("moderate evidence");
    } else {
      parts.push("early signal");
    }
    const patternTr = rec.patternId ? trackRecord.patternRecords.find((p) => p.patternId === rec.patternId) : null;
    if (patternTr && patternTr.actedOn >= 2) {
      parts.push(`${Math.round(patternTr.successRate * 100)}% pattern success rate`);
    }
    return parts.join(" · ");
  }

  function buildWatchAfter(rec: typeof primaryAction): string {
    if (!rec) return "";
    // Dynamic timing from engine_timing when available
    const timing = rec.engineTiming;
    if (timing && timing.length > 0) {
      const sorted = timing.sort(
        (a: { medianDays: number }, b: { medianDays: number }) => a.medianDays - b.medianDays,
      );
      const allSame = sorted.every(
        (t: { medianDays: number }) => t.medianDays === sorted[0].medianDays,
      );
      if (allSame && sorted.length > 1) {
        // All platforms show same timing — present as range using earliest/latest from pattern data
        const earliest = Math.min(
          ...sorted.map((t: { medianDays: number }) => Math.max(t.medianDays - 14, 7)),
        );
        const latest = Math.max(
          ...sorted.map((t: { medianDays: number }) => t.medianDays + 5),
        );
        return `Expected signal: ${earliest}–${latest} days depending on platform (${sorted[0].sampleCount} observations).`;
      }
      const parts = sorted.map(
        (t: { platform: string; medianDays: number; sampleCount: number }) =>
          `${t.platform}: ~${t.medianDays}d`,
      );
      return `Expected signal: ${parts.join(", ")}. Monitor after acting.`;
    }
    if (rec.type === "investigate") return "Watch for further visibility changes on the affected topics. If decline stabilizes, the cause may be external.";
    if (rec.type === "strengthen") return "After updating the changelog entry, check if attribution events auto-resolve.";
    if (rec.type === "strengthen_structure") return "After adding structure, monitor citation counts for this page over 1-2 import cycles.";
    if (rec.type === "improve_internal_links") return "After adding links, watch for citation count changes and crawl coverage in the next import.";
    if (rec.type === "refresh_content") return "After deepening content, monitor whether citation count or mention count increases in future imports.";
    if (rec.type === "competitive_displacement") return "After strengthening your content for this topic, watch for citation share shift vs competitors in future imports.";
    if (rec.type === "cross_page_pattern") return "After applying this pattern, monitor the target page for citation count changes. The source pattern took effect within 1-2 import cycles.";
    if (rec.type === "topic_cluster_gap") return "After creating the new content, watch for the topic to appear in your citation evidence for the new page type.";
    if (rec.type === "refresh_stale_citation") return "After refreshing content, monitor citation counts over the next 1-2 import cycles for recovery.";
    return "After acting, import fresh data and check whether Beacon detects a positive visibility change for the target page.";
  }

  const dataFreshness = visibilitySummary.dateRange
    ? `Based on data through ${visibilitySummary.dateRange.to}`
    : null;

  // Experiment citation sync moved to post-import (Phase 1C-2) — Today render is now read-only
  // for the experiment store. See src/domains/product/experiment-citation-sync.ts.

  const primaryLineage = primaryAction
    ? recommendationLineageBullets({
        sourceEvidence: primaryAction.sourceEvidence,
        type: primaryAction.type,
        sourceChangeId: primaryAction.sourceChangeId,
        dataFreshness,
        priorSuccess: primaryAction.priorSuccess ?? null,
        expectedMetric: primaryAction.expectedMetric ?? null,
      })
    : [];

  const serializedPrimary = primaryAction
    ? {
        id: primaryAction.id,
        headline: primaryAction.headline,
        rationale: primaryAction.rationale,
        expectedOutcome: primaryAction.expectedOutcome,
        sourceEvidence: primaryAction.sourceEvidence,
        priorityScore: primaryAction.priorityScore,
        bucket: primaryAction.bucket as "critical" | "high_leverage" | "opportunistic",
        type: primaryAction.type,
        confidence: primaryAction.confidence,
        href: recHref(primaryAction),
        // Phase 4.3: fresh repo map, not module-level.
        responseStatus:
          getResponseFromMap(primaryAction.id, freshResponsesByRecId)
            ?.status ?? null,
        confidenceReason: buildConfidenceReason(primaryAction),
        watchAfter: buildWatchAfter(primaryAction),
        dataFreshness,
        hasExperiment: false, // Phase 4: experiment store removed; field kept for client-side type compat.
        targetPageUrl: primaryAction.targetPageUrl,
        targetPagePath: primaryAction.targetPagePath,
        baselineCitations: primaryAction.targetPageUrl
          ? (citMap.get(primaryAction.targetPageUrl.replace(/\/+$/, "").toLowerCase()) ?? 0)
          : null,
        sourceChangeId: primaryAction.sourceChangeId,
        lineageBullets: primaryLineage,
        answerContext: primaryAction.answerContext ?? null,
        specificMove: primaryAction.specificMove ?? null,
        actionClass: primaryAction.actionClass ?? null,
        targetSection: primaryAction.targetSection ?? null,
        priorSuccess: primaryAction.priorSuccess ?? null,
        engineTiming: primaryAction.engineTiming ?? null,
        expectedMetric: primaryAction.expectedMetric ?? null,
        evidenceBasis: buildEvidenceBasis(primaryAction),
        // Phase 3-post (2026-04-20): page-job-fit router verdict.
        placementMode: primaryAction.placementMode ?? "keep",
        movedFromPath: primaryAction.movedFromPath ?? null,
        // Fix 2 (2026-04-21): carried to the accept handler so the response
        // store can auto-link a later-detected change on this URL back to
        // this acceptance. Null when rec isn't pattern-backed.
        patternId: primaryAction.patternId ?? null,
      }
    : null;

  // Serialize secondary action (next best recommendation after primary).
  // Phase 4.3: fresh repo map, not module-level.
  const secondaryRec =
    secondaryActions.filter(
      (r) => !isRecSuppressedFromMap(r.id, freshResponsesByRecId),
    )[0] ?? null;
  const serializedSecondary = secondaryRec
    ? {
        id: secondaryRec.id,
        headline: secondaryRec.headline,
        rationale: secondaryRec.rationale,
        expectedOutcome: secondaryRec.expectedOutcome,
        sourceEvidence: secondaryRec.sourceEvidence,
        priorityScore: secondaryRec.priorityScore,
        bucket: secondaryRec.bucket as "critical" | "high_leverage" | "opportunistic",
        type: secondaryRec.type,
        confidence: secondaryRec.confidence,
        href: recHref(secondaryRec),
        // Phase 4.3: fresh repo map, not module-level.
        responseStatus:
          getResponseFromMap(secondaryRec.id, freshResponsesByRecId)
            ?.status ?? null,
        confidenceReason: buildConfidenceReason(secondaryRec),
        watchAfter: buildWatchAfter(secondaryRec),
        dataFreshness,
        hasExperiment: false, // Phase 4: experiment store removed; field kept for client-side type compat.
        targetPageUrl: secondaryRec.targetPageUrl,
        targetPagePath: secondaryRec.targetPagePath,
        baselineCitations: secondaryRec.targetPageUrl
          ? (citMap.get(secondaryRec.targetPageUrl.replace(/\/+$/, "").toLowerCase()) ?? 0)
          : null,
        sourceChangeId: secondaryRec.sourceChangeId,
        lineageBullets: recommendationLineageBullets({
          sourceEvidence: secondaryRec.sourceEvidence,
          type: secondaryRec.type,
          sourceChangeId: secondaryRec.sourceChangeId,
          dataFreshness,
          priorSuccess: secondaryRec.priorSuccess ?? null,
          expectedMetric: secondaryRec.expectedMetric ?? null,
        }),
        answerContext: secondaryRec.answerContext ?? null,
        specificMove: secondaryRec.specificMove ?? null,
        actionClass: secondaryRec.actionClass ?? null,
        targetSection: secondaryRec.targetSection ?? null,
        priorSuccess: secondaryRec.priorSuccess ?? null,
        engineTiming: secondaryRec.engineTiming ?? null,
        expectedMetric: secondaryRec.expectedMetric ?? null,
        evidenceBasis: buildEvidenceBasis(secondaryRec),
        // Phase 3-post (2026-04-20): page-job-fit router verdict.
        placementMode: secondaryRec.placementMode ?? "keep",
        movedFromPath: secondaryRec.movedFromPath ?? null,
        // Fix 2 (2026-04-21): carried for the accept handler's auto-link.
        patternId: secondaryRec.patternId ?? null,
      }
    : null;

  // Scoreboard data for command center
  const citedPageCount = citationIndex2
    ? new Set(
        citationIndex2.by_page_and_topic
          .filter((r) => r.is_owned && r.total_citations > 0)
          .map((r) => r.page_url),
      ).size
    : 0;

  const answerIntelProof = answerIntelligenceIndex
    ? buildAnswerIntelligenceProofContext(answerIntelligenceIndex)
    : null;

  // Commit 5 (2026-04-24): when today's derived platform rows exist, the
  // headline "Times AI recommended you" / "How often AI mentions you" tiles
  // use those values instead of the frozen raw-results totals (which stop
  // updating at the Profound cliff, Apr 21). The TodayScoreboard renders an
  // "As of <date>" badge in tile meta when this happens. When todayKpis is
  // null (no derived rows today or yesterday) the tiles keep the
  // results-based totals so we never black-hole the header.
  const useDerivedKpis = todayKpis !== null;
  const scoreboard = {
    totalCitations: useDerivedKpis
      ? todayKpis!.totalCitations
      : visibilitySummary.totalCitations,
    totalMentions: useDerivedKpis
      ? todayKpis!.totalMentions
      : visibilitySummary.totalMentions,
    // Trend, week-over-week, and platform breakdown still read from raw
    // results because they need a wider date history than the last 1–2 days
    // of derived snapshots can provide. Commit 7 revisits once native has
    // multi-week history.
    trendPct: visibilitySummary.trendPct,
    platformBreakdown: visibilitySummary.platformBreakdown,
    citedPageCount,
    resultCount: visibilitySummary.resultCount,
    dateRange: visibilitySummary.dateRange,
    mentionRate: answerIntelProof?.overallMentionRate ?? null,
    decliningTopicCount: answerIntelProof?.decliningTopics.length ?? 0,
    risingTopicCount: answerIntelProof?.risingTopics.length ?? 0,
    weekOverWeekCitations: visibilitySummary.weekOverWeekCitations,
    weekOverWeekMentions: visibilitySummary.weekOverWeekMentions,
    /** ISO date rendered in tile meta when derived KPIs are in use. Null
     *  when tiles fell back to raw-results totals. */
    derivedKpiAsOfDate: useDerivedKpis ? todayKpis!.date : null,
    /** True when derived KPIs fell back to yesterday's row (e.g. pre-cron). */
    derivedKpiIsFallback: useDerivedKpis ? todayKpis!.isFallback : false,
    /**
     * Poll Integrity Hardening (2026-05-04, Operator R7). Aggregated
     * sampling status across both platforms for the as-of-date — when
     * "proof" or "partial", the headline tile renders a small-sample
     * tag so a 5-obs proof run doesn't read as a full 100-obs day.
     * Worst-case wins (a single proof platform downgrades the headline).
     */
    derivedKpiSamplingStatus:
      useDerivedKpis && pollHealth
        ? aggregateSamplingStatus(pollHealth)
        : null,
  };

  // FAQ schema coverage metric
  const pagesWithFaq = pageSnapshots.filter((s) => s.faqs.length > 0);
  const pagesWithFaqAndSchema = pagesWithFaq.filter((s) =>
    s.schema_types.some((t) => t.toLowerCase().includes("faq")),
  );
  const faqSchemaCoverage = pagesWithFaq.length > 0
    ? { covered: pagesWithFaqAndSchema.length, total: pagesWithFaq.length }
    : null;

  // Platform distribution for Today context strip
  // Normalizes raw citations into percentages across the 3 major AI platforms
  const platformDistribution = (() => {
    const total = visibilitySummary.platformBreakdown.reduce(
      (s, p) => s + p.citations,
      0,
    );
    if (total === 0) return null;
    const buckets = { google_aio: 0, chatgpt: 0, perplexity: 0, other: 0 };
    for (const p of visibilitySummary.platformBreakdown) {
      if (p.platform === "google_aio") buckets.google_aio += p.citations;
      else if (p.platform === "chatgpt") buckets.chatgpt += p.citations;
      else if (p.platform === "perplexity") buckets.perplexity += p.citations;
      else buckets.other += p.citations;
    }
    const pct = (n: number) => Math.round((n / total) * 100);
    const result = {
      google_aio: pct(buckets.google_aio),
      chatgpt: pct(buckets.chatgpt),
      perplexity: pct(buckets.perplexity),
      total,
    };
    return result;
  })();

  // Platform concentration risk: single platform > 85%
  const concentratedPlatform = platformDistribution
    ? (platformDistribution.google_aio > 85 ? "google_aio" as const
      : platformDistribution.chatgpt > 85 ? "chatgpt" as const
      : platformDistribution.perplexity > 85 ? "perplexity" as const
      : null)
    : null;

  const proposedWaves = planWaves(
    playbookBriefs,
    pageIssues,
    rolloutExecutions,
    persistedWaves
  );

  for (const w of persistedWaves) {
    if (w.status === "dismissed" || w.status === "completed") continue;
    const derived = deriveWaveStatus(w, pageIssues);
    const group =
      derived === "proposed"
        ? ("ship" as const)
        : derived === "partially_shipped" || derived === "shipped"
          ? ("verify" as const)
          : derived === "partially_verified"
            ? ("verify" as const)
            : ("waiting" as const);
    const dot =
      derived === "proposed"
        ? "bg-muted-foreground"
        : derived.includes("verified") || derived.includes("shipped")
          ? "bg-accent-primary"
          : "bg-status-warning";
    const progress = computeWaveProgress(w, pageIssues);
    items.push({
      id: `wave-${w.rolloutWaveId}`,
      group,
      label: w.title,
      meta: `Rollout plan · ${progress.verified}/${progress.totalPages} verified`,
      href: "/pages",
      dot,
      detail: w.rationale,
    });
  }

  for (const w of proposedWaves.slice(0, 1)) {
    if (persistedWaves.some((pw) => pw.rolloutWaveId === w.rolloutWaveId))
      continue;
    items.push({
      id: `wave-${w.rolloutWaveId}`,
      group: "ship",
      label: w.title,
      meta: `Rollout plan proposed · ${w.targetPages.length} pages`,
      href: "/pages",
      dot: "bg-muted-foreground",
      detail: w.rationale,
    });
  }

  for (const issue of handedOffIssues) {
    items.push({
      id: `waiting-${issue.issueId}`,
      group: "waiting",
      label: issue.pagePath || "/",
      meta: issue.handedOffAt
        ? `Handed off ${formatTimeAgo(new Date(issue.handedOffAt))}`
        : "Handed off",
      href: pagesHref(issue.pageUrl),
      dot: "bg-muted-foreground/40",
      detail:
        "When the fix ships, mark shipped and run verification from Pages.",
      issueId: issue.issueId,
      issueStatus: issue.status,
      pageUrl: issue.pageUrl,
      pagePath: issue.pagePath,
    });
  }

  const enrichedItems = items.map((item) => ({
    ...item,
    plainGroup: toPlainGroup(item.group),
  }));

  const verifiedFixes = verifiedIssues
    .filter((i) => i.verifiedAt)
    .sort(
      (a, b) =>
        new Date(b.verifiedAt!).getTime() - new Date(a.verifiedAt!).getTime()
    )
    .slice(0, 5)
    .map((i) => ({
      issueId: i.issueId,
      pagePath: i.pagePath || "/",
      href: pagesHref(i.pageUrl),
      verifiedAt: i.verifiedAt!,
      summary: i.verifyResult?.summary ?? "Verified",
      verificationObservationRunId: i.verificationObservationRunId ?? null,
      verificationBaselineObservationRunId:
        i.verificationBaselineObservationRunId ?? null,
      verificationBindingLegacy: !i.verificationObservationRunId,
    }));

  const citIdx = citationEvidenceIndex;
  const primaryVis = await primaryVisibilityRunForResults(results);
  const competitorUniverse = await loadCompetitorUniverseRuntime();
  const competitorLine = buildTodayCompetitorLine({
    universe: competitorUniverse,
    citationIndex: citIdx,
    primaryVisibilityRun: primaryVis,
    importCompetitorDomains: competitors.map((c) => c.domain),
  });

  const nextCandidates: (TodayNextMove | null)[] = [];

  if (warningAlerts.length > 0) {
    const first = warningAlerts[0];
    nextCandidates.push({
      title: `Clear ${warningAlerts.length} observed page issue${warningAlerts.length !== 1 ? "s" : ""}`,
      href: pagesHref(first.url),
      evidence:
        "Found during the latest crawl. Open in Pages to see what was detected.",
      observationRunId: first.observation_run_id ?? activeCrawlId,
      evidenceScope: "crawl",
    });
  }
  if (shippedIssues.length > 0) {
    const s = shippedIssues[0];
    nextCandidates.push({
      title: "Run ship verification on staged fixes",
      href: pagesHref(s.pageUrl),
      evidence:
        "This change was marked as shipped. Verify it by fetching the live page to confirm the fix is in production.",
      observationRunId: activeCrawlId,
      evidenceScope: "mixed",
    });
  }
  if (newIssues.length > 0) {
    nextCandidates.push({
      title: `Triage ${newIssues.length} open page issue${newIssues.length !== 1 ? "s" : ""}`,
      href: "/pages",
      evidence:
        "Issues mix crawl-backed guardrails with playbook inference — each row labels observed vs inferred.",
      observationRunId: activeCrawlId,
      evidenceScope: "mixed",
    });
  }
  if (undecidedCount > 0) {
    nextCandidates.push({
      title: "Work the Review queue (hypothesis locks)",
      href: "/changes?tab=attribution",
      evidence:
        "Imported visibility shifts with unreviewed attribution. Lock a cause when you know what happened.",
      observationRunId: null,
      evidenceScope: "review_heuristic",
    });
  }
  if (decayAlerts.length > 0) {
    const meaningful = decayAlerts.filter((d) => d.status === "meaningful_decline").length;
    nextCandidates.push({
      title: `${decayAlerts.length} page${decayAlerts.length !== 1 ? "s" : ""} with declining citations${meaningful > 0 ? ` (${meaningful} significant)` : ""}`,
      href: "/pages",
      evidence:
        "Citations to this page are declining compared to earlier data. Check if content is outdated or structure has changed.",
      observationRunId: null,
      evidenceScope: "mixed",
    });
  }

  // ── Representation discrepancy check (quiet — only notable) ──
  //
  // Perf bundle 5 (2026-05-12) — `extractEntities` + `detectDiscrepancies`
  // measured at ~366 ms warm (~65% of /today's render time). The output
  // produces exactly ONE optional `nextCandidates` entry, and the
  // consumer in `today-summary.ts:82-90` selects the first non-null
  // candidate via `nextMoveCandidates.find((m) => m != null)`. The
  // discrepancy entry is the 6th push (after the 5 higher-priority
  // checks above: warningAlerts / shippedIssues / newIssues /
  // undecidedCount / decayAlerts), so when ANY earlier candidate
  // already fired, the discrepancy result is discarded by `find()`
  // before it can render — paying full cost for zero customer-visible
  // output.
  //
  // Gate: skip the expensive work whenever an earlier candidate already
  // produced a non-null entry. Output is byte-identical because the
  // selector explicitly prefers the first non-null entry, which still
  // exists. Only the rare "all five earlier checks empty" case runs
  // the discrepancy detector — for that path behavior is unchanged.
  //
  // `nextCandidates.some(c => c != null)` is O(5) since exactly 5
  // earlier pushes can have happened by this point.
  const hasHigherPriorityNextMove = nextCandidates.some(
    (candidate) => candidate != null,
  );
  if (!hasHigherPriorityNextMove) {
    const entityIdx = await extractEntities(pageSnapshots);
    const discrepancyReport = await detectDiscrepancies(entityIdx);
    const notableDisc = discrepancyReport.discrepancies.filter(
      (d) => d.severity === "notable",
    );
    if (notableDisc.length > 0) {
      nextCandidates.push({
        title: `${notableDisc.length} possible representation ${notableDisc.length === 1 ? "discrepancy" : "discrepancies"} in AI answers`,
        href: "/settings/health",
        evidence:
          "Detected from structural comparison of AI answer content against your owned page data. Conservative signals only — review in Diagnostics.",
        observationRunId: null,
        evidenceScope: "mixed",
      });
    }
  }

  // ── Geographic coverage insight ──
  const geoCoverage = computeGeoCoverage(
    allPages,
    citationEvidenceIndex?.by_page_and_topic ?? [],
    activePrompts,
  );
  if (geoCoverage.gaps.length > 0) {
    const topGap = geoCoverage.gaps[0];
    nextCandidates.push({
      title: `${geoCoverage.gaps.length} local market${geoCoverage.gaps.length !== 1 ? "s" : ""} with competitor presence and limited owned visibility`,
      href: "/settings/health",
      evidence:
        `Strongest gap: ${topGap.city} (${topGap.competitor_pages} competitor pages, ${topGap.owned_pages} owned). Based on page registry data.`,
      observationRunId: null,
      evidenceScope: "mixed",
    });
  }

  // ── Journey stage insight ──
  const journeyCoverage = computeJourneyCoverage(promptLibrary);
  if (journeyCoverage.absent_stages.length > 0 && journeyCoverage.total_active >= 10) {
    nextCandidates.push({
      title: `No prompt coverage in ${journeyCoverage.absent_stages.map((s) => JOURNEY_STAGE_LABELS[s]).join(", ")} stage${journeyCoverage.absent_stages.length !== 1 ? "s" : ""}`,
      href: "/settings/health",
      evidence:
        `${journeyCoverage.total_active} active prompts across ${journeyCoverage.stages.filter((s) => s.active_prompt_count > 0).length} stages. Keyword-based classification.`,
      observationRunId: null,
      evidenceScope: "mixed",
    });
  }

  // ── Snippet intelligence — high-priority extractability gap ──
  if (citationEvidenceIndex) {
    const extractResults = analyzeAllExtractability(pageSnapshots, citMap);
    const snippetIntel = computeSnippetIntelligence({
      ownedExtractability: extractResults,
      citationIndex: citationEvidenceIndex,
      snapshots: pageSnapshots,
      ownedDomain: siteDomain,
    });
    const highPriority = snippetIntel.signals.filter((s) => s.priority === "high");
    if (highPriority.length > 0) {
      nextCandidates.push({
        title: `${highPriority.length} high-priority extractability ${highPriority.length === 1 ? "gap" : "gaps"} on cited pages`,
        href: "/settings/health",
        evidence:
          `${highPriority[0].summary}. Based on structural analysis of ${snippetIntel.total_owned_pages_analyzed} cited pages.`,
        observationRunId: null,
        evidenceScope: "mixed",
      });
    }
  }

  nextCandidates.push(null);

  const summary = await buildTodaySummary({
    verifiedFixes,
    nextMoveCandidates: nextCandidates,
    competitorLine,
    primaryVisibilityRun: primaryVis,
  });

  const lastCrawlForProof = summary.crawl.activeObservationRun;
  const crawlCompletedAt = lastCrawlForProof?.completed_at ?? null;
  const crawlAgeDaysForProof = crawlCompletedAt
    ? Math.floor((Date.now() - new Date(crawlCompletedAt).getTime()) / 86_400_000)
    : null;
  const crawlStaleForProof =
    crawlAgeDaysForProof !== null && crawlAgeDaysForProof > 14;
  const visibilityPartialSample =
    !!primaryVis?.is_synthetic_wrapper ||
    (!!crawlCompletedAt && !primaryVis?.citation_index_built_at);

  const crawlRunId = lastCrawlForProof?.run_id ?? null;
  const visibilityRunId = primaryVis?.run_id ?? null;
  const crawlHrefResolved =
    crawlRunId && (await getObservationRun(crawlRunId))
      ? summary.crawl.activeObservationHref
      : null;
  const visibilityHrefResolved =
    visibilityRunId && (await getObservationRun(visibilityRunId))
      ? summary.visibility.activeObservationHref
      : null;

  const proofContext: TodayProofContext = {
    crawlRunId,
    crawlCompletedAt,
    crawlHref: crawlHrefResolved,
    visibilityRunId,
    visibilityCompletedAt: primaryVis?.completed_at ?? null,
    visibilityHref: visibilityHrefResolved,
    citationIndexBuiltAt: primaryVis?.citation_index_built_at ?? null,
    visibilitySynthetic: !!primaryVis?.is_synthetic_wrapper,
    visibilitySource: primaryVis?.source ?? null,
    resultsRowCount: results.length,
    resultsThrough: visibilitySummary.dateRange?.to ?? null,
    visibilityStaleVsCrawl: summary.visibility.staleVsCrawl,
    visibilityStaleNote: summary.visibility.staleNote,
    crawlAgeDays: crawlAgeDaysForProof,
    crawlStale: crawlStaleForProof,
    visibilityPartialSample,
    answerIntelligence: answerIntelProof,
  };

  const observationRunIds = new Set(
    (await listObservationRuns()).map((r) => r.run_id),
  );
  const serializedPendingFindings = pendingFindings.map((f) =>
    serializeFindingForToday(f, observationRunIds),
  );
  const acceptedAwaitingPromotionCount = allScanFindings.filter(
    (f) => f.status === "accepted" && f.promotionStatus === "none",
  ).length;

  // Milestone sync moved to post-import (Phase 1C-3) — Today render reads only.
  // New milestone events are written to state.events during import, so
  // pickTodayMilestoneTeaser can find them from persisted state.
  const milestoneState = await getMilestoneState();
  const milestoneTeaserRaw = pickTodayMilestoneTeaser(milestoneState, []);
  const milestoneTeaser = milestoneTeaserRaw
    ? {
        title: milestoneTeaserRaw.title,
        subtitle: milestoneTeaserRaw.subtitle,
        proofSummary: milestoneTeaserRaw.proofSummary,
        achievedAt: milestoneTeaserRaw.achievedAt,
        magnitude: milestoneTeaserRaw.magnitude,
      }
    : null;

  const localAttentionStrip = isDemoMode
    ? null
    : buildTodayLocalAttention(await getLocalPresenceSnapshot());

  const scanState = readScanState();
  const scanPhaseFailed = scanState?.phase === "failed";

  // Phase 4 (2026-04-19): experimentProof removed. It was a "show the newest
  // promising experiment" card that depended on the experiments table. The
  // hurting-verdict action cards on Today now carry the same signal in a more
  // honest form (actual Z-score verdict, not "operator-started experiment").
  const experimentProof = null;

  // Brain-driven action stack removed 2026-04-18 (Phase 7 cleanup).
  // Was producing "Investigate h1 regression" shrug cards with 2-of-3 sample
  // size pattern math. Ablation + data-grounded gap scanner coming (see
  // docs/IDEAS_PARKING_LOT.md).
  //
  // For NOW the Today action stack sources from two feeds only:
  //   1. Schema-parity actions (Phase 1 work, genuinely useful \u2014 kept)
  //   2. Legacy recommendation-engine top picks (serializedPrimary, serializedSecondary)
  //      \u2014 with the bigram Frankenstein already removed at the engine level
  //      so whatever remains is structural/investigative recs, no H2 garbage.
  //
  // The new data-grounded scanner will slot in here once Part 1b lands.
  const urlChangePatterns = await readStore<UrlChangePattern>("url-change-patterns");
  void urlChangePatterns; // Reserved for Phase 7 Part 3 composite ranking

  const schemaParityActions = buildSchemaParityActions({
    findings: pendingFindings,
    citationsByUrl: citMap,
    maxActions: 1,
  });

  // Phase 7 Part 1b (2026-04-18): data-grounded gap-scanner recs flow through
  // the normal rec-engine \u2192 rankAndSelect pipeline. Once the scanner's
  // experiment-URL filter was fixed (match path-only, not full URL), gap recs
  // correctly top-rank and land as serializedPrimary / serializedSecondary.
  // Schema-parity actions still get the primary slot when present.
  //
  // Phase 7 Part 1c (2026-04-19): surface URL-level "hurting" verdicts from the
  // Z-score engine directly on Today as critical action cards. This is the first
  // cut of the experiments\u2192verdicts convergence. Previously these verdicts
  // lived only in url-change-outcomes.json with no UI surface; a -27 z-score
  // on /custom-home-builder-bay-area (the money page) was invisible to the user.
  //
  // Dedup: one card per URL (worst Z-score wins). Priority: 80+|z| so they beat
  // most engine recs but stay below near-impossible scores.
  // Phase 7 Part 1d (2026-04-19): hurting cards now carry the full story \u2014
  // named the change that caused it, how long it's been hurting, whether the
  // Z-score is worsening. Joined from imported-changes + url-change-outcomes
  // `transitions` counter.
  type HurtingRow = {
    url: string;
    changeId: string;
    z: number;
    deltaPct: number;
    confidence: "low" | "medium" | "high";
    baselineDaysUsed: number;
    postDaysUsed: number;
    recordedAt: string;
    transitions: number;
  };
  // Only surface URLs whose LATEST verdict is still "hurting" (2026-04-19
  // correctness fix). A page that was hurting and has since recovered \u2014
  // flipping to `helping` on a later outcome \u2014 shouldn't still show as a
  // FIX NOW card. First pass: find each URL's most recent outcome and whether
  // it's currently hurting.
  const latestVerdictByUrl = new Map<string, { verdict: string; updatedAt: string }>();
  for (const o of urlChangeOutcomes) {
    const existing = latestVerdictByUrl.get(o.url);
    if (!existing || o.updated_at > existing.updatedAt) {
      latestVerdictByUrl.set(o.url, { verdict: o.verdict, updatedAt: o.updated_at });
    }
  }
  const hurtingByUrl = new Map<string, HurtingRow>();
  for (const o of urlChangeOutcomes) {
    if (o.verdict !== "hurting") continue;
    const latest = latestVerdictByUrl.get(o.url);
    if (latest?.verdict !== "hurting") continue; // recovered \u2014 skip
    const z = o.landing_z ?? 0;
    const existing = hurtingByUrl.get(o.url);
    if (!existing || Math.abs(z) > Math.abs(existing.z)) {
      hurtingByUrl.set(o.url, {
        url: o.url,
        changeId: o.change_id,
        z,
        deltaPct: o.delta_pct ?? 0,
        confidence: (o.confidence as "low" | "medium" | "high") ?? "low",
        baselineDaysUsed: o.baseline_days_used,
        postDaysUsed: o.post_days_used,
        recordedAt: o.recorded_at,
        transitions: o.transitions,
      });
    }
  }
  const changeByIdForHurt = new Map(changelogEntries.map((c) => [c.id, c]));
  const fmtDate = (iso: string): string => {
    try {
      return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    } catch { return "recently"; }
  };
  const hurtingActions: import("@/components/today/action-card").ActionCardAction[] =
    Array.from(hurtingByUrl.values()).map((h) => {
      const absZ = Math.abs(h.z);
      const pctStr = h.deltaPct < 0
        ? `${Math.abs(h.deltaPct * 100).toFixed(0)}% fewer citations`
        : "a citation decline";
      const change = changeByIdForHurt.get(h.changeId);
      const changeDate = change?.timestamp ? fmtDate(change.timestamp) : null;
      const changeDesc = change?.change_description?.trim()
        ?? change?.asset_name?.trim()
        ?? null;
      const daysSinceRecorded = Math.max(
        0,
        Math.floor((Date.now() - new Date(h.recordedAt).getTime()) / 86_400_000),
      );
      // T-WorseningSuffix (2026-05-08): the prior `transitions > 1
      // ? " \u00b7 worsening" : ""` was direction-blind \u2014 see the
      // `hurtingTrendSuffix` doc comment above. Until verdict_history
      // is persisted, this is `""` for every row regardless of
      // transitions count.
      const trendSuffix = hurtingTrendSuffix({ transitions: h.transitions });
      const headline = changeDate
        ? `${h.url} regressed after your ${changeDate} change`
        : `${h.url} is losing AI visibility`;
      const rationaleLead = changeDesc && changeDate
        ? `On ${changeDate}, ${changeDesc}. Since then`
        : changeDate
          ? `Since your ${changeDate} change`
          : "Since the latest detected change";
      const rationale = `${rationaleLead}, this page is getting ${pctStr} (${h.confidence} confidence). Hurting for ${daysSinceRecorded}d${trendSuffix}. Review the change \u2014 revert, iterate, or confirm it's platform noise.`;
      return {
        id: `hurt-${h.changeId}-${h.url}`,
        headline,
        rationale,
        expectedOutcome: "Restore or improve citation count to baseline.",
        sourceEvidence: `${h.baselineDaysUsed}d baseline \u2192 ${h.postDaysUsed}d post-change`,
        priorityScore: 80 + Math.min(absZ, 30),
        bucket: "critical",
        type: "hurting_verdict",
        confidence: h.confidence,
        href: `/changes/${h.changeId}`,
        responseStatus: null,
        targetPageUrl: h.url,
        targetPagePath: h.url,
        baselineCitations: citMap.get(h.url.replace(/\/+$/, "").toLowerCase()) ?? null,
        sourceChangeId: h.changeId,
        // Phase 2 (2026-04-20): URL-level verdict → measured on this tenant.
        evidenceBasis: "tenant_history" as const,
      };
    });
  // Sort hurting cards by severity (most negative Z first).
  hurtingActions.sort((a, b) => b.priorityScore - a.priorityScore);

  // Acknowledgment filter: if the user clicked "Acknowledge" on a hurting card,
  // suppress it until the verdict changes (different z-score triggers a new
  // card id, which won't have a dismissed status). Reuses the existing
  // recommendation-response store \u2014 no new data plumbing.
  // Phase 4.3: fresh repo array, not module-level.
  const acknowledgedHurtingCardIds = new Set(
    freshRecommendationResponses
      .filter((r) => r.status === "dismissed" && r.recId.startsWith("hurt-"))
      .map((r) => r.recId),
  );
  const visibleHurtingActions = hurtingActions.filter(
    (a) => !acknowledgedHurtingCardIds.has(a.id),
  );

  // ── Winning action card: sourced from URL-level Z-score engine only.
  //
  // 2026-04-20 architectural rewrite: deleted the topic-level MemoryInsight
  // path that was producing false causal claims (e.g. crediting a trivial
  // "Removed duplicate FAQPage JSON-LD" sitewide cleanup for a +65% lift
  // that was actually driven by competitor decline). Topic-level attribution
  // conflates "change happened in topic X" with "topic X's trajectory was
  // caused by the change." Dead architecture.
  //
  // New source: url-change-outcomes.json, which runs per-URL Z-score analysis
  // with real pre/post windows. A URL earns a `helping` verdict only when its
  // own citation series rises significantly post-change. Topic is metadata,
  // not a causal primitive.
  //
  // Additional guards beyond the Z-score:
  //   1. TEMPLATE-EDIT DEDUP: if the same change_description appears on
  //      \u22653 pages within a week, it's a sitewide template edit, not a
  //      per-page causal move. Drop all pages that inherited that description.
  //   2. ACKNOWLEDGED SUPPRESSION: "Acknowledge" click on a previous win card
  //      hides until verdict transitions.

  // Template-edit dedup: find change_descriptions that appear on 3+ pages.
  const changeDescToChangeIds = new Map<string, Set<string>>();
  for (const c of changelogEntries) {
    const desc = (c.change_description || "").trim().toLowerCase();
    if (!desc || desc.length < 10) continue;
    if (!changeDescToChangeIds.has(desc)) changeDescToChangeIds.set(desc, new Set());
    changeDescToChangeIds.get(desc)!.add(c.id);
  }
  const templateEditChangeIds = new Set<string>();
  for (const ids of changeDescToChangeIds.values()) {
    if (ids.size >= 3) {
      for (const id of ids) templateEditChangeIds.add(id);
    }
  }

  // Build the winning-URL list from url-change-outcomes. One row per URL; take
  // the most recent `helping` verdict for each URL, rank by |delta_pct|.
  //
  // M3 (operator audit, 2026-05-05): keep `delta_pct` as a NULLABLE field
  // — when the URL's pre-change baseline is below the floor (default
  // 1.0 cite/day), `url-verdict` returns `delta_pct = null` and the
  // renderer must show the absolute delta instead. Replacing null with
  // `0` would make the lift invisible; we plumb null through.
  type HelpingRow = {
    url: string;
    changeId: string;
    /** Null when baseline is below the M3 denominator floor. */
    deltaPct: number | null;
    /** Always present — falls back from delta_pct when relative-% is suppressed. */
    deltaAbs: number;
    landingZ: number;
    confidence: "low" | "medium" | "high";
    baselineDaysUsed: number;
    postDaysUsed: number;
    updatedAt: string;
    landingDayN: number | null;
  };
  const helpingByUrl = new Map<string, HelpingRow>();
  for (const o of urlChangeOutcomes) {
    if (o.verdict !== "helping") continue;
    if (templateEditChangeIds.has(o.change_id)) continue; // sitewide edits excluded
    const existing = helpingByUrl.get(o.url);
    if (!existing || o.updated_at > existing.updatedAt) {
      helpingByUrl.set(o.url, {
        url: o.url,
        changeId: o.change_id,
        deltaPct: o.delta_pct, // null when baseline below floor (M3)
        deltaAbs: o.delta_abs ?? 0,
        landingZ: o.landing_z ?? 0,
        confidence: (o.confidence as "low" | "medium" | "high") ?? "low",
        baselineDaysUsed: o.baseline_days_used,
        postDaysUsed: o.post_days_used,
        updatedAt: o.updated_at,
        landingDayN: o.landing_day_n,
      });
    }
  }
  // Only show URLs where the latest verdict is still `helping` (avoids
  // showing a historical helping that has since reverted to `hurting` or
  // `nothing_yet`).
  const visibleHelping = Array.from(helpingByUrl.values()).filter((h) => {
    const latest = latestVerdictByUrl.get(h.url);
    return latest?.verdict === "helping";
  });
  // Rank by Z-score magnitude (biggest signal-strength first). Z is the
  // primary attribution signal (M3 — operator audit, 2026-05-05); we no
  // longer rank by relative %, which can be null below the baseline
  // floor and is a noisy proxy on its own.
  visibleHelping.sort((a, b) => Math.abs(b.landingZ) - Math.abs(a.landingZ));

  const winningActions: import("@/components/today/action-card").ActionCardAction[] = [];
  // Take at most the top 2 winning URLs.
  const topHelpingUrls = visibleHelping.slice(0, 2);
  for (const h of topHelpingUrls) {
    const winCardId = `win-${h.changeId}-${h.url}`;
    // Phase 4.3: fresh repo array, not module-level.
    const acknowledgedWin = freshRecommendationResponses.some(
      (r) => r.recId === winCardId && r.status === "dismissed",
    );
    if (acknowledgedWin) continue;
    const change = changeByIdForHurt.get(h.changeId);
    const changeDate = change?.timestamp ? fmtDate(change.timestamp) : null;
    const changeDesc = change?.change_description?.trim()
      ?? change?.asset_name?.trim()
      ?? null;
    // M3 (operator audit, 2026-05-05): reframe as correlation, not
    // causation. Headline becomes "Citation lift detected after the X
    // change" instead of "X is winning after your change". Body
    // leads with absolute counts (delta_abs is the signed daily
    // change, e.g., "rose by ~6.5 citations/day"); relative-% is
    // secondary and only appears when the baseline-floor guard in
    // url-verdict cleared it (`h.deltaPct !== null`). Z-score stays
    // primary as the signal-strength readout.
    const headline = changeDate
      ? `Citation lift detected on ${h.url} after the ${changeDate} change`
      : `Citation lift detected on ${h.url} (measured per page)`;
    // T3 (operator audit, 2026-05-05) — default rationale is now two
    // short calm sentences with NO numbers + NO Z-score. Stats live in
    // lineageBullets (under "Why we suggest this" expansion). Operator
    // brief: pre-T3 default read "+1083%" / "Z-score 20.6" / "high
    // confidence" — too aggressive.
    //
    // UX.6.1 Fix 3 (2026-05-07) — Trust restoration. The pre-fix
    // default "Citations increased after this change. URL-level signal
    // detected; not proof of causation." led with the win + an
    // immediate caveat — accurate but weak as a default. New default
    // leads with the win + a forward-looking framing ("Beacon is
    // tracking the pattern so you can repeat what worked"). The
    // methodology caveat ("URL-level signal, not proof of causation")
    // moves to the lineageBullets array which renders inside the
    // "Why we suggest this" drawer — stays accessible for operators
    // who want the rigor without dominating the default surface.
    const absDeltaPerDay = Math.abs(h.deltaAbs);
    const directionVerb = h.deltaAbs >= 0 ? "rose" : "fell";
    const rationale =
      h.deltaAbs >= 0
        ? `This page gained citations after the change. Beacon is tracking the pattern so you can repeat what worked.`
        : `This page lost citations after the change. Beacon is tracking to see if it recovers.`;

    // T3 — methodology / stats lineage. When the relative-% is extreme
    // (>= 300%) we OMIT the percent line and lead with absolute /day
    // ("rose by ~10.8 citations/day") — operator brief.
    const isExtremePct =
      h.deltaPct !== null && Math.abs(h.deltaPct) >= 3.0;
    const absDeltaBullet = `In the post-change window, citations ${directionVerb} by ~${absDeltaPerDay.toFixed(1)}/day.`;
    const pctBullet =
      h.deltaPct !== null && !isExtremePct
        ? `Relative shift: ${h.deltaPct > 0 ? "+" : ""}${(h.deltaPct * 100).toFixed(0)}%.`
        : null;
    const zBullet = `Signal strength: ${h.confidence} confidence.`;
    const landedBullet =
      h.landingDayN !== null && h.landingDayN > 0
        ? `Landed ${h.landingDayN}d after change.`
        : null;
    const windowBullet = `Window: ${h.baselineDaysUsed}d baseline post-change ${h.postDaysUsed}d.`;
    const methodologyBullet =
      "URL-level correlation - this page's own citations moved - not proof of causation, and not a topic-wide trend.";
    const lineageBullets: string[] = [
      ...(changeDesc && changeDate ? [`Change on ${changeDate}: ${changeDesc}`] : []),
      absDeltaBullet,
      ...(pctBullet ? [pctBullet] : []),
      zBullet,
      ...(landedBullet ? [landedBullet] : []),
      windowBullet,
      methodologyBullet,
    ];
    winningActions.push({
      id: winCardId,
      headline,
      rationale,
      expectedOutcome: "Consider similar pages where this pattern could repeat.",
      sourceEvidence: `${h.baselineDaysUsed}d baseline \u2192 ${h.postDaysUsed}d post-change`,
      priorityScore: 75 - winningActions.length, // first wins slightly higher
      bucket: "high_leverage",
      type: "helping_verdict",
      confidence: h.confidence,
      href: `/changes/${h.changeId}`,
      responseStatus: null,
      targetPageUrl: h.url,
      targetPagePath: h.url,
      baselineCitations: citMap.get(h.url.replace(/\/+$/, "").toLowerCase()) ?? null,
      sourceChangeId: h.changeId,
      // Phase 2 (2026-04-20): URL-level verdict measured on this tenant.
      evidenceBasis: "tenant_history" as const,
      // T3 (2026-05-05) — exact stats live here, not in default rationale.
      lineageBullets,
    });
  }

  // Phase 2 (2026-04-20): classify evidence basis on schema-parity cards via
  // the shared classifier. These cards carry no priorSuccess / no URL verdict
  // / no mined-pattern link, so the result is driven entirely by whether the
  // target page has ≥50 existing citations.
  const schemaParityActionsWithBasis = schemaParityActions.map((a) => ({
    ...a,
    evidenceBasis: classifyEvidenceBasis({
      recType: a.type,
      hasPriorSuccess: Boolean(a.priorSuccess),
      patternTrackRecord: null,
      minedPatternStrength: null,
      baselineCitations: a.baselineCitations ?? null,
      brainPatternStrength: null,
    }),
  }));

  // Phase 3B (2026-04-20): split Today into two semantic sections.
  //   Decide tonight   = action cards the operator must decide on (hurting
  //                       verdicts, schema parity, brain-driven recs).
  //   Wins to learn from = helping_verdict cards with measured lift. They
  //                       belong in a visibly secondary stripe, not crowding
  //                       the action stack. Fixes the "everything says BIGGEST
  //                       WIN and wins are interleaved with chores" problem.
  const assembledAll: import("@/components/today/action-card").ActionCardAction[] = [
    ...visibleHurtingActions,
    ...winningActions,
    ...schemaParityActionsWithBasis,
    ...(serializedPrimary ? [serializedPrimary] : []),
    ...(serializedSecondary ? [serializedSecondary] : []),
  ];

  const decideTonightActions = assembledAll.filter((a) => a.type !== "helping_verdict");
  const measuredWins = assembledAll.filter((a) => a.type === "helping_verdict");

  const cappedDecide = decideTonightActions.slice(0, 4);
  const cappedMeasuredWins = measuredWins.slice(0, 2);

  // Prefer brain-driven actions on Today. Legacy flow remains only as safety
  // fallback if both brain and schema-parity produced nothing.
  const todayPrimary = cappedDecide[0] ?? serializedPrimary;
  const todaySecondary = cappedDecide[1] ?? serializedSecondary;
  const todayMoreActions = cappedDecide.slice(2);

  // ─────────────────────────────────────────────────────────────────────
  // Visibility Score chart + leaderboard (Day 6 visual rebuild, 2026-04-17)
  //
  // Profound-style dashboard: daily mention/citation/composite score for the
  // tenant + a top-5 competitor leaderboard. Pre-computes ALL three metric
  // series so the chart toggle is instant client-side. Pre-computes both
  // current (last 14d) AND previous (14d before that) windows so the
  // "Previous period" overlay is also zero-latency.
  //
  // Data source: the `promptAnswerObservations` canonical store already
  // imported above (line 522 ish) for the query-index build. We reuse it
  // here to avoid a second pass over the same file.
  // ─────────────────────────────────────────────────────────────────────
  // Perf bundle 4 (2026-05-12) — `brandAliases` is now declared near
  // the top of `loadTodayPageData` (as `brandAliases`, built from
  // `todayBusinessConfig.name` + first word). The earlier per-fan-out
  // duplicate construction is removed; the architecture guardrail pins
  // a single source of truth.

  // Compute a FULL 60-day time series server-side. The chart then slices
  // client-side based on the user's selected time range (7/14/30/60d).
  // Leaderboard still uses a 14-day window with a 14-day previous window
  // for its delta column (unchanged).
  const today = new Date();
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - n);
    return isoDay(d);
  };
  const chartEndDate = isoDay(today);
  const chartStartDate = daysAgo(59); // inclusive \u2192 60 days

  const METRICS: VisibilityMetric[] = ["composite", "mention_rate", "citation_rate"];

  // Perf bundle 3 (2026-05-12) — the per-request `observationRollup` is
  // built much earlier in the function (right after the canonical-store
  // fresh-read) and used by both the inline observation loops at lines
  // 386/1085 AND the visibility-score fan-out below. Each downstream
  // call accepts an optional `rollup` arg and reads pre-bucketed
  // per-(date, platform) aggregates in O(window-days) instead of
  // re-walking the full ~14k-row observation array. Tenant-safe by
  // construction; no cross-request cache.

  // Tenant 60-day time series, all three metrics.
  const brandSeriesByMetric = {} as Record<VisibilityMetric, VisibilityPoint[]>;
  for (const m of METRICS) {
    brandSeriesByMetric[m] = computeVisibilityTimeSeries({
      observations: promptAnswerObservations,
      metric: m,
      brandAliases,
      startDate: chartStartDate,
      endDate: chartEndDate,
      rollup: observationRollup,
    });
  }

  // 2026-04-19: per-platform breakdown for the chart's "by platform" view.
  const brandSeriesByPlatform = computeVisibilityTimeSeriesByPlatform({
    observations: promptAnswerObservations,
    brandAliases,
    startDate: chartStartDate,
    endDate: chartEndDate,
    rollup: observationRollup,
  });

  // Step 1.3 (master plan) \u2014 leaderboard precomputed for every chart-toggle
  // window (7/14/30/60). Each entry's delta reads "vs. previous N days":
  // current avg minus previous-equal-length-window avg. computeLeaderboard
  // returns null delta when the previous window is too sparse.
  const LEADERBOARD_WINDOWS: ReadonlyArray<number> = [7, 14, 30, 60];
  const leaderboardByMetricAndWindow = {} as Record<
    VisibilityMetric,
    Record<number, EntityVisibility[]>
  >;
  for (const m of METRICS) {
    leaderboardByMetricAndWindow[m] = {} as Record<number, EntityVisibility[]>;
    for (const windowDays of LEADERBOARD_WINDOWS) {
      leaderboardByMetricAndWindow[m][windowDays] = computeLeaderboard({
        observations: promptAnswerObservations,
        brandAliases,
        windowEndDate: chartEndDate,
        windowDays,
        metric: m,
        limit: 5,
        // Step 1.4 (master plan) — filter directories + generic-noun
        // mentions out of competitor rows. Brand + real builders stay.
        trackedEntities,
        rollup: observationRollup,
      });
    }
  }
  // Backwards-compat alias \u2014 historically callers consumed a single
  // 14-day leaderboard from `leaderboardByMetric.<metric>`. Keep the
  // shape so non-/today consumers (chart event overlay below, etc.)
  // don't churn.
  const leaderboardByMetric = {} as Record<VisibilityMetric, EntityVisibility[]>;
  for (const m of METRICS) {
    leaderboardByMetric[m] = leaderboardByMetricAndWindow[m][14];
  }

  // Top competitors from the composite leaderboard (top 4 non-owned), with
  // their own 60-day time series so the "Compare competitors" toggle is
  // zero-latency.
  const topCompetitorNames = leaderboardByMetric.composite
    .filter((e) => !e.isOwned)
    .slice(0, 4)
    .map((e) => e.name);

  const competitorSeriesByMetric = {} as Record<
    VisibilityMetric,
    Array<{ name: string; points: VisibilityPoint[] }>
  >;
  for (const m of METRICS) {
    const series = computeCompetitorSeries({
      observations: promptAnswerObservations,
      brandAliases,
      competitorNames: topCompetitorNames,
      metric: m,
      startDate: chartStartDate,
      endDate: chartEndDate,
      rollup: observationRollup,
    });
    competitorSeriesByMetric[m] = series
      .filter((s) => !s.isOwned)
      .map((s) => ({ name: s.name, points: s.points }));
  }

  // Chart event overlay (2026-04-19): annotate each currently-hurting URL's
  // change date with a red dot + guideline, and each helping URL with a green
  // one. Makes the chart honest \u2014 "up 10.5%" with context.
  const chartEvents: Array<{ date: string; tone: "danger" | "success" | "neutral"; label: string }> = [];
  const eventDateKey = new Set<string>();
  for (const h of hurtingByUrl.values()) {
    const change = changeByIdForHurt.get(h.changeId);
    const date = change?.timestamp?.slice(0, 10);
    if (!date) continue;
    const key = `hurt:${date}`;
    if (eventDateKey.has(key)) continue;
    eventDateKey.add(key);
    chartEvents.push({
      date,
      tone: "danger",
      label: `${h.url} \u2014 ${Math.abs((h.deltaPct ?? 0) * 100).toFixed(0)}% drop after change on ${date}`,
    });
  }
  // Green dots for URLs currently in `helping` state (from Z-score engine).
  for (const [url, latest] of latestVerdictByUrl.entries()) {
    if (latest.verdict !== "helping") continue;
    // Find the most recent helping outcome row for this URL to get its change_id.
    let bestHelping: typeof urlChangeOutcomes[number] | null = null;
    for (const o of urlChangeOutcomes) {
      if (o.url !== url) continue;
      if (o.verdict !== "helping") continue;
      if (!bestHelping || o.updated_at > bestHelping.updated_at) bestHelping = o;
    }
    if (!bestHelping) continue;
    const change = changeByIdForHurt.get(bestHelping.change_id);
    const date = change?.timestamp?.slice(0, 10);
    if (!date) continue;
    const key = `help:${date}`;
    if (eventDateKey.has(key)) continue;
    eventDateKey.add(key);
    chartEvents.push({
      date,
      tone: "success",
      // M3 (operator audit, 2026-05-05): chart-event label says
      // "citation lift" instead of "winning" \u2014 correlation-tone copy
      // matching the action-card headline above.
      label: `${url} \u2014 citation lift detected after change on ${date}`,
    });
  }
  // 2026-04-20: removed MemoryInsight-derived bestImproving green dot \u2014 the
  // url-change-outcomes `helping` dots above already cover all legitimate
  // winning events at URL level with Z-score validation.

  const visibilityData = {
    brandName: brandAliases[0] ?? "You",
    brandSeriesByMetric,
    brandSeriesByPlatform,
    leaderboardByMetric,
    /** Step 1.3 (master plan) — leaderboard slices for every chart-toggle
     *  window. Today's UI swaps in the entry matching the chart's selected
     *  timeRange so the delta column always reads against the same window. */
    leaderboardByMetricAndWindow,
    /** Anchor for the chart's calendar-date filter (replaces last-N-points
     *  slicing). Always today's UTC date. */
    chartEndDate,
    competitorSeriesByMetric,
    chartEvents,
  };

  return {
    isDemoMode,
    scanPhaseFailed,
    // Phase 3.5F
    todayFreshness,
    hostedScanDisabled,
    summary,
    primaryAction: todayPrimary,
    secondaryAction: todaySecondary,
    moreActions: todayMoreActions,
    // Phase 3B (2026-04-20): wins live in their own section on TodayClient.
    measuredWins: cappedMeasuredWins,
    morningBrief,
    scoreboard,
    pendingFindings: serializedPendingFindings,
    shouldTriggerScan: scanOverdue,
    proofContext,
    localAttentionStrip,
    experimentProof,
    faqSchemaCoverage,
    platformDistribution,
    concentratedPlatform,
    visibilityData,
    // 2026-04-20: URL-verdict proof for the "Latest signal" strip. Replaces
    // the topic-level MemoryInsight source that was producing false causal
    // claims. Null when no URL is currently in `helping` state with rising
    // citations.
    //
    // M3 (operator audit, 2026-05-05): when `deltaPct` is null
    // (baseline below denominator floor), report zero relative-% and
    // a non-percent label so the renderer doesn't fabricate "+1100%".
    // Renderers that need a deltaLabel should check for the `/day`
    // suffix to know the absolute fallback was used.
    urlVerdictProof: topHelpingUrls[0]
      ? (() => {
          const h = topHelpingUrls[0];
          const change = changeByIdForHurt.get(h.changeId);
          const changeDate = change?.timestamp ? fmtDate(change.timestamp) : null;
          if (h.deltaPct === null) {
            const absLabel = `${h.deltaAbs > 0 ? "+" : ""}${h.deltaAbs.toFixed(1)}/day`;
            return {
              changeId: h.changeId,
              pagePath: h.url,
              changeDate: changeDate ?? null,
              citationDeltaPct: 0,
              deltaLabel: absLabel,
            };
          }
          const deltaPctAbs = Math.abs(h.deltaPct * 100);
          return {
            changeId: h.changeId,
            pagePath: h.url,
            changeDate: changeDate ?? null,
            citationDeltaPct: Math.round(h.deltaPct * 1000) / 10, // one decimal
            deltaLabel: `${h.deltaPct > 0 ? "+" : ""}${deltaPctAbs.toFixed(0)}%`,
          };
        })()
      : null,
    pollHealth,
    /** 2026-05-10 — site-scan freshness for the /today heartbeat.
     *  Reuses the already-loaded `lastCrawlRun` (latestWebsiteCrawlRun()
     *  call above); no new database read. */
    siteScan: lastCrawlRun
      ? {
          completedAt: lastCrawlRun.completed_at ?? null,
          status: (lastCrawlRun.status === "completed" ||
                   lastCrawlRun.status === "partial" ||
                   lastCrawlRun.status === "failed")
            ? lastCrawlRun.status
            : null,
        }
      : null,
    enrichmentRollup,
    /** W2 Step 2.3 (master plan) — full v2 bundle for "How AI Described
     *  You This Week". Null on bundle-build failure (each rollup wrapped
     *  in try/catch so a single rollup error degrades to null v2 + the
     *  legacy enrichmentRollup keeps rendering). */
    enrichmentV2,
    promptsTeaser,
    topPick,
    // Phase 6A.7 (2026-04-28) — lifecycle status strip + implementation
    // queue. Reads recommended_edits via the same tenant-scoped repo
    // /changes uses, so counts always reconcile.
    lifecycleSummary,
    // Gap F.1 (2026-05-07) — first-reading waiting state. True only
    // when the tenant just launched (status='active') AND has active
    // tracked prompts AND has zero observations yet. Causes
    // TodayClient to render the waiting card instead of the regular
    // dashboard. Mature tenants (Ritz) have observations → flag is
    // false → render unchanged. Fail-soft on any error: defaults to
    // false so /today never crashes on a tenant-store read miss.
    firstReading: await resolveFirstReadingState({
      activePromptCount: activePrompts.length,
      observationCount: promptAnswerObservations.length,
    }),
    // UX.2 (2026-05-07) — Command Center data slice. Reads existing
    // brain-health + manifest artifacts from .data/_reports/ and
    // .data/tenants/<slug>/brain/. Pure read; cards render their own
    // empty states when fields are null. The mature-tenant render is
    // unchanged when both files are missing.
    //
    // EGRESS-P0 (2026-05-07) — kill-switch env: set
    // BEACON_COMMAND_CENTER_ENABLED=false to skip the resolver +
    // suppress the section render. Defense-in-depth even though the
    // resolver only reads local JSON (no Supabase egress impact).
    commandCenter:
      process.env.BEACON_COMMAND_CENTER_ENABLED === "false"
        ? { hasAnyData: false, brain: null, manifest: null }
        : resolveCommandCenterFailSoft({
            // UX.6.1 (2026-05-07) — pass already-loaded counts so the
            // helper can derive a Brain readiness summary when the disk
            // JSON is unreachable (production: `.data/_reports/` is
            // gitignored). Pre-fix the card always rendered "Waiting
            // for next reading" on Vercel even for mature tenants.
            observations: promptAnswerObservations,
            snapshots: dailyMetricSnapshots,
            citationEvidenceIndex,
            recommendationQueueSize: lifecycleSummary
              ? lifecycleSummary.counts.pendingImplementation +
                lifecycleSummary.counts.liveVerified +
                lifecycleSummary.counts.needsReview
              : 0,
          }),
    /** UX.2 — operator-mode flag for the small /diagnostics/brain link
     *  at the bottom of the Command Center. */
    commandCenterIsOperator: commandCenterIsOperatorMode(),
  };
}

/**
 * Fail-soft Command Center resolver. Reads from disk; any failure
 * returns null fields so /today never crashes. Tenant slug comes
 * from currentTenantSlug() if available; otherwise uses Ritz slug
 * fallback (matches the existing `BEACON_TENANT_SLUG` pattern).
 *
 * UX.6.1 (2026-05-07) — when the disk JSON is unreachable AND the
 * tenant has observations, derives a lightweight brain summary from
 * already-loaded /today data instead of returning the empty
 * "Waiting for next reading" state. Production /today no longer lies
 * to mature tenants.
 */
function resolveCommandCenterFailSoft(args: {
  observations: ReadonlyArray<{ observed_at: string }>;
  snapshots: ReadonlyArray<{ date: string }>;
  citationEvidenceIndex: unknown;
  recommendationQueueSize: number;
}): CommandCenterData {
  let resolved: CommandCenterData;
  try {
    const slug = process.env.BEACON_TENANT_SLUG ?? "ritz-builders";
    resolved = resolveCommandCenterData({ tenantSlug: slug });
  } catch (err) {
    console.warn("[today] commandCenter resolve failed:", err);
    resolved = { hasAnyData: false, brain: null, manifest: null };
  }

  // UX.6.1 — if the disk-based brain is missing (production is here
  // ~always), derive from already-loaded /today inputs.
  if (!resolved.brain) {
    const derived = deriveBrainFromTodayInputs(args);
    if (derived) {
      resolved = {
        hasAnyData: true,
        brain: derived,
        manifest: resolved.manifest,
      };
    }
  }
  return resolved;
}

/**
 * UX.6.1 derive helper — projects already-loaded /today data into
 * the shape the `deriveBrainSummaryFromCounts` helper consumes.
 * Pure compute over arrays; no I/O.
 */
function deriveBrainFromTodayInputs(args: {
  observations: ReadonlyArray<{ observed_at: string }>;
  snapshots: ReadonlyArray<{ date: string }>;
  citationEvidenceIndex: unknown;
  recommendationQueueSize: number;
}) {
  const NOW_MS = Date.now();
  const SEVEN_DAYS_MS = 7 * 86_400_000;
  const obs7dCutoff = NOW_MS - SEVEN_DAYS_MS;

  let observations7dCount = 0;
  const platformsSeen = new Set<string>();
  for (const o of args.observations) {
    const t = new Date(o.observed_at).getTime();
    if (Number.isFinite(t) && t >= obs7dCutoff) {
      observations7dCount += 1;
      const platform = (o as { platform?: string }).platform;
      if (typeof platform === "string") platformsSeen.add(platform);
    }
  }
  const hasPlatformCoverage =
    platformsSeen.has("perplexity") && platformsSeen.has("chatgpt");

  let recentSnapshotCount = 0;
  const snap7dCutoff = new Date(NOW_MS - SEVEN_DAYS_MS)
    .toISOString()
    .slice(0, 10);
  for (const s of args.snapshots) {
    // DailyMetricSnapshot uses `date` (YYYY-MM-DD).
    if (s.date >= snap7dCutoff) recentSnapshotCount += 1;
  }

  // Owned-URL citation count from the citation-evidence index.
  let ownedUrlsCitedCount = 0;
  const cei = args.citationEvidenceIndex as
    | {
        by_page_and_topic?: Array<{
          page_url?: string;
          is_owned?: boolean;
          total_citations?: number;
        }>;
      }
    | null;
  if (cei?.by_page_and_topic) {
    const ownedSeen = new Set<string>();
    for (const r of cei.by_page_and_topic) {
      if (
        r.is_owned &&
        typeof r.page_url === "string" &&
        (r.total_citations ?? 0) > 0
      ) {
        ownedSeen.add(r.page_url.replace(/\/+$/, "").toLowerCase());
      }
    }
    ownedUrlsCitedCount = ownedSeen.size;
  }

  return deriveBrainSummaryFromCounts({
    observations7dCount,
    totalObservationCount: args.observations.length,
    recentSnapshotCount,
    totalSnapshotCount: args.snapshots.length,
    ownedUrlsCitedCount,
    recommendationQueueSize: args.recommendationQueueSize,
    hasPlatformCoverage,
  });
}

/**
 * Resolve the first-reading detection result. Wraps the pure detector
 * with a fail-soft `currentTenant()` read — any error defaults to
 * `{ isFirstReading: false }` so /today never crashes.
 *
 * Today-perf cleanup (2026-05-12) — short-circuit the common
 * production path before doing the tenant fetch:
 *   1. observationCount > 0 → mature tenant; detector ALWAYS returns
 *      `isFirstReading: false` regardless of tenant data. Skip the
 *      `currentTenant()` call entirely.
 *   2. activePromptCount === 0 → no prompts queued; detector ALWAYS
 *      returns false. Skip the fetch.
 * This removes one filesystem-equivalent registry read per /today
 * render on Vercel (`.data/global/tenants.json` is gitignored and
 * absent on Vercel; the prior path always threw + caught + warned
 * for production tenants like tenant-ritz-founder). Cold tenants
 * (no prompts yet OR zero observations) still take the original
 * tenant-fetch path so the waiting-state card stays correct.
 */
async function resolveFirstReadingState(args: {
  activePromptCount: number;
  observationCount: number;
}): Promise<FirstReadingDetection> {
  if (args.observationCount > 0 || args.activePromptCount === 0) {
    return { isFirstReading: false };
  }
  let tenant: Awaited<ReturnType<typeof currentTenant>> | null = null;
  try {
    tenant = await currentTenant();
  } catch {
    // Tenant not in registry / store read failed — fall back to
    // existing /today render. No warning: in production the registry
    // file is gitignored on Vercel and this throw is the documented
    // path; logging on every cold-tenant render was operator noise.
    return { isFirstReading: false };
  }
  return detectFirstReadingState({
    tenant,
    activePromptCount: args.activePromptCount,
    observationCount: args.observationCount,
  });
}

/**
 * Phase 6A.7 (2026-04-28) — compute the Today lifecycle summary
 * (status-strip counts + implementation queue) from
 * `recommended_edits`. Non-fatal — any read failure returns the
 * zero-shape summary so Today still renders.
 */
export async function buildTodayLifecycleSummary(
  repo: ReturnType<ReturnType<typeof getRepository>["forTenant"]>,
  // T-LiveChanges (2026-05-08) — passed in so the same repo read isn't
  // duplicated. Both already loaded by `loadTodayPageData` upstream.
  changelogEntries: ReadonlyArray<ChangelogEntry>,
  urlChangeOutcomes: ReadonlyArray<UrlChangeOutcome>,
  now: Date,
): Promise<TodayLifecycleSummary> {
  const empty: TodayLifecycleSummary = {
    counts: {
      liveVerified: 0,
      pendingImplementation: 0,
      needsReview: 0,
      notFoundAfter7d: 0,
    },
    queue: [],
    liveChanges: [],
  };
  let edits;
  try {
    edits = await repo.getRecommendedEdits();
  } catch (err) {
    console.error("[today] recommended_edits read failed (non-fatal)", err);
    return empty;
  }
  const counts = {
    liveVerified: 0,
    pendingImplementation: 0,
    needsReview: 0,
    notFoundAfter7d: 0,
  };
  const acceptedQueue: TodayLifecycleQueueItem[] = [];
  for (const edit of edits) {
    const status = edit.implementation_status;
    if (status === "verified_live" || status === "verified_live_modified") {
      counts.liveVerified += 1;
    } else if (status === "accepted") {
      counts.pendingImplementation += 1;
      acceptedQueue.push({
        id: edit.id,
        rec_id: edit.rec_id,
        action_type: edit.action_type,
        target_url: edit.target_url ?? null,
        display_label: edit.display_label ?? null,
        proposed_text_preview: edit.proposed_text
          ? edit.proposed_text.slice(0, 140)
          : null,
        updated_at: edit.updated_at,
        // Phase 6A.8 (2026-04-28) — flag rows whose generator emitted a
        // placeholder answer ("Draft answer (operator: rewrite)…"). UI
        // surfaces a "needs rewrite" badge so the operator knows the FAQ
        // can't ship as-is.
        needsRewrite: edit.proposed_text
          ? edit.proposed_text.includes("Draft answer (operator: rewrite)")
          : false,
      });
    } else if (
      status === "needs_review" ||
      status === "partially_implemented" ||
      status === "wrong_page"
    ) {
      counts.needsReview += 1;
    } else if (status === "not_found_after_7d") {
      counts.notFoundAfter7d += 1;
    }
    // dismissed / recommended / undefined intentionally not surfaced.
  }
  acceptedQueue.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // T-LiveChanges (2026-05-08) — surface the actual verified_live rows
  // (not just their count). Joins each verified_live edit with its
  // matching changelog row by (source_rec_id, action_type,
  // target_element_key) and with the matching url_change_outcomes row
  // by changelog id. Picks dynamic-state customer-safe copy per
  // current verdict / pre-verdict / very-recent (no countdown).
  const liveChanges = buildTodayLiveChanges({
    recommendedEdits: edits,
    changelogEntries,
    urlChangeOutcomes,
    now,
  });

  return {
    counts,
    // Phase 6A.8 (2026-04-28) — UI shows top 3; the implementation-queue
    // card renders a "+N more pending" deep-link to /changes when more
    // exist. Capped here (rather than in the component) so /today's
    // server payload stays small.
    queue: acceptedQueue.slice(0, 3),
    liveChanges,
  };
}

/**
 * Phase 6A.7 — public shape consumed by TodayClient + tested directly.
 */
export type TodayLifecycleQueueItem = {
  id: string;
  rec_id: string;
  action_type: string;
  target_url: string | null;
  display_label: string | null;
  proposed_text_preview: string | null;
  updated_at: string;
  /** Phase 6A.8 — true when the proposed_text is a generator placeholder
   *  the operator must rewrite before shipping. */
  needsRewrite: boolean;
};

export type TodayLifecycleSummary = {
  counts: {
    liveVerified: number;
    pendingImplementation: number;
    needsReview: number;
    notFoundAfter7d: number;
  };
  queue: TodayLifecycleQueueItem[];
  /**
   * T-LiveChanges (2026-05-08) — actual verified_live rows with their
   * dynamic state copy. Top 3 most-recent. Empty array when no
   * verified_live edits exist; the LiveChangesBlock component renders
   * `null` for empty arrays so the strip's "0 live verified" chip is
   * the only acknowledgement.
   */
  liveChanges: TodayLiveChange[];
};


/**
 * Serialize a brain action into the shape the existing ActionCard component
 * already knows (`ActionCardAction`). No new UI types needed.
 *
 * Maps the brain's action kind → card bucket:
 *   reverse_hurter    → "critical"        (red frame, urgent)
 *   replicate_winner  → "high_leverage"   (amber frame, high value)
 *   start_experiment  → "opportunistic"   (neutral frame, exploratory)
 *   exploratory       → "opportunistic"   (neutral, explicitly exploratory)
 *
 * Confidence `exploratory` collapses to `low` so the existing ActionCard
 * confidence rendering doesn't need new enum values.
 */
// serializeBrainAction / buildBrainEvidence / buildBrainConfidenceReason
// removed 2026-04-18 (Phase 7 cleanup). These served the url-brain-recommender
// shrug-card pipeline which is now gone. ~140 lines of dead serialization
// helpers excised. Replacement pipeline (data-grounded scanner + LLM-as-judge
// ablation) will have its own serialization layer when built.

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function buildAnswerIntelligenceProofContext(
  ai: AnswerIntelligenceIndex,
): NonNullable<import("@/lib/today-proof-context").TodayProofContext["answerIntelligence"]> {
  const totalMentioned = ai.brand_positioning.reduce(
    (s, bp) => s + bp.mention_count,
    0,
  );
  const totalObs = ai.brand_positioning.reduce(
    (s, bp) => s + bp.total_observations,
    0,
  );
  const overallMentionRate =
    totalObs > 0 ? Math.round((totalMentioned / totalObs) * 1000) / 1000 : 0;

  const declining: string[] = [];
  const rising: string[] = [];
  for (const [topic, platforms] of Object.entries(
    ai.topic_platform_summary,
  )) {
    const dirs = Object.values(platforms).map((p) => p.trend_direction);
    if (dirs.filter((d) => d === "down").length > dirs.length / 2) {
      declining.push(topic);
    }
    if (dirs.filter((d) => d === "up").length > dirs.length / 2) {
      rising.push(topic);
    }
  }

  return {
    builtAt: ai.built_at,
    totalObservations: ai.total_observations,
    topicCount: ai.brand_positioning.length,
    overallMentionRate,
    decliningTopics: declining,
    risingTopics: rising,
  };
}
