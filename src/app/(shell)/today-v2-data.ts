/**
 * Today v2 section loaders (2026-05-12) — narrow data loaders that
 * power the per-section streaming layout in `/page.tsx`.
 *
 * The legacy `loadTodayPageData()` is a ~3000-line monolith that
 * computes ~30 fields for v1's 19-section layout. v2 destructures
 * only 9 fields. This file gives v2 its own narrow data path so
 * each layout section can load + stream independently.
 *
 * Section split (each owns its own loader + Suspense boundary):
 *
 *   1. Descriptors  — pure compute over observations + entities.
 *      Inputs: loadFreshCanonicalData only. Lightest section by far;
 *      typically streams first.
 *
 *   2. Visibility group  — hero + chart + leaderboard. Shares the
 *      `visibilityWindow` client state, so the THREE pieces stay
 *      together in one client component / one Suspense. Currently
 *      backed by the shared cached `loadTodayPageData()` (the full
 *      legacy compute extracts the visibility intermediates we'd need
 *      to replicate). Streams together with section 3.
 *
 *   3. Action cards  — Do today / Working / Recent wins. Needs
 *      `primaryAction`, `lifecycleSummary`, `measuredWins`,
 *      `urlVerdictProof`. The `primaryAction`/`measuredWins`/
 *      `urlVerdictProof` are derived from `assembledAll` in the
 *      legacy loader — a complex assembly across many sources.
 *      Currently backed by the shared cached `loadTodayPageData()`.
 *      Streams together with section 2.
 *
 * Shared upstream (canonical store seed + fresh canonical data) is
 * memoized via React.cache so multiple section loaders hit ONE
 * Supabase round-trip per request.
 *
 * The "share `loadTodayPageData()` for sections 2 + 3" is a
 * deliberate first cut: it sets up the section-streaming UI without
 * rewriting the legacy assembly. Future per-section narrow loaders
 * for visibility + action cards can drop in here without changing
 * `page.tsx`.
 *
 * Demo-mode + first-reading checks happen BEFORE any section loader
 * runs (in `loadTodayV2GateData()`) so the page can short-circuit to
 * the demo / waiting view instantly without paying section load cost.
 */

import "server-only";

import { cache } from "react";

import { currentTenantId } from "@/lib/tenant-context";
import { hasActiveExperiment } from "@/lib/seed-data.server";
import { hasAnyConnectedDataSource } from "@/lib/connector-store";
import {
  ensureCanonicalStoresSeeded,
  loadFreshCanonicalData,
} from "@/storage/canonical-store";
import {
  ensureRecommendationResponsesSeeded,
} from "@/domains/product/recommendation-response-store";
import {
  ensureUrlChangeOutcomesSeeded,
  getUrlChangeOutcomes,
} from "@/domains/attribution/url-change-outcome";
import {
  getBusinessConfig,
  hydrateBusinessConfigFromSupabase,
} from "@/lib/business-config";
import {
  buildEnrichmentRollup,
  buildEnrichmentWindowRollup,
  buildCompetitorEnrichmentRollup,
  buildCompetitorDropdown,
  buildPlatformPrimaryRateSparklines,
  buildFormatWinsRollup,
  type CompetitorEnrichmentRollup,
  type EnrichmentRollup,
  type EnrichmentV2Data,
} from "@/domains/prompt-answer-observations/enrichment-rollup";
import { todayISOUtc } from "@/domains/observations/poll-health";
import { getChangelogEntries } from "@/lib/seed-data.server";
import { getRepository } from "@/lib/persistence/repositories";
import {
  buildTodayLifecycleSummary,
  hurtingTrendSuffix,
  loadTodayPageData,
  type TodayLifecycleSummary,
  type TodayPageData,
} from "./today-data";
import type { ActionCardAction } from "@/components/today/action-card";
import type { TodayPrimaryAction } from "./today-client";
import type { ChangelogEntry } from "@/domains/changelog/types";
import { loadPersistedRecommendationQueueForPage } from "@/domains/recommendations/load-queue";
import { loadVisibilityReadModelFromSnapshots } from "@/domains/today/visibility-read-model";
import {
  computeTodayPrimaryShare,
  type TodayPrimaryShare,
} from "@/domains/daily-metric-snapshots/today-primary-share";
import { loadGscSiteTotalsForTenant } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGa4PageValuesForTenant } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadClarityPageSignalsForTenant } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { loadSemrushPageSignalsForTenant } from "@/domains/recommendation-intelligence/semrush-page-signals";
import { fetchTodayDerivedKpis } from "@/domains/daily-metric-snapshots/today-kpis";
import {
  buildSourceStatCards,
  type SourceStatCard,
} from "@/domains/today-summary/build-source-stat-cards";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";

// ─────────────────────────────────────────────────────────────────────
// Shared upstream — memoized via React.cache so multiple section
// loaders share a single Supabase round-trip per request.
// ─────────────────────────────────────────────────────────────────────

