/**
 * Today v2 visibility read-model loader (Phase 2B, 2026-05-13).
 *
 * Source-of-truth: `daily_metric_snapshots`. The chart series,
 * leaderboard slices, per-platform brand series, and competitor series
 * are all derived from the snapshot rows the poll pipeline already
 * writes — no 60-day raw observation pull on the request path.
 *
 * Equivalence with the obs-compute path (computeVisibilityTimeSeries
 * /Leaderboard etc. in visibility-score.ts) is pinned by the
 * production-data harness at
 * `scripts/_verify-prod-snapshot-equivalence.ts` and the unit harness
 * at `src/domains/today/visibility-read-model-equivalence.test.ts`.
 * Both reported 0.000 pp drift on every metric over the 60-day Ritz
 * window as of 2026-05-13.
 *
 * What flows from where (per snapshot column):
 *
 *   Brand chart `mention_rate` per day:
 *     SUM_platforms(brand_entity.mentioned_obs_count) /
 *     SUM_platforms(platform.total_possible) × 100
 *
 *   Brand chart `citation_rate` per day:
 *     SUM_platforms(platform.citation_count) /
 *     SUM_platforms(platform.total_possible) × 100
 *
 *   Brand chart `composite` per day:
 *     avg over sampled platforms of
 *     (platform.citation_count / platform.total_possible × 100)
 *
 *   Brand per-platform series (chart's by-platform view):
 *     platform.cited_or_mentioned_count / platform.total_possible × 100
 *
 *   Competitor series (mention/citation/composite all behave as
 *   "presence" — chart treats cited == mentioned for competitors):
 *     SUM_platforms(competitor_entity.mentioned_obs_count) /
 *     SUM_platforms(platform.total_possible) × 100
 *
 *   Leaderboard brand `citation_rate` (position-weighted):
 *     SUM_window_platforms(brand_entity.position_weighted_citation_count) /
 *     SUM_window_platforms(platform.total_possible) × 100
 *
 *   Leaderboard brand `composite`:
 *     0.5 × brand_mention_rate + 0.5 × brand_pos_weighted_citation_rate
 *
 *   Leaderboard competitor scores (all metrics):
 *     SUM_window_platforms(competitor_entity.mentioned_obs_count) /
 *     SUM_window_platforms(platform.total_possible) × 100
 *
 *   Chart events: live read from url_change_outcomes +
 *   changelog_entries (small, already cached).
 *
 * The loader does NOT touch raw `prompt_answer_observations`. It does
 * NOT touch the legacy obs-compute helpers. It mirrors the
 * `loadCachedFreshCanonical` cache pattern (React.cache) so concurrent
 * Suspense boundaries share one Supabase round-trip per request.
 */

import "server-only";

import { cache } from "react";
import { unstable_cache } from "next/cache";

import {
  ensureCanonicalStoresSeeded,
} from "@/storage/canonical-store";
import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import {
  ensureRecommendationResponsesSeeded,
} from "@/domains/product/recommendation-response-store";
import {
  ensureUrlChangeOutcomesSeeded,
  getUrlChangeOutcomes,
} from "@/domains/attribution/url-change-outcome";
import { getChangelogEntries } from "@/lib/seed-data.server";
import { getBusinessConfig } from "@/lib/business-config";
import { getRepository } from "@/lib/persistence/repositories";
import { entityToScopeId } from "@/domains/daily-metric-snapshots/build-from-observations";
import { makeCompetitorRankingFilter } from "@/domains/recommendations/entity-pollution-filter";
import {
  ALL_TIME_WINDOW as ALL_TIME_WINDOW_SHARED,
  isActiveSnapshotPlatform,
} from "./visibility-read-model-constants";
import type { DailyMetricSnapshot } from "@/domains/daily-metric-snapshots/types";
import type { TrackedEntity } from "@/domains/tracked-entities/types";
import type {
  VisibilityMetric,
  VisibilityPoint,
  EntityVisibility,
} from "@/domains/product/visibility-score";

// Re-export for callers that already import these from this module.
// The canonical definitions live in `visibility-read-model-constants.ts`
// (client-safe) so the chart can share them without dragging server
// imports into the bundle.
export {
  isActiveSnapshotPlatform,
} from "./visibility-read-model-constants";

// ─────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────

/**
 * Freshness status of the snapshot read model.
 *
 *   "fresh"       — Latest active-provider snapshot is from today or
 *                   yesterday UTC. Normal post-poll state.
 *   "stale"       — Latest snapshot is ≥ 2 days old. Cron likely
 *                   missed; operator should investigate.
 *   "rebuilding"  — A native poll is in flight (observation_runs.
 *                   started_at within the last 60 minutes, completed_at
 *                   null). Page should show "Refreshing…" instead of
 *                   stale-tagged data, even if the latest landed
 *                   snapshot is from yesterday.
 *   "empty"       — No active-provider snapshots exist for this tenant.
 *                   First-reading state.
 *
 * The chart + leaderboard still render using whatever data the
 * snapshot read returned — freshness is a label, not a gate.
 */
