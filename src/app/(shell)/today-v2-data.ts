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
import {
  ensureRecommendationResponsesSeeded,
} from "@/domains/product/recommendation-response-store";
import {
  ensureUrlChangeOutcomesSeeded,
  getUrlChangeOutcomes,
} from "@/domains/attribution/url-change-outcome";
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
import { buildObservationRollup } from "@/domains/today/observation-rollup";
import {
  computeVisibilityTimeSeries,
  computeVisibilityTimeSeriesByPlatform,
  computeLeaderboard,
  computeCompetitorSeries,
  type EntityVisibility,
  type VisibilityMetric,
  type VisibilityPoint,
} from "@/domains/product/visibility-score";
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
// Section 2: Visibility group — narrow loader.
//
// The hero / chart / leaderboard subtree consumes a `visibilityData`
// shape that's a pure projection of:
//   - promptAnswerObservations  (from loadCachedFreshCanonical)
//   - trackedEntities           (from loadCachedFreshCanonical)
//   - brandAliases              (from getBusinessConfig)
//   - observationRollup         (pure compute over observations)
//   - urlChangeOutcomes         (for chartEvents)
//   - changelogEntries          (for chartEvents)
//
// The legacy `loadTodayPageData()` ALSO computes a `competitorLine`
// using `primaryVisibilityRunForResults` + `loadCompetitorUniverseRuntime`,
// but the v2 visibility group doesn't consume those — they feed
// `buildTodaySummary` and the legacy `competitorLine` field, neither
// of which v2 renders.
//
// The hero's per-platform stat row reads from `enrichmentV2.sparklines`,
// so we also forward an enrichmentV2 build here (separately from the
// descriptors section's call to keep the section independently
// streaming). React.cache de-dupes the canonical read across the two.
// ─────────────────────────────────────────────────────────────────────

export type TodayV2VisibilityData = {
  visibilityData: TodayPageData["visibilityData"];
  enrichmentV2: EnrichmentV2Data | null;
};

const VISIBILITY_METRICS: VisibilityMetric[] = [
  "composite",
  "mention_rate",
  "citation_rate",
];
const LEADERBOARD_WINDOWS: ReadonlyArray<number> = [7, 14, 30, 60];