/**
 * Lean PostgREST projection for the V2 command-center canonical
 * observation reads. Mirrors the legacy /today `TODAY_OBSERVATION_COLUMNS`
 * list (defined locally rather than imported from `./today-data` to avoid
 * a module-init order hazard and because that legacy module is slated for
 * deletion). OMITS the ~5.9 MB `metadata` JSONB + citation/search columns
 * these rollups never read — the full-row pull was the dominant cause of
 * the V2 canonical-read statement-timeout for a data-rich tenant. If the
 * descriptor/visibility rollups ever consume a new column, add it here.
 */
const V2_OBSERVATION_COLUMNS =
  "id, prompt_id, run_id, answer_hash, position, tracked_brand_mentioned, " +
  "tracked_brand_cited, citation_count, owned_citation_count, mentions, " +
  "observed_at, platform, topic, tenant_id, mention_position, citation_rank, " +
  "primary_recommendation, descriptor_window, competitor_co_mentions, " +
  "citation_domain_classes, answer_structure, citation_urls, " +
  "competitor_descriptor_windows";

/**
 * Shared canonical data load. 60d observation window (covers
 * descriptor + visibility-derived data); 120d snapshot window
 * (keeps verdict-baseline math honest, mirrors the recommendations
 * loader's window). Cached per-request via React.cache.
 *
 * NOTE (2026-05-12 Phase 1): the visibility loader still consumes
 * this 60d pull. The descriptors loader now uses the narrower
 * `loadCachedFreshCanonical14d` variant below — they no longer share
 * an upstream call. When Phase 2 lands the materialized-snapshot
 * read model for the visibility section, this 60d call goes away
 * and `/` will be backed entirely by daily_metric_snapshots +
 * 14d obs (for descriptors only).
 */
