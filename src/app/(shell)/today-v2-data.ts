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
import {
  ensureCanonicalStoresSeeded,
  loadFreshCanonicalData,
} from "@/storage/canonical-store";
import { ensureRecommendationResponsesSeeded } from "@/domains/product/recommendation-response-store";
import { ensureUrlChangeOutcomesSeeded } from "@/domains/attribution/url-change-outcome";
import { getBusinessConfig } from "@/lib/business-config";
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
import { loadTodayPageData, type TodayPageData } from "./today-data";

// ─────────────────────────────────────────────────────────────────────
// Shared upstream — memoized via React.cache so multiple section
// loaders share a single Supabase round-trip per request.
// ─────────────────────────────────────────────────────────────────────

/**
 * Shared canonical data load. 60d observation window (covers
 * descriptor + visibility-derived data); 120d snapshot window
 * (keeps verdict-baseline math honest, mirrors the recommendations
 * loader's window). Cached per-request via React.cache.
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
  return loadFreshCanonicalData({ observationsSince, snapshotsSince });
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
// Section 1: Descriptors — narrow loader.
// ─────────────────────────────────────────────────────────────────────

export type TodayV2DescriptorsData = {
  enrichmentV2: EnrichmentV2Data | null;
  enrichmentRollup: EnrichmentRollup | null;
};

export async function loadTodayV2DescriptorsData(): Promise<TodayV2DescriptorsData> {
  await currentTenantId(); // ensure tenant is resolved for downstream seed/business-config reads
  const fresh = await loadCachedFreshCanonical();
  const { promptAnswerObservations, trackedEntities } = fresh;

  const tenantStripWordsForRollups = getBusinessConfig().stripWords ?? [];

  // Enrichment v2 — same compute path as loadTodayPageData (lines
  // ~509–573). Defensive: a single rollup failure must not blank out
  // the whole descriptors section.
  let enrichmentV2: EnrichmentV2Data | null = null;
  try {
    const v2EndDate = todayISOUtc();
    const v2WindowDays = 7;
    const v2BrandAliases = [
      getBusinessConfig().name,
      getBusinessConfig().name.split(" ")[0],
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
// Section 2 + 3: Visibility group + action cards — currently backed
// by the shared cached `loadTodayPageData()`.
// ─────────────────────────────────────────────────────────────────────

export async function loadTodayV2VisibilityAndActionsData(): Promise<
  Pick<
    TodayPageData,
    | "visibilityData"
    | "primaryAction"
    | "measuredWins"
    | "urlVerdictProof"
    | "lifecycleSummary"
    | "enrichmentV2"
  >
> {
  const data = await loadCachedTodayPageData();
  return {
    visibilityData: data.visibilityData,
    primaryAction: data.primaryAction,
    measuredWins: data.measuredWins,
    urlVerdictProof: data.urlVerdictProof,
    lifecycleSummary: data.lifecycleSummary,
    // The hero's per-platform stat row reads from enrichmentV2.sparklines;
    // legacy loader has already computed it, so we forward that value.
    // The descriptors section may STILL call the narrow loader for the
    // descriptors-specific compute — that's fine, both paths share the
    // same observation rollup math.
    enrichmentV2: data.enrichmentV2,
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
  // hasActiveExperiment is an async cached getter.
  const isDemoMode = !(await hasActiveExperiment());
  // FirstReading is short-circuited (per the 2026-05-12 cleanup) to
  // `{ isFirstReading: false }` whenever observationCount > 0. For a
  // mature tenant this is the case; for new tenants it'll fetch the
  // tenant record. We don't pay the canonical-read cost here; the
  // descriptors section pays it for everyone via loadCachedFreshCanonical.
  // To keep the gate cheap, we infer first-reading state from
  // canonical: if observationCount > 0, definitely not first reading.
  const fresh = await loadCachedFreshCanonical();
  const observationCount = fresh.promptAnswerObservations.length;
  const activePromptCount = fresh.trackedPrompts.filter(
    (p) => p.is_active,
  ).length;
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