export type FreshnessStatus = "fresh" | "stale" | "rebuilding" | "empty";

export type VisibilityReadModelFreshness = {
  status: FreshnessStatus;
  /** ISO YYYY-MM-DD UTC of the most recent active-provider snapshot. */
  latestSnapshotDate: string | null;
  /** ISO timestamp of the most recent completed native poll, if known. */
  latestPollCompletedAt: string | null;
  /** Hours between `now` and the most recent signal we have (poll
   *  timestamp if available, else end-of-snapshot-date). */
  ageHours: number | null;
  /** Customer-facing label: "Updated today", "Updated 4h ago",
   *  "Refreshing…", or "No data yet". Pure plain English. */
  label: string;
};

export type VisibilityReadModelData = {
  brandName: string;
  brandSeriesByMetric: Record<VisibilityMetric, VisibilityPoint[]>;
  brandSeriesByPlatform: Record<string, VisibilityPoint[]>;
  leaderboardByMetric: Record<VisibilityMetric, EntityVisibility[]>;
  leaderboardByMetricAndWindow: Record<
    VisibilityMetric,
    Record<number, EntityVisibility[]>
  >;
  chartEndDate: string;
  competitorSeriesByMetric: Record<
    VisibilityMetric,
    Array<{ name: string; points: VisibilityPoint[] }>
  >;
  chartEvents: Array<{
    date: string;
    tone: "danger" | "success" | "neutral";
    label: string;
  }>;
  /** Freshness metadata for the surface label / pill (2026-05-13). */
  freshness: VisibilityReadModelFreshness;
};

/**
 * Cache-tag helper for `unstable_cache` invalidation. Tenant-scoped so
 * an invalidation on tenant A never affects tenant B's cached payload.
 * Mirrors the convention used by `buildRecQueueCacheTag` in
 * `domains/recommendations/load-queue.ts`.
 */
export function buildTodayReadModelCacheTag(tenantId: string): string {
  return `today-readmodel:${tenantId}`;
}

/**
 * Pure helper: compute freshness status + label from the inputs the
 * loader observes (most recent snapshot row date + most recent native
 * poll completion + any in-flight poll runs). Exported for unit testing.
 *
 * Time math is in UTC. `now` defaults to `new Date()` so callers can
 * pin a deterministic clock from tests.
 */
export function computeFreshness(args: {
  latestSnapshotDate: string | null;
  latestPollCompletedAt: string | null;
  inFlightPollStartedAt: string | null;
  now?: Date;
}): VisibilityReadModelFreshness {
  const now = args.now ?? new Date();
  const nowMs = now.getTime();

  // Empty state takes priority — no snapshots at all means nothing
  // can be fresh or stale.
  if (!args.latestSnapshotDate) {
    return {
      status: "empty",
      latestSnapshotDate: null,
      latestPollCompletedAt: null,
      ageHours: null,
      label: "No data yet",
    };
  }

  // Rebuilding state — an in-flight poll started in the last 60 min
  // takes precedence over fresh/stale. The page should communicate
  // "we're refreshing right now" rather than "your data is fresh from
  // yesterday" when a poll is mid-cycle.
  if (args.inFlightPollStartedAt) {
    const startedMs = new Date(args.inFlightPollStartedAt).getTime();
    const minutesSinceStart = (nowMs - startedMs) / 60_000;
    if (minutesSinceStart >= 0 && minutesSinceStart <= 60) {
      return {
        status: "rebuilding",
        latestSnapshotDate: args.latestSnapshotDate,
        latestPollCompletedAt: args.latestPollCompletedAt,
        ageHours: null,
        label: "Refreshing…",
      };
    }
  }

  // Age is computed from the poll completion timestamp when we have
  // it (sub-day precision); otherwise from the end of the snapshot
  // date in UTC.
  const ageMs = args.latestPollCompletedAt
    ? nowMs - new Date(args.latestPollCompletedAt).getTime()
    : nowMs - new Date(`${args.latestSnapshotDate}T23:59:59Z`).getTime();
  const ageHours = Math.max(0, ageMs / 3_600_000);

  // Fresh = snapshot date is today or yesterday UTC. The native cron
  // fires once daily; a one-day lag is the normal state for users
  // opening Today before the morning poll completes.
  const todayUtc = now.toISOString().slice(0, 10);
  const yesterdayUtc = new Date(nowMs - 86_400_000).toISOString().slice(0, 10);
  const isFresh =
    args.latestSnapshotDate === todayUtc ||
    args.latestSnapshotDate === yesterdayUtc;

  if (isFresh) {
    return {
      status: "fresh",
      latestSnapshotDate: args.latestSnapshotDate,
      latestPollCompletedAt: args.latestPollCompletedAt,
      ageHours,
      label: formatFreshLabel(args.latestSnapshotDate, ageHours, todayUtc),
    };
  }

  // Otherwise stale — older than yesterday.
  return {
    status: "stale",
    latestSnapshotDate: args.latestSnapshotDate,
    latestPollCompletedAt: args.latestPollCompletedAt,
    ageHours,
    label: formatStaleLabel(args.latestSnapshotDate, todayUtc),
  };
}