export const loadCachedFreshCanonical = cache(async () => {
  // Side-effecting seeds — run in parallel with the canonical read.
  // These are idempotent; the parallel pattern matches what the
  // legacy `loadTodayPageData()` does at its top.
  await Promise.all([
    ensureRecommendationResponsesSeeded(),
    ensureUrlChangeOutcomesSeeded(),
    ensureCanonicalStoresSeeded(),
  ]);
  const NOW_MS = Date.now();
  const observationsSince = new Date(NOW_MS - 60 * 86_400_000).toISOString();
  const snapshotsSince = new Date(NOW_MS - 120 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // Lean projection — omit the ~5.9 MB `metadata` JSONB + unused citation/
  // search columns this surface never reads. The full-row pull was the
  // dominant cause of the V2 canonical-read statement-timeout for a
  // data-rich tenant. Same column set the legacy /today path already uses.
  return loadFreshCanonicalData({
    observationsSince,
    snapshotsSince,
    observationsColumns: V2_OBSERVATION_COLUMNS,
  });
});

/**
 * Narrower canonical data load for the descriptors section ONLY (2026-05-12).
 *
 * The descriptors UI advertises 7d (brand rollup, competitor rollup, format
 * wins) and 14d (sparklines) windows. The 60d shared pull was wasteful —
 * descriptor rollups never look further back than 14d. This variant pulls
 * only what descriptors needs, in parallel with (not piggybacking on) the
 * visibility loader's 60d pull. Net effect: the descriptors section streams
 * faster on cold load because it waits for a smaller payload.
 *
 * Idempotent seeds repeat across the two cached calls (React.cache slots
 * are independent); each seed self-checks a "seeded?" flag internally so
 * the second call is a no-op.
 */
export const loadCachedFreshCanonical14d = cache(async () => {
  await Promise.all([
    ensureRecommendationResponsesSeeded(),
    ensureUrlChangeOutcomesSeeded(),
    ensureCanonicalStoresSeeded(),
  ]);
  const NOW_MS = Date.now();
  const observationsSince = new Date(NOW_MS - 14 * 86_400_000).toISOString();
  const snapshotsSince = new Date(NOW_MS - 120 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  // Lean projection (see loadCachedFreshCanonical) — descriptors read the
  // same rollup columns and never touch `metadata`.
  return loadFreshCanonicalData({
    observationsSince,
    snapshotsSince,
    observationsColumns: V2_OBSERVATION_COLUMNS,
  });
});

/**
 * Shared full-pipeline load for sections that still depend on the
 * legacy assembly. Memoized so the visibility + action-cards
 * sections share a single underlying compute per request.
 */
export const loadCachedTodayPageData = cache(async () => {
  return await loadTodayPageData();
});

// ─────────────────────────────────────────────────────────────────────
// All-source summary stat row (2026-06-15) — the unified command-center
// scoreboard. Adds the four SEO/behavior loaders (GSC / GA4 / SEMrush /
// Clarity) to the "/" render path alongside the AEO KPIs that already
// load here, reduces each to its 2–4 headline numbers, and returns ONLY
// the cards whose source has REAL data (gate on data presence, never on
// connector status). Beacon is not an AEO-only tool — AEO is one card
// among equals.
//
// PERF (task #72 statement-timeout class): every loader is fail-soft
// (empty Map / null on any error) so one slow or empty source never
// blocks the others, the whole thing runs in ONE Promise.all, and the
// result is memoized via React.cache. The page mounts this section in
// its OWN <Suspense> boundary so it never blocks the rest of the page
// streaming. Tenant resolved ONCE and threaded into every loader.
// ─────────────────────────────────────────────────────────────────────

export type TodayV2AllSourceSummaryData = {
  cards: SourceStatCard[];
};

/**
 * Probe whether Clarity has more than one distinct day of synced data
 * for the tenant — drives the "building history" honesty label so we
 * never imply a trend off a single day (plan risk: Clarity one day
 * deep). Tiny bounded read (a handful of date rows), fail-soft to
 * `false` (treat thin data conservatively). The per-URL Clarity signal
 * loader doesn't carry dates, so this is a separate minimal lookup.
 */
async function claritySpansMultipleDays(
  tenantId: string,
  now: Date,
): Promise<boolean> {
  try {
    const since = new Date(now.getTime() - 28 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await getSupabaseAdmin()
      .from("clarity_daily_url_metrics")
      .select("date")
      .eq("tenant_id", tenantId)
      .gte("date", since)
      .order("date", { ascending: false })
      .limit(200);
    if (error || !data) return false;
    const distinct = new Set(
      (data as Array<{ date: string }>).map((r) => r.date),
    );
    return distinct.size > 1;
  } catch {
    return false;
  }
}

export const loadTodayV2AllSourceSummaryData = cache(
  async (): Promise<TodayV2AllSourceSummaryData> => {
    const tenantId = await currentTenantId();
    const now = new Date();

    // Run every source read in parallel; each is independently fail-soft
    // so a slow / empty / erroring source degrades to empty (no card)
    // without blocking the rest. `.catch` belt-and-suspenders on top of
    // each loader's own internal try/catch.
    // GSC summary card reads the LIGHT per-day site-totals table
    // (`gsc_daily_totals`, ~91 rows for a 90-day window) instead of the
    // heavy ~200-page per-page signal loader (~6.4s for Iranopedia). Same
    // headline numbers — total clicks/impressions, impressions-weighted
    // avg position, site CTR, 28d/prior-28d clicks split for the arrow —
    // in one tiny indexed read, so the card streams instantly. Fail-soft
    // to null (→ no GSC card; never a zero card).
    const [gscSiteTotals, ga4, clarity, semrush, aeo, clarityMultiDay] =
      await Promise.all([
        loadGscSiteTotalsForTenant(tenantId, now).catch((err) => {
          console.error("[today-v2] all-source GSC load failed:", err);
          return null;
        }),
        loadGa4PageValuesForTenant(tenantId, now).catch((err) => {
          console.error("[today-v2] all-source GA4 load failed:", err);
          return new Map();
        }),
        loadClarityPageSignalsForTenant(tenantId, now).catch((err) => {
          console.error("[today-v2] all-source Clarity load failed:", err);
          return new Map();
        }),
        loadSemrushPageSignalsForTenant(tenantId).catch((err) => {
          console.error("[today-v2] all-source SEMrush load failed:", err);
          return new Map();
        }),
        fetchTodayDerivedKpis({ tenantId, now }).catch((err) => {
          console.error("[today-v2] all-source AEO KPIs load failed:", err);
          return null;
        }),
        claritySpansMultipleDays(tenantId, now),
      ]);

    const cards = buildSourceStatCards(
      { gscSiteTotals, ga4, clarity, semrush, aeo },
      clarityMultiDay,
    );
    return { cards };
  },
);

/**
 * Whether the tenant has any AEO ("AI answers") data worth surfacing —
 * drives whether the demoted, collapsible AI-answers block opens by
 * default (open when there's data; collapsed when empty so it never
 * opens to a blank section). Checks recent raw `prompt_answer_
 * observations` (the same signal the demoted descriptors + visibility
 * sections render from) rather than the derived rollup, because crons
 * are off so the rollup can be empty even when raw observations exist.
 *
 * Tiny tenant-scoped bounded read; fail-soft to `false`. Memoized so
 * the page can call it cheaply alongside the section mounts.
 */
export const loadTodayV2HasAeoData = cache(async (): Promise<boolean> => {
  try {
    const tenantId = await currentTenantId();
    const repo = getRepository().forTenant(tenantId);
    const since = new Date(Date.now() - 14 * 86_400_000).toISOString();
    // Existence-only probe — we just need ">0", never the row bodies. Project
    // the single indexed `observed_at` column so the read is lean: the
    // default full-row pull dragged the ~5.9 MB `metadata` JSONB across the
    // wire for a data-rich tenant (Ritz), causing the #72 statement-timeout —
    // and this probe is awaited INLINE before any section streams, so the
    // timeout hung the entire V2 page. Lean projection makes it index-fast.
    const recentObs = await repo.getPromptAnswerObservations({
      since,
      columns: "observed_at",
    });
    return recentObs.length > 0;
  } catch (err) {
    console.error("[today-v2] hasAeoData probe failed:", err);
    return false;
  }
});

// ─────────────────────────────────────────────────────────────────────
// Section 1: Descriptors — narrow loader.
// ─────────────────────────────────────────────────────────────────────

export type TodayV2DescriptorsData = {
  enrichmentV2: EnrichmentV2Data | null;
  enrichmentRollup: EnrichmentRollup | null;
};

export async function loadTodayV2DescriptorsData(): Promise<TodayV2DescriptorsData> {
  // MT-2 (2026-05-22) — tenant-aware resolution. Previously this only
  // resolved the tenant to warm downstream reads and discarded it; now we
  // pass it explicitly into the business-config read below.
  const tenantId = await currentTenantId();
  const businessConfig =
    (await hydrateBusinessConfigFromSupabase(tenantId)) ??
    getBusinessConfig(tenantId);
  // Phase 1 (2026-05-12): descriptors uses the narrow 14d canonical pull
  // — see `loadCachedFreshCanonical14d` for rationale. The 7d / 14d
  // rollups never look further back than this, so the previous 60d
  // shared pull was wasteful for this section.
  const fresh = await loadCachedFreshCanonical14d();
  const { promptAnswerObservations, trackedEntities } = fresh;

  const tenantStripWordsForRollups = businessConfig.stripWords ?? [];

  // Enrichment v2 — same compute path as loadTodayPageData (lines
  // ~509–573). Defensive: a single rollup failure must not blank out
  // the whole descriptors section.
  let enrichmentV2: EnrichmentV2Data | null = null;
  try {
    const v2EndDate = todayISOUtc();
    const v2WindowDays = 7;
    const v2BrandAliases = [
      businessConfig.name,
      businessConfig.name.split(" ")[0],
    ].filter((a, i, arr) => a && arr.indexOf(a) === i);
    const v2BrandName = v2BrandAliases[0] ?? "You";

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
    console.error("[today-v2] enrichment-v2 bundle failed:", err);
    enrichmentV2 = null;
  }

  // Enrichment rollup fallback (older path). Mirrors the legacy
  // loader's pattern of falling back to yesterday if today's window
  // is empty pre-cron.
  let enrichmentRollup: EnrichmentRollup | null = null;
  try {
    enrichmentRollup = buildEnrichmentRollup({
      observations: promptAnswerObservations,
      date: todayISOUtc(),
      tenantStripWords: tenantStripWordsForRollups,
    });
    if (enrichmentRollup.totalObservations === 0) {
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
    console.error("[today-v2] enrichment-rollup failed:", err);
    enrichmentRollup = null;
  }

  return { enrichmentV2, enrichmentRollup };
}

// ─────────────────────────────────────────────────────────────────────
// Section 2: Visibility group — snapshot-backed loader (Phase 2B,
// 2026-05-13).
//
// All of `visibilityData` (chart series, leaderboards, by-platform,
// competitor series, chart events) is produced by
// `loadVisibilityReadModelFromSnapshots` — see `src/domains/today/
// visibility-read-model.ts` for the per-column formulas. No request-
// path read of `prompt_answer_observations` from this loader.
//
// `enrichmentV2` (for the hero's per-platform stat row) still requires
// raw observations to compute `primaryRate` and descriptor data. The
// 60-day shared canonical pull is gone — we use the same narrow 14-day
// canonical the descriptors section uses (`loadCachedFreshCanonical14d`).
// React.cache de-dupes the two callers per request.
// ─────────────────────────────────────────────────────────────────────

export type TodayV2VisibilityData = {
  visibilityData: TodayPageData["visibilityData"];
  enrichmentV2: EnrichmentV2Data | null;
  /**
   * Section 6 C4b (2026-05-15) — snapshot-derived per-platform primary-
   * recommendation percentage for the Today hero pills. Replaces the
   * client-side `platformPrimaryPct(platform)` closure that searched
   * `enrichmentV2.sparklines` (which had a casing bug suppressing the
   * pills in production). Numbers come from
   * `daily_metric_snapshots.primary_recommendation_count / total_possible`
   * on the latest platform-scope row with usable data; mathematically
   * equivalent to the legacy path per
   * `tests/domains/today/today-primary-share-equivalence.test.ts`.
   */
  primaryShare: TodayPrimaryShare;
};

export async function loadTodayV2VisibilityData(): Promise<TodayV2VisibilityData> {
  const tenantId = await currentTenantId();
  const businessConfig =
    (await hydrateBusinessConfigFromSupabase(tenantId)) ??
    getBusinessConfig(tenantId);
  const brandName = businessConfig.name || "You";

  // ── Snapshot-backed visibility data ────────────────────────────────
  // The read-model loader returns the same shape the legacy loader did
  // (brandSeriesByMetric / brandSeriesByPlatform / leaderboardByMetric /
  // leaderboardByMetricAndWindow / competitorSeriesByMetric / chartEvents
  // / chartEndDate). It reads daily_metric_snapshots + a small live
  // chart-events overlay — no raw prompt_answer_observations.
  const readModel = await loadVisibilityReadModelFromSnapshots({ tenantId });
  const visibilityData = {
    brandName: readModel.brandName,
    brandSeriesByMetric: readModel.brandSeriesByMetric,
    brandSeriesByPlatform: readModel.brandSeriesByPlatform,
    leaderboardByMetric: readModel.leaderboardByMetric,
    leaderboardByMetricAndWindow: readModel.leaderboardByMetricAndWindow,
    chartEndDate: readModel.chartEndDate,
    competitorSeriesByMetric: readModel.competitorSeriesByMetric,
    chartEvents: readModel.chartEvents,
    // Freshness/cache hardening (2026-05-13). The hero renders a
    // subtle pill from these fields; status drives the tone.
    freshness: {
      status: readModel.freshness.status,
      latestSnapshotDate: readModel.freshness.latestSnapshotDate,
      label: readModel.freshness.label,
    },
  };

  // ── EnrichmentV2 for hero's per-platform stat row ──────────────────
  // The hero's per-platform sparkline shows the brand's `primary_recommendation`
  // rate per platform over a 14-day window. That signal lives on
  // `prompt_answer_observations.primary_recommendation` and is NOT in
  // daily_metric_snapshots. Phase 2B keeps the 14-day obs read (via the
  // shared `loadCachedFreshCanonical14d` cache the descriptors section
  // already calls) so the hero stat row stays intact. The 60-day pull
  // and the computeVisibility*/computeLeaderboard helpers are gone.
  const tenantStripWords = businessConfig.stripWords ?? [];
  let enrichmentV2: EnrichmentV2Data | null = null;
  try {
    const fresh14 = await loadCachedFreshCanonical14d();
    const promptAnswerObservations = fresh14.promptAnswerObservations;
    const trackedEntities = fresh14.trackedEntities;
    const v2EndDate = todayISOUtc();
    const v2WindowDays = 7;
    const brandV2Rollup = buildEnrichmentWindowRollup({
      observations: promptAnswerObservations,
      endDate: v2EndDate,
      windowDays: v2WindowDays,
      maxDescriptors: 5,
      tenantStripWords,
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
        tenantStripWords,
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
      brandName,
      windowEndDate: v2EndDate,
      windowDays: v2WindowDays,
      brand: brandV2Rollup,
      competitorOptions,
      competitorRollups,
      sparklines,
      formatWins,
    };
  } catch (err) {
    console.error("[today-v2] visibility enrichmentV2 failed:", err);
    enrichmentV2 = null;
  }

  // ── Section 6 C4b (2026-05-15) — snapshot-derived primary share ─
  // Read the per-platform primary-recommendation percentages from
  // `daily_metric_snapshots` rather than re-computing client-side from
  // `enrichmentV2.sparklines`. The helper module
  // (`@/domains/daily-metric-snapshots/today-primary-share`) filters
  // scope_type='platform' + source_type='derived' + non-null counts
  // + total_possible > 0, picks the latest-by-date row per platform,
  // and rounds to integer percent. Mathematically equivalent to the
  // legacy path per the C4a equivalence harness; the difference is
  // that the legacy client closure had a casing bug
  // (`s.platform === "ChatGPT"` against canonicalized lowercase
  // sparkline keys) that suppressed the pills in production.
  //
  // 14-day `since` window matches the legacy sparkline window so the
  // "tenant has no recent data" hero behavior stays consistent.
  //
  // Tenant isolation: explicit `.forTenant(tenantId)` binding; the
  // helper module never reads tenantId directly. Pinned by
  // `tests/architecture/today-primary-share-tenant-isolation.test.ts`.
  const sinceDate = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 14);
    return d.toISOString().slice(0, 10);
  })();
  const primaryShareRepo = getRepository().forTenant(tenantId);
  const primaryShare = await computeTodayPrimaryShare({
    repo: primaryShareRepo,
    options: { since: sinceDate },
  });

  return { visibilityData, enrichmentV2, primaryShare };
}

// ─────────────────────────────────────────────────────────────────────
// Section 3: Action cards — narrow loader.
//
// PARTIAL EQUIVALENCE with the legacy assembledAll:
//
//   * Hurting verdicts:  derived from urlChangeOutcomes (full equivalence
//                        with legacy modulo `baselineCitations` which is
//                        omitted to skip the citation-evidence-index
//                        compute).
//   * Winning verdicts:  derived from urlChangeOutcomes (same partial
//                        equivalence as hurting).
//   * Schema parity:     NOT INCLUDED. These come from the schema-parity
//                        analyzer which lives inside loadTodayPageData
//                        and depends on the full page-snapshots pipeline.
//   * Rec-engine top picks (serializedPrimary / serializedSecondary):
//                        NOT INCLUDED. These come from the legacy
//                        recommendation pipeline.
//
// Production behavior: for tenants with active hurting/helping change
// outcomes, the hurting verdict's high priority score (80 + |Z|)
// dominates the primary-action selection. So the visible primaryAction
// is typically identical to legacy. Tenants whose primary action would
// have come from schema parity or the rec engine will see a null
// primaryAction → the empty-state "Nothing to ship right now" card.
// The legacy table at /recommendations is the source of truth for the
// dropped sources; the operator can also hit `/?legacy=1` to see the
// full assembledAll.
//
// `lifecycleSummary` is built via the SAME helper the legacy path uses
// (buildTodayLifecycleSummary), so the Working card is byte-equivalent.
// ─────────────────────────────────────────────────────────────────────

export type TodayV2ActionCardsData = {
  primaryAction: TodayPrimaryAction | null;
  measuredWins: TodayPrimaryAction[];
  urlVerdictProof: TodayPageData["urlVerdictProof"];
  lifecycleSummary: TodayLifecycleSummary | null;
};

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

type HelpingRow = {
  url: string;
  changeId: string;
  deltaPct: number | null;
  deltaAbs: number;
  landingZ: number;
  confidence: "low" | "medium" | "high";
  baselineDaysUsed: number;
  postDaysUsed: number;
  updatedAt: string;
  landingDayN: number | null;
};

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  } catch {
    return "recently";
  }
}