export async function loadTodayV2VisibilityData(): Promise<TodayV2VisibilityData> {
  await currentTenantId();
  const fresh = await loadCachedFreshCanonical();
  const { promptAnswerObservations, trackedEntities } = fresh;

  const businessConfig = getBusinessConfig();
  const brandAliases = [
    businessConfig.name,
    businessConfig.name.split(" ")[0],
  ].filter((a, i, arr) => a && arr.indexOf(a) === i);
  const brandName = brandAliases[0] ?? "You";

  const observationRollup = buildObservationRollup({
    observations: promptAnswerObservations,
    brandAliases,
  });

  const today = new Date();
  const isoDay = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (n: number) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - n);
    return isoDay(d);
  };
  const chartEndDate = isoDay(today);
  const chartStartDate = daysAgo(59);

  // Tenant 60-day time series, all three metrics.
  const brandSeriesByMetric = {} as Record<VisibilityMetric, VisibilityPoint[]>;
  for (const m of VISIBILITY_METRICS) {
    brandSeriesByMetric[m] = computeVisibilityTimeSeries({
      observations: promptAnswerObservations,
      metric: m,
      brandAliases,
      startDate: chartStartDate,
      endDate: chartEndDate,
      rollup: observationRollup,
    });
  }

  // Per-platform series for the chart's "by platform" view.
  const brandSeriesByPlatform = computeVisibilityTimeSeriesByPlatform({
    observations: promptAnswerObservations,
    brandAliases,
    startDate: chartStartDate,
    endDate: chartEndDate,
    rollup: observationRollup,
  });

  // Leaderboard for every chart-toggle window.
  const leaderboardByMetricAndWindow = {} as Record<
    VisibilityMetric,
    Record<number, EntityVisibility[]>
  >;
  for (const m of VISIBILITY_METRICS) {
    leaderboardByMetricAndWindow[m] = {} as Record<number, EntityVisibility[]>;
    for (const windowDays of LEADERBOARD_WINDOWS) {
      leaderboardByMetricAndWindow[m][windowDays] = computeLeaderboard({
        observations: promptAnswerObservations,
        brandAliases,
        windowEndDate: chartEndDate,
        windowDays,
        metric: m,
        limit: 5,
        trackedEntities,
        rollup: observationRollup,
      });
    }
  }
  // Backwards-compat: callers consume a single 14-day leaderboard from
  // `leaderboardByMetric.<metric>` too.
  const leaderboardByMetric = {} as Record<VisibilityMetric, EntityVisibility[]>;
  for (const m of VISIBILITY_METRICS) {
    leaderboardByMetric[m] = leaderboardByMetricAndWindow[m][14];
  }

  // Top competitors from the composite leaderboard (top 4 non-owned).
  const topCompetitorNames = leaderboardByMetric.composite
    .filter((e) => !e.isOwned)
    .slice(0, 4)
    .map((e) => e.name);

  const competitorSeriesByMetric = {} as Record<
    VisibilityMetric,
    Array<{ name: string; points: VisibilityPoint[] }>
  >;
  for (const m of VISIBILITY_METRICS) {
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

  // Chart events overlay — annotate hurting/helping URLs on the chart.
  // Reads urlChangeOutcomes + changelogEntries; both are small fast
  // reads. Defensive: failure here downgrades to no events (the chart
  // still renders without dots).
  let chartEvents: Array<{
    date: string;
    tone: "danger" | "success" | "neutral";
    label: string;
  }> = [];
  try {
    const [urlChangeOutcomes, changelogEntries] = await Promise.all([
      getUrlChangeOutcomes(),
      getChangelogEntries(),
    ]);
    const changeById = new Map(changelogEntries.map((c) => [c.id, c]));
    const latestVerdictByUrl = new Map<string, { verdict: string; updatedAt: string }>();
    for (const o of urlChangeOutcomes) {
      const existing = latestVerdictByUrl.get(o.url);
      if (!existing || o.updated_at > existing.updatedAt) {
        latestVerdictByUrl.set(o.url, {
          verdict: o.verdict,
          updatedAt: o.updated_at,
        });
      }
    }
    const eventDateKey = new Set<string>();
    // Hurting dots
    for (const o of urlChangeOutcomes) {
      if (o.verdict !== "hurting") continue;
      const latest = latestVerdictByUrl.get(o.url);
      if (latest?.verdict !== "hurting") continue;
      const change = changeById.get(o.change_id);
      const date = change?.timestamp?.slice(0, 10);
      if (!date) continue;
      const key = `hurt:${date}`;
      if (eventDateKey.has(key)) continue;
      eventDateKey.add(key);
      chartEvents.push({
        date,
        tone: "danger",
        label: `${o.url} — ${Math.abs(
          (o.delta_pct ?? 0) * 100,
        ).toFixed(0)}% drop after change on ${date}`,
      });
    }
    // Helping dots (latest verdict still helping)
    for (const [url, latest] of latestVerdictByUrl.entries()) {
      if (latest.verdict !== "helping") continue;
      let bestHelping: (typeof urlChangeOutcomes)[number] | null = null;
      for (const o of urlChangeOutcomes) {
        if (o.url !== url) continue;
        if (o.verdict !== "helping") continue;
        if (!bestHelping || o.updated_at > bestHelping.updated_at)
          bestHelping = o;
      }
      if (!bestHelping) continue;
      const change = changeById.get(bestHelping.change_id);
      const date = change?.timestamp?.slice(0, 10);
      if (!date) continue;
      const key = `help:${date}`;
      if (eventDateKey.has(key)) continue;
      eventDateKey.add(key);
      chartEvents.push({
        date,
        tone: "success",
        label: `${url} — citation lift detected after change on ${date}`,
      });
    }
  } catch (err) {
    console.error("[today-v2] chartEvents build failed:", err);
    chartEvents = [];
  }

  const visibilityData = {
    brandName,
    brandSeriesByMetric,
    brandSeriesByPlatform,
    leaderboardByMetric,
    leaderboardByMetricAndWindow,
    chartEndDate,
    competitorSeriesByMetric,
    chartEvents,
  };

  // EnrichmentV2 — for the hero's per-platform stat row. Same compute
  // path as the descriptors loader; React.cache de-dupes the canonical
  // read across both calls but the per-section enrichment build runs
  // once per loader invocation. Acceptable: the work is pure compute,
  // not Supabase I/O.
  const tenantStripWords = businessConfig.stripWords ?? [];
  let enrichmentV2: EnrichmentV2Data | null = null;
  try {
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

  return { visibilityData, enrichmentV2 };
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

  // Build primaryAction (first non-helping_verdict from the narrow
  // assembledAll). For v2's narrow path, assembledAll = hurting +
  // winning. Non-helping = hurting only.
  const primaryAction: TodayPrimaryAction | null =
    (visibleHurtingActions[0] as unknown as TodayPrimaryAction | undefined) ??
    null;
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