function formatFreshLabel(
  latestSnapshotDate: string,
  ageHours: number,
  todayUtc: string,
): string {
  if (latestSnapshotDate === todayUtc) {
    if (ageHours < 1) return "Updated just now";
    if (ageHours < 24) return `Updated ${Math.floor(ageHours)}h ago`;
    return "Updated today";
  }
  // Snapshot from yesterday.
  return "Updated yesterday";
}

function formatStaleLabel(
  latestSnapshotDate: string,
  todayUtc: string,
): string {
  // Day diff via UTC midnight subtraction — calendar days, not 24h
  // chunks, so "Updated 2 days ago" reads honestly even if the gap is
  // 26 hours.
  const a = new Date(`${latestSnapshotDate}T00:00:00Z`).getTime();
  const b = new Date(`${todayUtc}T00:00:00Z`).getTime();
  const days = Math.max(2, Math.round((b - a) / 86_400_000));
  return `Updated ${days} days ago`;
}

// Constants mirror the existing today-v2-data loader.
const VISIBILITY_METRICS: VisibilityMetric[] = [
  "composite",
  "mention_rate",
  "citation_rate",
];

/** Re-exported from `visibility-read-model-constants.ts` for callers that
 *  already import it from here. The canonical definition is client-safe. */
export const ALL_TIME_WINDOW = ALL_TIME_WINDOW_SHARED;

const LEADERBOARD_WINDOWS: ReadonlyArray<number> = [
  7,
  14,
  30,
  60,
  ALL_TIME_WINDOW_SHARED,
];

/**
 * Max read window from `daily_metric_snapshots` per request. Was 60d
 * pre-All-Time. Bumped to 365d so the "All time" toggle can slice up
 * to a year of history without a second round-trip.
 *
 * Current Ritz row counts: ~110 derived rows/day → ~40k rows over a
 * full year, well within the paginated repo path that already handles
 * ~7k+ rows. If multi-year data accumulates, revisit this cap.
 */
const SNAPSHOT_WINDOW_DAYS = 365;

// ─────────────────────────────────────────────────────────────────────
// Date helpers
// ─────────────────────────────────────────────────────────────────────

function isoDayUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function subtractDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return isoDayUtc(d);
}
function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${end}T00:00:00Z`);
  while (d <= stop) {
    out.push(isoDayUtc(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
function slugifyForCompare(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}
/** Mirrors `minSampledDaysForDelta` in visibility-score.ts:82. */
function minSampledDaysForDelta(windowDays: number): number {
  return Math.max(2, Math.ceil(windowDays / 3));
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot indexing
// ─────────────────────────────────────────────────────────────────────

export type SnapshotIndex = {
  /** date → platform-scope rows (one per platform per date). */
  platformByDate: Map<string, DailyMetricSnapshot[]>;
  /** scope_id → date → entity-scope rows (one per platform per date). */
  entityByIdDate: Map<string, Map<string, DailyMetricSnapshot[]>>;
  /** All distinct dates present in the snapshot window, sorted ascending. */
  sampledDates: string[];
};

/**
 * Exported for unit testing the active-provider scope filter. Production
 * call site is the only runtime caller.
 */
export function indexSnapshots(rows: DailyMetricSnapshot[]): SnapshotIndex {
  const platformByDate = new Map<string, DailyMetricSnapshot[]>();
  const entityByIdDate = new Map<
    string,
    Map<string, DailyMetricSnapshot[]>
  >();
  const dateSet = new Set<string>();
  for (const r of rows) {
    if (r.source_type !== "derived") continue;
    // P0 fix (2026-05-13): drop snapshot rows whose `platform` is not in
    // the current active-provider set. The daily_metric_snapshots table
    // retains historical rows for "Google AI Overviews" from the
    // pre-pivot Profound import era; the native poll pipeline does not
    // refresh them, but they still satisfy the date-range read. Without
    // this filter Today v2 visibility would mix dead Profound metrics
    // into chart + leaderboard. The canonical filter lives in
    // poll-health.ts (`canonicalizePollPlatform`); see
    // `isActiveSnapshotPlatform` above.
    if (!isActiveSnapshotPlatform(r.platform)) continue;
    if (r.scope_type === "platform") {
      const list = platformByDate.get(r.date) ?? [];
      list.push(r);
      platformByDate.set(r.date, list);
      dateSet.add(r.date);
    } else if (r.scope_type === "entity") {
      let dm = entityByIdDate.get(r.scope_id);
      if (!dm) {
        dm = new Map();
        entityByIdDate.set(r.scope_id, dm);
      }
      const list = dm.get(r.date) ?? [];
      list.push(r);
      dm.set(r.date, list);
      dateSet.add(r.date);
    }
  }
  const sampledDates = Array.from(dateSet).sort();
  return { platformByDate, entityByIdDate, sampledDates };
}

// ─────────────────────────────────────────────────────────────────────
// Chart time-series builders (per-day)
// ─────────────────────────────────────────────────────────────────────

/** Brand chart series for one metric. Skips zero-sample dates. */
function buildBrandSeries(
  idx: SnapshotIndex,
  brandScopeId: string,
  metric: VisibilityMetric,
): VisibilityPoint[] {
  const out: VisibilityPoint[] = [];
  for (const date of idx.sampledDates) {
    const platformRows = idx.platformByDate.get(date) ?? [];
    if (platformRows.length === 0) continue;

    let totalObs = 0;
    let totalCitations = 0;
    const perPlatformCiteRates: number[] = [];
    for (const r of platformRows) {
      const total = r.total_possible ?? 0;
      if (total === 0) continue;
      totalObs += total;
      totalCitations += r.citation_count;
      perPlatformCiteRates.push((r.citation_count / total) * 100);
    }
    if (totalObs === 0) continue;

    let totalMentions = 0;
    const brandDateRows = idx.entityByIdDate.get(brandScopeId)?.get(date) ?? [];
    for (const r of brandDateRows) totalMentions += r.mentioned_obs_count ?? 0;

    const mentionRate = (totalMentions / totalObs) * 100;
    const citationRate = (totalCitations / totalObs) * 100;
    const composite =
      perPlatformCiteRates.length > 0
        ? perPlatformCiteRates.reduce((a, b) => a + b, 0) /
          perPlatformCiteRates.length
        : 0;

    const score =
      metric === "mention_rate"
        ? mentionRate
        : metric === "citation_rate"
          ? citationRate
          : composite;
    out.push({ date, score, sampleSize: totalObs });
  }
  return out;
}

/** Per-platform brand series — uses cited_or_mentioned_count to reproduce
 *  the chart's `(citesBrand OR mentionsBrand) / total` formula. */
function buildBrandSeriesByPlatform(
  idx: SnapshotIndex,
): Record<string, VisibilityPoint[]> {
  const byPlatform = new Map<string, VisibilityPoint[]>();
  for (const date of idx.sampledDates) {
    const platformRows = idx.platformByDate.get(date) ?? [];
    for (const r of platformRows) {
      const total = r.total_possible ?? 0;
      if (total === 0) continue;
      const union = r.cited_or_mentioned_count ?? 0;
      const score = (union / total) * 100;
      const series = byPlatform.get(r.platform) ?? [];
      series.push({ date, score, sampleSize: total });
      byPlatform.set(r.platform, series);
    }
  }
  const out: Record<string, VisibilityPoint[]> = {};
  for (const [platform, series] of byPlatform) out[platform] = series;
  return out;
}

/** Series for a single non-owned entity. Chart treats competitor cited ==
 *  mentioned; all three metrics share the same per-day score. */
function buildEntitySeries(
  idx: SnapshotIndex,
  entityScopeId: string,
): VisibilityPoint[] {
  const dateMap = idx.entityByIdDate.get(entityScopeId);
  if (!dateMap) return [];
  const out: VisibilityPoint[] = [];
  for (const date of idx.sampledDates) {
    const platformRows = idx.platformByDate.get(date) ?? [];
    let totalObs = 0;
    for (const r of platformRows) totalObs += r.total_possible ?? 0;
    if (totalObs === 0) continue;

    const entityRows = dateMap.get(date) ?? [];
    let mentioned = 0;
    for (const r of entityRows) mentioned += r.mentioned_obs_count ?? 0;
    const score = (mentioned / totalObs) * 100;
    out.push({ date, score, sampleSize: totalObs });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Leaderboard math
// ─────────────────────────────────────────────────────────────────────

type WindowAggregate = {
  totalObs: number;
  sampledDays: number;
};

function aggregateWindowTotals(
  idx: SnapshotIndex,
  start: string,
  end: string,
): WindowAggregate {
  let totalObs = 0;
  const sampled = new Set<string>();
  for (const date of dateRange(start, end)) {
    const rows = idx.platformByDate.get(date);
    if (!rows) continue;
    let dayTotal = 0;
    for (const r of rows) dayTotal += r.total_possible ?? 0;
    if (dayTotal > 0) {
      totalObs += dayTotal;
      sampled.add(date);
    }
  }
  return { totalObs, sampledDays: sampled.size };
}

function aggregateBrandWindow(
  idx: SnapshotIndex,
  brandScopeId: string,
  start: string,
  end: string,
): { mentionedObs: number; positionWeightedCitations: number } {
  const dateMap = idx.entityByIdDate.get(brandScopeId);
  let mentionedObs = 0;
  let posWeighted = 0;
  if (dateMap) {
    for (const date of dateRange(start, end)) {
      const rows = dateMap.get(date);
      if (!rows) continue;
      for (const r of rows) {
        mentionedObs += r.mentioned_obs_count ?? 0;
        posWeighted += Number(r.position_weighted_citation_count ?? 0);
      }
    }
  }
  return { mentionedObs, positionWeightedCitations: posWeighted };
}

function aggregateCompetitorWindow(
  idx: SnapshotIndex,
  competitorScopeId: string,
  start: string,
  end: string,
): { mentionedObs: number; displayName: string | null } {
  const dateMap = idx.entityByIdDate.get(competitorScopeId);
  if (!dateMap) return { mentionedObs: 0, displayName: null };
  let total = 0;
  let displayName: string | null = null;
  for (const date of dateRange(start, end)) {
    const rows = dateMap.get(date);
    if (!rows) continue;
    for (const r of rows) {
      total += r.mentioned_obs_count ?? 0;
      // Display name from metadata if available; else fall back to
      // tracked-entity name lookup at the caller.
      if (!displayName) {
        const m = r.metadata as
          | { entity_id?: string; display_name?: string }
          | null;
        const ml = m as Record<string, unknown> | null;
        if (ml && typeof ml.display_name === "string") {
          displayName = ml.display_name;
        }
      }
    }
  }
  return { mentionedObs: total, displayName };
}

type EntityWindowScore = {
  scopeId: string;
  name: string;
  isOwned: boolean;
  score: number;
  mentionCount: number;
};

function buildLeaderboardForWindow(
  idx: SnapshotIndex,
  trackedEntities: ReadonlyArray<TrackedEntity>,
  brandScopeId: string,
  brandDisplay: string,
  metric: VisibilityMetric,
  windowEndDate: string,
  windowDays: number,
  limit: number,
): EntityVisibility[] {
  const start = subtractDays(windowEndDate, windowDays - 1);
  const end = windowEndDate;
  const prevEnd = subtractDays(windowEndDate, windowDays);
  const prevStart = subtractDays(windowEndDate, 2 * windowDays - 1);

  const competitorFilter = makeCompetitorRankingFilter(trackedEntities);

  // ── Current window ─────────────────────────────────────────────────
  const totals = aggregateWindowTotals(idx, start, end);
  const prevTotals = aggregateWindowTotals(idx, prevStart, prevEnd);

  // Build display-name lookup for entities. The snapshot rows store
  // scope_id (e.g. "demattei") but the leaderboard renders display names
  // ("De Mattei Construction"). Lookup goes through the tracked-entity
  // registry — for any entity present in `idx` but not in the registry
  // (rare; happens when an entity was removed but its historical rows
  // remain), we fall back to a Title Case slug.
  const displayByScopeId = new Map<string, string>();
  for (const e of trackedEntities) {
    displayByScopeId.set(entityToScopeId(e), e.name);
  }

  // Score brand.
  const brand = aggregateBrandWindow(idx, brandScopeId, start, end);
  const brandPrev = aggregateBrandWindow(idx, brandScopeId, prevStart, prevEnd);
  let brandScore = 0;
  let brandPrevScore = 0;
  if (totals.totalObs > 0) {
    const mentionRate = (brand.mentionedObs / totals.totalObs) * 100;
    const posWeightedCitationRate =
      (brand.positionWeightedCitations / totals.totalObs) * 100;
    brandScore =
      metric === "mention_rate"
        ? mentionRate
        : metric === "citation_rate"
          ? posWeightedCitationRate
          : 0.5 * mentionRate + 0.5 * posWeightedCitationRate;
  }
  if (prevTotals.totalObs > 0) {
    const mr = (brandPrev.mentionedObs / prevTotals.totalObs) * 100;
    const cr =
      (brandPrev.positionWeightedCitations / prevTotals.totalObs) * 100;
    brandPrevScore =
      metric === "mention_rate"
        ? mr
        : metric === "citation_rate"
          ? cr
          : 0.5 * mr + 0.5 * cr;
  }

  const minPrev = minSampledDaysForDelta(windowDays);
  const prevHonest = prevTotals.sampledDays >= minPrev;

  const out: EntityWindowScore[] = [];
  const prevByScopeId = new Map<string, number>();

  if (totals.totalObs > 0) {
    out.push({
      scopeId: brandScopeId,
      name: brandDisplay,
      isOwned: true,
      score: brandScore,
      mentionCount: brand.mentionedObs,
    });
    prevByScopeId.set(brandScopeId, brandPrevScore);
  }

  // Score competitors (every non-owned entity present in idx).
  for (const [scopeId] of idx.entityByIdDate) {
    if (scopeId === brandScopeId) continue;
    const displayName =
      displayByScopeId.get(scopeId) ??
      // Fall back to slug Title Case if no registry entry.
      scopeId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    // Step 1.4 filter — drop directories + obvious generic-noun
    // mentions from competitor rows. Brand row already short-circuited.
    if (!competitorFilter(displayName)) continue;

    const cur = aggregateCompetitorWindow(idx, scopeId, start, end);
    const prev = aggregateCompetitorWindow(idx, scopeId, prevStart, prevEnd);

    // Noise filter — same as obs path: drop competitors with < 3 mentions
    // in the window.
    if (cur.mentionedObs < 3) continue;

    const score =
      totals.totalObs > 0 ? (cur.mentionedObs / totals.totalObs) * 100 : 0;
    const prevScore =
      prevTotals.totalObs > 0
        ? (prev.mentionedObs / prevTotals.totalObs) * 100
        : 0;
    out.push({
      scopeId,
      name: displayName,
      isOwned: false,
      score,
      mentionCount: cur.mentionedObs,
    });
    prevByScopeId.set(scopeId, prevScore);
  }

  out.sort((a, b) => b.score - a.score);

  // Top-N + always-include-brand contract (mirrors visibility-score.ts:469).
  const topN = out.slice(0, limit);
  const brandInTopN = topN.some((e) => e.isOwned);
  if (!brandInTopN) {
    const brandIdx = out.findIndex((e) => e.isOwned);
    if (brandIdx >= 0) {
      const brandRow = out[brandIdx];
      const brandRank = brandIdx + 1;
      topN.push({ ...brandRow, score: brandRow.score });
      return formatLeaderboard(topN, prevByScopeId, prevHonest, windowDays, totals.sampledDays, prevTotals.sampledDays, brandInTopN, brandRank);
    }
  }
  return formatLeaderboard(topN, prevByScopeId, prevHonest, windowDays, totals.sampledDays, prevTotals.sampledDays, brandInTopN, null);
}

function formatLeaderboard(
  rows: EntityWindowScore[],
  prevByScopeId: Map<string, number>,
  prevHonest: boolean,
  windowDays: number,
  curSampledDays: number,
  prevSampledDays: number,
  brandInTopN: boolean,
  appendedBrandRank: number | null,
): EntityVisibility[] {
  return rows.map((row, i) => {
    const prevScore = prevByScopeId.get(row.scopeId);
    const delta =
      prevHonest && prevScore !== undefined ? row.score - prevScore : null;
    // Rank — mirrors visibility-score.ts:484 — appended brand keeps its
    // real rank; others get sorted-position rank.
    let displayRank: number;
    if (brandInTopN) {
      displayRank = i + 1;
    } else if (row.isOwned && i === rows.length - 1) {
      displayRank = appendedBrandRank ?? i + 1;
    } else {
      displayRank = i + 1;
    }
    return {
      name: row.name,
      slug: slugifyForCompare(row.name),
      isOwned: row.isOwned,
      rank: displayRank,
      score: row.score,
      delta,
      deltaWindowDays: windowDays,
      currentSampledDays: curSampledDays,
      previousSampledDays: prevSampledDays,
      mentionCount: row.mentionCount,
    };
  });
}

// ─────────────────────────────────────────────────────────────────────
// Chart events overlay (live read — small, already cached)
// ─────────────────────────────────────────────────────────────────────

async function buildChartEvents(): Promise<
  Array<{ date: string; tone: "danger" | "success" | "neutral"; label: string }>
> {
  try {
    const [urlChangeOutcomes, changelogEntries] = await Promise.all([
      getUrlChangeOutcomes(),
      getChangelogEntries(),
    ]);
    const changeById = new Map(changelogEntries.map((c) => [c.id, c]));
    const latestVerdictByUrl = new Map<
      string,
      { verdict: string; updatedAt: string }
    >();
    for (const o of urlChangeOutcomes) {
      const existing = latestVerdictByUrl.get(o.url);
      if (!existing || o.updated_at > existing.updatedAt) {
        latestVerdictByUrl.set(o.url, {
          verdict: o.verdict,
          updatedAt: o.updated_at,
        });
      }
    }
    const events: Array<{
      date: string;
      tone: "danger" | "success" | "neutral";
      label: string;
    }> = [];
    const seen = new Set<string>();
    // Hurting dots
    for (const o of urlChangeOutcomes) {
      if (o.verdict !== "hurting") continue;
      const latest = latestVerdictByUrl.get(o.url);
      if (latest?.verdict !== "hurting") continue;
      const change = changeById.get(o.change_id);
      const date = change?.timestamp?.slice(0, 10);
      if (!date) continue;
      const key = `hurt:${date}`;
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
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
      if (seen.has(key)) continue;
      seen.add(key);
      events.push({
        date,
        tone: "success",
        label: `${url} — citation lift detected after change on ${date}`,
      });
    }
    return events;
  } catch (err) {
    console.error("[visibility-read-model] chartEvents build failed:", err);
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────
// Observation-run freshness query
// ─────────────────────────────────────────────────────────────────────

/**
 * Fetch the two pieces the freshness compute needs from
 * `observation_runs`: the most recent COMPLETED native poll's
 * `completed_at`, and any IN-FLIGHT native poll's `started_at` from
 * the last hour. Tenant-scoped. Tiny query (LIMIT 5) — runs in
 * parallel with the main snapshot read.
 */
async function fetchFreshnessSignal(tenantId: string): Promise<{
  latestPollCompletedAt: string | null;
  inFlightPollStartedAt: string | null;
}> {
  try {
    const sb = getSupabaseAdmin();
    const oneHourAgo = new Date(Date.now() - 60 * 60_000).toISOString();
    const { data, error } = await sb
      .from("observation_runs")
      .select("source, status, started_at, completed_at")
      .eq("tenant_id", tenantId)
      .in("source", ["perplexity-native-poll", "openai-native-poll"])
      .gte("started_at", oneHourAgo)
      .order("started_at", { ascending: false })
      .limit(20);
    let inFlight: string | null = null;
    let latestCompleted: string | null = null;
    if (!error) {
      for (const row of (data ?? []) as Array<{
        status: string;
        started_at: string;
        completed_at: string | null;
      }>) {
        if (!row.completed_at && inFlight === null) {
          inFlight = row.started_at;
        }
      }
    }
    // Fetch the latest completed poll separately (not bounded to last
    // hour — we want the timestamp even when the last poll was
    // yesterday).
    const completedRes = await sb
      .from("observation_runs")
      .select("completed_at")
      .eq("tenant_id", tenantId)
      .in("source", ["perplexity-native-poll", "openai-native-poll"])
      .eq("status", "completed")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1);
    if (!completedRes.error && completedRes.data && completedRes.data[0]) {
      latestCompleted =
        (completedRes.data[0] as { completed_at: string }).completed_at;
    }
    return {
      latestPollCompletedAt: latestCompleted,
      inFlightPollStartedAt: inFlight,
    };
  } catch (err) {
    console.error(
      "[visibility-read-model] freshness signal fetch failed:",
      err,
    );
    return { latestPollCompletedAt: null, inFlightPollStartedAt: null };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Main loader
// ─────────────────────────────────────────────────────────────────────

async function loadVisibilityReadModelInner(opts: {
  tenantId: string;
  endDate: string;
}): Promise<VisibilityReadModelData> {
  // Side-effecting seeds — match the loadCachedFreshCanonical pattern.
  // These were previously seeded by the canonical loader; the snapshot
  // path replaces the canonical pull but the seeds are still needed
  // because chartEvents reads from url_change_outcomes (seeded) and
  // recommendation_responses store (seeded).
  await Promise.all([
    ensureRecommendationResponsesSeeded(),
    ensureUrlChangeOutcomesSeeded(),
    ensureCanonicalStoresSeeded(),
  ]);

  const businessConfig = getBusinessConfig();
  const { tenantId, endDate } = opts;
  const sinceDate = subtractDays(endDate, SNAPSHOT_WINDOW_DAYS - 1);

  const repo = getRepository().forTenant(tenantId);

  // Parallel reads — snapshots + tracked entities + chart events +
  // freshness signal (recent observation_runs for in-flight / last-
  // completed timestamps).
  const [snapshots, trackedEntities, chartEvents, freshnessSignal] =
    await Promise.all([
      repo.getDailyMetricSnapshots({ since: sinceDate }),
      repo.getTrackedEntities(),
      buildChartEvents(),
      fetchFreshnessSignal(tenantId),
    ]);

  // Clip to the window end (the repo's `since` filter covers the lower
  // bound; we still trim above for safety + idempotency).
  const inWindow = snapshots.filter((s) => s.date <= endDate);
  const idx = indexSnapshots(inWindow);

  const brandEntity = trackedEntities.find((e) => e.is_owned);
  const brandScopeId = brandEntity ? entityToScopeId(brandEntity) : "";
  const brandDisplay = brandEntity?.name ?? businessConfig.name ?? "You";

  // ── Brand chart series for each metric ─────────────────────────
  const brandSeriesByMetric = {} as Record<
    VisibilityMetric,
    VisibilityPoint[]
  >;
  for (const m of VISIBILITY_METRICS) {
    brandSeriesByMetric[m] = buildBrandSeries(idx, brandScopeId, m);
  }

  // ── Per-platform brand series ──────────────────────────────────
  const brandSeriesByPlatform = buildBrandSeriesByPlatform(idx);

  // ── Leaderboards (all metrics × all windows + 14d default) ─────
  const leaderboardByMetricAndWindow = {} as Record<
    VisibilityMetric,
    Record<number, EntityVisibility[]>
  >;
  for (const m of VISIBILITY_METRICS) {
    leaderboardByMetricAndWindow[m] = {} as Record<
      number,
      EntityVisibility[]
    >;
    for (const windowDays of LEADERBOARD_WINDOWS) {
      leaderboardByMetricAndWindow[m][windowDays] = buildLeaderboardForWindow(
        idx,
        trackedEntities,
        brandScopeId,
        brandDisplay,
        m,
        endDate,
        windowDays,
        5,
      );
    }
  }
  const leaderboardByMetric = {} as Record<VisibilityMetric, EntityVisibility[]>;
  for (const m of VISIBILITY_METRICS) {
    leaderboardByMetric[m] = leaderboardByMetricAndWindow[m][14];
  }

  // ── Competitor series (top 4 from composite 14d leaderboard) ───
  const topCompetitorRows = leaderboardByMetric.composite
    .filter((r) => !r.isOwned)
    .slice(0, 4);
  const competitorSeriesByMetric = {} as Record<
    VisibilityMetric,
    Array<{ name: string; points: VisibilityPoint[] }>
  >;
  const scopeIdByName = new Map<string, string>();
  for (const e of trackedEntities) {
    scopeIdByName.set(e.name, entityToScopeId(e));
  }
  for (const m of VISIBILITY_METRICS) {
    const series: Array<{ name: string; points: VisibilityPoint[] }> = [];
    for (const row of topCompetitorRows) {
      const scopeId = scopeIdByName.get(row.name);
      if (!scopeId) continue;
      const points = buildEntitySeries(idx, scopeId);
      series.push({ name: row.name, points });
    }
    competitorSeriesByMetric[m] = series;
  }

  // ── Freshness ──────────────────────────────────────────────────
  // Latest snapshot date is the most recent date that has a
  // platform-scope row in the active-provider set (already filtered
  // by indexSnapshots). Empty if there are none.
  const latestSnapshotDate =
    idx.sampledDates.length > 0
      ? idx.sampledDates[idx.sampledDates.length - 1]
      : null;
  const freshness = computeFreshness({
    latestSnapshotDate,
    latestPollCompletedAt: freshnessSignal.latestPollCompletedAt,
    inFlightPollStartedAt: freshnessSignal.inFlightPollStartedAt,
  });

  return {
    brandName: brandDisplay,
    brandSeriesByMetric,
    brandSeriesByPlatform,
    leaderboardByMetric,
    leaderboardByMetricAndWindow,
    chartEndDate: endDate,
    competitorSeriesByMetric,
    chartEvents,
    freshness,
  };
}

/**
 * Cross-request cache TTL for the Today read model. Long enough that
 * sequential page loads share one Supabase trip; short enough that an
 * accidentally-missed `revalidateTag` self-heals within minutes
 * instead of waiting until the next poll. The post-`syncSnaps`
 * invalidation in `run-poll.ts` is the primary freshness path; this
 * TTL is the safety net.
 */
const TODAY_READMODEL_CACHE_TTL_SECONDS = 300;

/**
 * Two-layer cache:
 *   • `react.cache` — per-request memoization (same Suspense
 *     boundary, same request → one shared Promise).
 *   • `unstable_cache` — cross-request caching with explicit
 *     tag-based invalidation. The cache key includes `tenantId` +
 *     `endDate` so distinct tenants / preview-mode "endDate"
 *     overrides each get their own slot. The tag is tenant-scoped
 *     (`today-readmodel:<tenantId>`) so a poll that lands for one
 *     tenant invalidates only that tenant's cached payload.
 *
 * Always passes a 60-day window — that's the longest leaderboard
 * window; any shorter view slices into the same array.
 */
export const loadVisibilityReadModelFromSnapshots = cache(
  async (opts?: {
    tenantId?: string;
    endDate?: string;
  }): Promise<VisibilityReadModelData> => {
    const tenantId =
      opts?.tenantId ??
      (await (await import("@/lib/tenant-context")).currentTenantId());
    const endDate = opts?.endDate ?? isoDayUtc(new Date());

    const cached = unstable_cache(
      () => loadVisibilityReadModelInner({ tenantId, endDate }),
      ["today-readmodel:v1", tenantId, endDate],
      {
        revalidate: TODAY_READMODEL_CACHE_TTL_SECONDS,
        tags: [buildTodayReadModelCacheTag(tenantId)],
      },
    );
    return cached();
  },
);