/**
 * Adapt the top persisted recommendation queue item into a
 * `TodayPrimaryAction` shape so Do Today can render it as the primary
 * card when there is no fresh hurting verdict.
 *
 * Fields are sourced from the synthesized `LiveRecQueueItem` and its
 * underlying `recommended_edits` rows — same data `/recommendations`
 * shows in its top-of-queue card. No live generation runs; no new
 * Supabase reads beyond what the persisted loader already does.
 *
 * Priority score is set BELOW the hurting-verdict floor (which starts
 * at 80) so a hurting verdict always dominates if one exists.
 *
 * Exported for unit testing — the production call site is the only
 * runtime caller.
 */
export function adaptPersistedRecToTodayPrimaryAction(item: {
  rec: { stableKey: string; title: string; description: string; severity: "high" | "medium" | "low" };
  edits: ReadonlyArray<{ display_label?: string | null; why?: string | null; confidence: "low" | "medium" | "high"; target_url: string | null }>;
  response: { status?: string | null } | null;
}): TodayPrimaryAction {
  const rec = item.rec;
  const primaryEdit = item.edits[0];
  const targetUrl = primaryEdit?.target_url ?? null;
  const why = (primaryEdit?.why ?? rec.description ?? "").trim();
  const headline =
    primaryEdit?.display_label?.trim() ||
    rec.title?.trim() ||
    "Ship a saved recommendation";
  const rationale =
    why ||
    "This recommendation is queued in /recommendations and ready to act on.";
  const confidence: "low" | "medium" | "high" =
    primaryEdit?.confidence ?? "medium";
  const bucket: TodayPrimaryAction["bucket"] =
    rec.severity === "high"
      ? "critical"
      : rec.severity === "medium"
        ? "high_leverage"
        : "opportunistic";
  const responseStatus = item.response?.status as
    | "accepted"
    | "dismissed"
    | "deferred"
    | null
    | undefined;

  return {
    id: rec.stableKey,
    headline,
    rationale,
    expectedOutcome: "Improve visibility on the matched prompts.",
    sourceEvidence: `${item.edits.length} edit${item.edits.length === 1 ? "" : "s"} ready in /recommendations`,
    // Below the hurting-verdict floor (80 + |z|) so any hurting verdict
    // dominates this fallback. Above the helping-verdict scores (~75-).
    priorityScore: 60,
    bucket,
    type: "persisted_recommendation",
    confidence,
    href: `/recommendations/${rec.stableKey}`,
    responseStatus: responseStatus ?? null,
    targetPageUrl: targetUrl,
    targetPagePath: targetUrl,
    sourceChangeId: null,
  };
}

export async function loadTodayV2ActionCardsData(): Promise<TodayV2ActionCardsData> {
  const tenantId = await currentTenantId();
  // Ensure store seeds (idempotent; React.cache via loadCachedFreshCanonical
  // already runs these but be defensive in case this loader is called
  // before that one).
  await Promise.all([
    ensureRecommendationResponsesSeeded(),
    ensureUrlChangeOutcomesSeeded(),
    ensureCanonicalStoresSeeded(),
  ]);

  const repo = getRepository().forTenant(tenantId);

  // Parallel reads — all small.
  const [urlChangeOutcomes, changelogEntriesRaw, recResponses, recommendedEdits] =
    await Promise.all([
      getUrlChangeOutcomes(),
      getChangelogEntries(),
      repo.getRecommendationResponses(),
      repo.getRecommendedEdits(),
    ]);
  const changelogEntries: ChangelogEntry[] = changelogEntriesRaw;

  // ── Hurting verdicts → primaryAction candidates ──
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
    if (latest?.verdict !== "hurting") continue;
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
  const changeById = new Map(changelogEntries.map((c) => [c.id, c]));
  const hurtingActions: ActionCardAction[] = Array.from(hurtingByUrl.values()).map((h) => {
    const absZ = Math.abs(h.z);
    const pctStr =
      h.deltaPct < 0
        ? `${Math.abs(h.deltaPct * 100).toFixed(0)}% fewer citations`
        : "a citation decline";
    const change = changeById.get(h.changeId);
    const changeDate = change?.timestamp ? fmtDate(change.timestamp) : null;
    const changeDesc =
      change?.change_description?.trim() ?? change?.asset_name?.trim() ?? null;
    const daysSinceRecorded = Math.max(
      0,
      Math.floor((Date.now() - new Date(h.recordedAt).getTime()) / 86_400_000),
    );
    const trendSuffix = hurtingTrendSuffix({ transitions: h.transitions });
    const headline = changeDate
      ? `${h.url} regressed after your ${changeDate} change`
      : `${h.url} is losing AI visibility`;
    const rationaleLead =
      changeDesc && changeDate
        ? `On ${changeDate}, ${changeDesc}. Since then`
        : changeDate
          ? `Since your ${changeDate} change`
          : "Since the latest detected change";
    const rationale = `${rationaleLead}, this page is getting ${pctStr} (${h.confidence} confidence). Hurting for ${daysSinceRecorded}d${trendSuffix}. Review the change — revert, iterate, or confirm it's platform noise.`;
    return {
      id: `hurt-${h.changeId}-${h.url}`,
      headline,
      rationale,
      expectedOutcome: "Restore or improve citation count to baseline.",
      sourceEvidence: `${h.baselineDaysUsed}d baseline → ${h.postDaysUsed}d post-change`,
      priorityScore: 80 + Math.min(absZ, 30),
      bucket: "critical" as const,
      type: "hurting_verdict" as const,
      confidence: h.confidence,
      href: `/changes/${h.changeId}`,
      responseStatus: null,
      targetPageUrl: h.url,
      targetPagePath: h.url,
      baselineCitations: null,
      sourceChangeId: h.changeId,
      evidenceBasis: "tenant_history" as const,
    };
  });
  hurtingActions.sort((a, b) => b.priorityScore - a.priorityScore);

  const acknowledgedHurtingCardIds = new Set(
    recResponses
      .filter((r) => r.status === "dismissed" && r.recId.startsWith("hurt-"))
      .map((r) => r.recId),
  );
  const visibleHurtingActions = hurtingActions.filter(
    (a) => !acknowledgedHurtingCardIds.has(a.id),
  );

  // ── Helping verdicts → measuredWins + urlVerdictProof ──
  const helpingByUrl = new Map<string, HelpingRow>();
  for (const o of urlChangeOutcomes) {
    if (o.verdict !== "helping") continue;
    const existing = helpingByUrl.get(o.url);
    if (!existing || o.updated_at > existing.updatedAt) {
      helpingByUrl.set(o.url, {
        url: o.url,
        changeId: o.change_id,
        deltaPct: o.delta_pct,
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
  const visibleHelping = Array.from(helpingByUrl.values()).filter((h) => {
    const latest = latestVerdictByUrl.get(h.url);
    return latest?.verdict === "helping";
  });
  visibleHelping.sort((a, b) => Math.abs(b.landingZ) - Math.abs(a.landingZ));
  const topHelpingUrls = visibleHelping.slice(0, 2);

  const winningActions: ActionCardAction[] = [];
  for (const h of topHelpingUrls) {
    const winCardId = `win-${h.changeId}-${h.url}`;
    const acknowledgedWin = recResponses.some(
      (r) => r.recId === winCardId && r.status === "dismissed",
    );
    if (acknowledgedWin) continue;
    const change = changeById.get(h.changeId);
    const changeDate = change?.timestamp ? fmtDate(change.timestamp) : null;
    const changeDesc =
      change?.change_description?.trim() ?? change?.asset_name?.trim() ?? null;
    const headline = changeDate
      ? `Citation lift detected on ${h.url} after the ${changeDate} change`
      : `Citation lift detected on ${h.url} (measured per page)`;
    const absDeltaPerDay = Math.abs(h.deltaAbs);
    const directionVerb = h.deltaAbs >= 0 ? "rose" : "fell";
    const rationale =
      h.deltaAbs >= 0
        ? `This page gained citations after the change. Beacon is tracking the pattern so you can repeat what worked.`
        : `This page lost citations after the change. Beacon is tracking to see if it recovers.`;
    const isExtremePct = h.deltaPct !== null && Math.abs(h.deltaPct) >= 3.0;
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
      sourceEvidence: `${h.baselineDaysUsed}d baseline → ${h.postDaysUsed}d post-change`,
      priorityScore: 75 - winningActions.length,
      bucket: "high_leverage" as const,
      type: "helping_verdict" as const,
      confidence: h.confidence,
      href: `/changes/${h.changeId}`,
      responseStatus: null,
      targetPageUrl: h.url,
      targetPagePath: h.url,
      baselineCitations: null,
      sourceChangeId: h.changeId,
      evidenceBasis: "tenant_history" as const,
      lineageBullets,
    });
  }

  // Build primaryAction.
  //
  // Priority (2026-05-12 — Phase 1 Do Today correctness fix):
  //   1. Strongest visible hurting verdict (existing behavior).
  //   2. Top persisted recommendation from `loadPersistedRecommendationQueueForPage`
  //      — the SAME source `/recommendations` v2 reads, so Today and
  //      Recommendations stay in sync. Skipped when the rec was dismissed
  //      via recommendation_responses.
  //   3. Calm empty state ("Nothing to ship right now") only when both
  //      above are empty.
  //
  // No live recommendation generation runs here — only reads from
  // persisted rows (`recommended_edits` + `recommendation_responses`).
  let primaryAction: TodayPrimaryAction | null =
    (visibleHurtingActions[0] as unknown as TodayPrimaryAction | undefined) ??
    null;
  if (!primaryAction) {
    try {
      const persisted = await loadPersistedRecommendationQueueForPage({
        tenantId,
      });
      const topItem = persisted.queue.find(
        (item) => item.response?.status !== "dismissed",
      );
      if (topItem) {
        primaryAction = adaptPersistedRecToTodayPrimaryAction(topItem);
      }
    } catch (err) {
      // Silent failure — fall back to the empty state. Do not block the
      // page on a persisted-queue read miss; the user will still see
      // working / recent wins / descriptors render normally.
      console.error("[today-v2] persisted-rec fallback failed:", err);
    }
  }
  const measuredWins: TodayPrimaryAction[] =
    winningActions as unknown as TodayPrimaryAction[];

  // urlVerdictProof — derived from topHelpingUrls[0] (same logic as
  // legacy lines 2558–2580).
  let urlVerdictProof: TodayPageData["urlVerdictProof"] = null;
  if (topHelpingUrls[0]) {
    const h = topHelpingUrls[0];
    const change = changeById.get(h.changeId);
    const deltaPct = h.deltaPct ?? 0;
    const deltaLabel =
      deltaPct >= 0
        ? `+${Math.round(deltaPct * 100)}%`
        : `${Math.round(deltaPct * 100)}%`;
    urlVerdictProof = {
      changeId: h.changeId,
      pagePath: h.url,
      changeDate: change?.timestamp ?? null,
      citationDeltaPct: deltaPct,
      deltaLabel,
    };
  }

  // Lifecycle summary — reuse the existing helper (now exported from
  // today-data.ts). Identical math to legacy.
  let lifecycleSummary: TodayLifecycleSummary | null = null;
  try {
    lifecycleSummary = await buildTodayLifecycleSummary(
      repo,
      changelogEntries,
      urlChangeOutcomes,
      new Date(),
    );
  } catch (err) {
    console.error("[today-v2] lifecycle summary build failed:", err);
    lifecycleSummary = null;
  }

  // Suppress unused-import warning for recommendedEdits; we don't use
  // it directly here but the parallel fetch warms the repo's internal
  // cache for the lifecycle build above which DOES read it. Kept
  // explicit to surface the dependency intent.
  void recommendedEdits;

  return {
    primaryAction,
    measuredWins,
    urlVerdictProof,
    lifecycleSummary,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Gate: demo mode + first reading. Fast checks that decide whether to
// render the demo / waiting view INSTEAD of the section streamed
// layout. Caller awaits this FIRST and short-circuits when needed.
// ─────────────────────────────────────────────────────────────────────

export type TodayV2GateData = {
  isDemoMode: boolean;
  firstReading: import("@/domains/onboarding/first-reading-state").FirstReadingDetection;
};

export async function loadTodayV2GateData(): Promise<TodayV2GateData> {
  // "Demo mode" (→ the connect-prompt) ONLY when the tenant has NO CSV import
  // AND no real data source connected. A GSC- (or GA4/SEMrush/Clarity/Profound/
  // Wix-) connected tenant is operating on its own live data, so it sees its
  // real command center — never the connect-prompt — even before its first CSV
  // import or first reading. Mirrors the shell's hasRealConnector gate
  // (layout.tsx) so the two never disagree. (2026-06-15 fix: GSC-connected
  // tenants were wrongly shown "Connect your data sources".)
  const isDemoMode =
    !(await hasActiveExperiment()) && !(await hasAnyConnectedDataSource());
  // Phase 1 (2026-05-12): the gate used to call `loadCachedFreshCanonical`
  // (60d obs pull) just to inspect observationCount > 0 and active prompt
  // count. Now we read a narrow 7d obs window + tracked_prompts directly
  // from the tenant repo — both ~indexed, tenant-scoped, small reads.
  //
  // Inference rules are unchanged:
  //   - any observation in the last 7d → definitely not first reading
  //   - no active prompts at all → not first reading (no work pending)
  //   - else (active prompts but no recent obs) → cold-tenant path
  let observationCount = 0;
  let activePromptCount = 0;
  try {
    const tenantId = await currentTenantId();
    const repo = getRepository().forTenant(tenantId);
    const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const [recentObs, prompts] = await Promise.all([
      // observationCount only feeds `observationCount > 0` below — we never
      // read the row bodies here, so project the lean `observed_at` column.
      // The full-row pull dragged the heavy `metadata` JSONB across the wire
      // and statement-timed-out for a data-rich tenant; since this gate is
      // awaited FIRST (before any section streams), that timeout hung the
      // whole V2 page. Lean projection keeps the gate index-fast.
      repo.getPromptAnswerObservations({ since, columns: "observed_at" }),
      repo.getTrackedPrompts(),
    ]);
    observationCount = recentObs.length;
    activePromptCount = prompts.filter((p) => p.is_active).length;
  } catch (err) {
    // Defensive: if anything throws (e.g. repo init error during cold
    // tenant context), short-circuit to "not first reading" — the
    // section streams will still render normally and the page won't
    // block on the gate.
    console.error("[today-v2] gate cheap reads failed:", err);
    return { isDemoMode, firstReading: { isFirstReading: false } };
  }

  if (observationCount > 0 || activePromptCount === 0) {
    return { isDemoMode, firstReading: { isFirstReading: false } };
  }
  // Cold-tenant path — need the tenant record to decide. Mirror the
  // resolveFirstReadingState fallback (returns false on any error).
  try {
    const { currentTenant } = await import("@/lib/tenant-context");
    const { detectFirstReadingState } = await import(
      "@/domains/onboarding/first-reading-state"
    );
    const tenant = await currentTenant();
    return {
      isDemoMode,
      firstReading: detectFirstReadingState({
        tenant,
        activePromptCount,
        observationCount,
      }),
    };
  } catch {
    return { isDemoMode, firstReading: { isFirstReading: false } };
  }
}
