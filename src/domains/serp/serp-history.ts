/**
 * serp-history (2026-07-02, BEACON_500 item 17) - the $0 reader over the append-only
 * dataforseo_serp_history table. Every OK live SERP read appends one row there (see
 * dataforseo-serp.ts); this module turns those rows into the literal observed Google
 * position over time: the series, the latest own rank, and the "you moved 9 to 6"
 * delta inside a window.
 *
 * Posture: read-only, fail-soft (no table / no env / any error -> empty), react
 * cache()-d per (tenantId, query) so a render tree asking for the same series many
 * times costs ONE round-trip. The delta/latest math is exported as pure functions
 * so tests never need a database.
 */

import "server-only";

import { cache } from "react";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import { currentTenant } from "@/lib/tenant-context";
import type { AiOverviewCitedDomain, ParsedFeaturedSnippet, ParsedPaaQuestion, SerpOrganicItem } from "./dataforseo-serp";
import { computeAiOverviewGaps, aiOverviewGapHeadline, type AiOverviewHistoryRow } from "./ai-overview-gaps";
import { computeFeatureSteals, type FeatureStealCandidate, type FeatureStealHistoryRow } from "./feature-steal";
import { computeBrokenCompetitors, type BrokenCompetitorFinding, type BrokenCompetitorHistoryRow } from "./broken-competitor";
import { computeSerpFeatureChanges, type SerpFeatureChange, type SerpFeatureHistoryRow } from "./serp-feature-change";

/** One observed point: when we looked, and where the tenant's own domain sat. */
export type SerpRankPoint = {
  capturedAt: string;
  /** 1-based own position in that snapshot's organic results, null = not in top results. */
  ownRank: number | null;
  ownUrl: string | null;
};

/** A real observed movement between two snapshots (never fabricated). */
export type SerpRankDelta = {
  fromRank: number;
  toRank: number;
  fromAt: string;
  toAt: string;
  direction: "up" | "down" | "flat";
};

const normQuery = (q: string) => q.trim().toLowerCase();

const SERIES_LIMIT = 90;

/**
 * The observed rank series for one query, oldest first. Empty when history has
 * nothing yet (honest silence), the table is missing, or Supabase is unreachable.
 */
export const rankSeriesFor = cache(async (tenantId: string, query: string): Promise<SerpRankPoint[]> => {
  const q = normQuery(query);
  if (!tenantId || !q || !isSupabaseConfigured()) return [];
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("dataforseo_serp_history")
      .select("captured_at, own_rank, own_url")
      .eq("tenant_id", tenantId)
      .eq("query", q)
      .order("captured_at", { ascending: true })
      .limit(SERIES_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return (data as Array<{ captured_at: string; own_rank: number | null; own_url: string | null }>).map((r) => ({
      capturedAt: r.captured_at,
      ownRank: typeof r.own_rank === "number" ? r.own_rank : null,
      ownUrl: r.own_url ?? null,
    }));
  } catch {
    return [];
  }
});

/** PURE: the most recent point where the tenant actually appeared, or null. */
export function pickLatestOwnRank(points: SerpRankPoint[]): { rank: number; url: string | null; capturedAt: string } | null {
  for (let i = points.length - 1; i >= 0; i -= 1) {
    const p = points[i];
    if (typeof p.ownRank === "number") return { rank: p.ownRank, url: p.ownUrl, capturedAt: p.capturedAt };
  }
  return null;
}

/**
 * PURE: the observed movement inside the window. Needs at least TWO snapshots in
 * the window where the tenant's own rank was actually observed - otherwise null
 * (honest silence, never inferred from one point or from absence).
 */
export function computeRankDelta(points: SerpRankPoint[], sinceDays: number, now: Date = new Date()): SerpRankDelta | null {
  const cutoffMs = now.getTime() - sinceDays * 24 * 60 * 60 * 1000;
  const usable = points
    .filter((p) => typeof p.ownRank === "number" && Date.parse(p.capturedAt) >= cutoffMs && Date.parse(p.capturedAt) <= now.getTime())
    .sort((a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt));
  if (usable.length < 2) return null;
  const from = usable[0];
  const to = usable[usable.length - 1];
  const fromRank = from.ownRank as number;
  const toRank = to.ownRank as number;
  return {
    fromRank,
    toRank,
    fromAt: from.capturedAt,
    toAt: to.capturedAt,
    // Lower rank number = higher on Google.
    direction: toRank < fromRank ? "up" : toRank > fromRank ? "down" : "flat",
  };
}

/** The latest literal observed Google position for this query, or null. Cached. */
export const latestOwnRank = cache(
  async (tenantId: string, query: string): Promise<{ rank: number; url: string | null; capturedAt: string } | null> => {
    return pickLatestOwnRank(await rankSeriesFor(tenantId, query));
  },
);

/** The observed movement for this query inside the last `sinceDays` days, or null. Cached. */
export const rankDelta = cache(
  async (tenantId: string, query: string, sinceDays: number, now: Date = new Date()): Promise<SerpRankDelta | null> => {
    return computeRankDelta(await rankSeriesFor(tenantId, query), sinceDays, now);
  },
);

// ─── AI Overview history reads (item 20) ────────────────────────────────────

/** Bound how far back the tenant-wide AI-Overview scan looks and how many
 *  rows it can return - a diagnostic read, not an unbounded table scan. */
const AI_OVERVIEW_LOOKBACK_DAYS = 90;
const AI_OVERVIEW_ROW_LIMIT = 500;

/**
 * Every history row for this tenant across ALL tracked queries, in the fields
 * ai-overview-gaps.ts needs to compute per-query verdicts and lost/gained
 * transitions. Empty when history has nothing yet, the table/columns are
 * missing (pre-migration), or Supabase is unreachable - never throws.
 */
export const aiOverviewHistoryRows = cache(async (tenantId: string, now: Date = new Date()): Promise<AiOverviewHistoryRow[]> => {
  if (!tenantId || !isSupabaseConfigured()) return [];
  try {
    const cutoffIso = new Date(now.getTime() - AI_OVERVIEW_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabaseAdmin()
      .from("dataforseo_serp_history")
      .select("query, captured_at, own_rank, ai_overview_present, ai_overview_domains")
      .eq("tenant_id", tenantId)
      .gte("captured_at", cutoffIso)
      .order("captured_at", { ascending: true })
      .limit(AI_OVERVIEW_ROW_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return (
      data as Array<{
        query: string;
        captured_at: string;
        own_rank: number | null;
        ai_overview_present: boolean | null;
        ai_overview_domains: AiOverviewCitedDomain[] | null;
      }>
    ).map((r) => ({
      query: r.query,
      capturedAt: r.captured_at,
      ownRank: typeof r.own_rank === "number" ? r.own_rank : null,
      aiOverviewPresent: r.ai_overview_present === true,
      aiOverviewDomains: Array.isArray(r.ai_overview_domains) ? r.ai_overview_domains : [],
    }));
  } catch {
    return [];
  }
});

/** $0 read for the Today AI band: one honest AI-Overview-citation-gap line,
 *  or null when there is no history yet, the tenant domain is unknown, or no
 *  real gap exists. Fails soft on any error - never throws into a render. */
export const loadAiOverviewGapTodayLine = cache(async (tenantId: string, now: Date = new Date()): Promise<string | null> => {
  try {
    const rows = await aiOverviewHistoryRows(tenantId, now);
    if (rows.length === 0) return null;
    const domain = await currentTenant()
      .then((t) => t.domain ?? null)
      .catch(() => null);
    if (!domain) return null;
    return aiOverviewGapHeadline(computeAiOverviewGaps(rows, domain));
  } catch {
    return null;
  }
});

// ─── Featured snippet + PAA steal reads (item 25) ───────────────────────────

/** Bound how far back the tenant-wide snippet/PAA scan looks and how many rows
 *  it can return - a diagnostic read, not an unbounded table scan. Mirrors the
 *  AI Overview reader's bounds. */
const FEATURE_STEAL_LOOKBACK_DAYS = 90;
const FEATURE_STEAL_ROW_LIMIT = 500;

/**
 * Every history row for this tenant across all tracked queries, in the fields
 * feature-steal.ts needs to compute per-query steal candidates. Empty when
 * history has nothing yet, the columns are missing (pre-migration), or Supabase
 * is unreachable - never throws.
 */
export const featureStealHistoryRows = cache(async (tenantId: string, now: Date = new Date()): Promise<FeatureStealHistoryRow[]> => {
  if (!tenantId || !isSupabaseConfigured()) return [];
  try {
    const cutoffIso = new Date(now.getTime() - FEATURE_STEAL_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabaseAdmin()
      .from("dataforseo_serp_history")
      .select("query, captured_at, own_rank, own_url, snippet_owner, paa_questions")
      .eq("tenant_id", tenantId)
      .gte("captured_at", cutoffIso)
      .order("captured_at", { ascending: true })
      .limit(FEATURE_STEAL_ROW_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return (
      data as Array<{
        query: string;
        captured_at: string;
        own_rank: number | null;
        own_url: string | null;
        snippet_owner: ParsedFeaturedSnippet | null;
        paa_questions: ParsedPaaQuestion[] | null;
      }>
    ).map((r) => ({
      query: r.query,
      capturedAt: r.captured_at,
      ownRank: typeof r.own_rank === "number" ? r.own_rank : null,
      ownUrl: r.own_url ?? null,
      snippetOwner: r.snippet_owner ?? null,
      paaQuestions: Array.isArray(r.paa_questions) ? r.paa_questions : [],
    }));
  } catch {
    return [];
  }
});

/** $0 read: every real feature-steal candidate (snippet or PAA) for this tenant
 *  across its tracked queries, [] when there is no history yet, the tenant
 *  domain is unknown, or nothing qualifies. Fails soft on any error. */
export const loadFeatureStealCandidates = cache(async (tenantId: string, now: Date = new Date()): Promise<FeatureStealCandidate[]> => {
  try {
    const rows = await featureStealHistoryRows(tenantId, now);
    if (rows.length === 0) return [];
    const domain = await currentTenant()
      .then((t) => t.domain ?? null)
      .catch(() => null);
    if (!domain) return [];
    return computeFeatureSteals(rows, domain);
  } catch {
    return [];
  }
});

// ─── Own-rank + competitor-owner reads (Keywords library, UX2) ─────────────

/** One query's most recent Google reading: the tenant's own observed rank and
 *  the top domains Google showed at capture time (rank order). */
export type QueryLatestSerpReading = {
  query: string;
  capturedAt: string;
  ownRank: number | null;
  topDomains: SerpOrganicItem[];
};

/** Bound how far back the tenant-wide latest-reading scan looks and how many
 *  rows it can return — a diagnostic read, not an unbounded table scan. */
const LATEST_READING_LOOKBACK_DAYS = 90;
const LATEST_READING_ROW_LIMIT = 1500;

/**
 * The MOST RECENT live Google reading for every query this tenant has ever
 * checked with a live SERP call, keyed by query. Powers the Keywords library's
 * "your position" cross-check and "who else owns this" column with a real
 * observed reading (never a guess) — $0, one bounded read over the append-only
 * history table. Fail-soft → empty map (no history yet, table missing, or
 * Supabase unreachable never throws into a render).
 */
export const loadLatestSerpReadingsByQuery = cache(async (tenantId: string, now: Date = new Date()): Promise<Map<string, QueryLatestSerpReading>> => {
  const out = new Map<string, QueryLatestSerpReading>();
  if (!tenantId || !isSupabaseConfigured()) return out;
  try {
    const cutoffIso = new Date(now.getTime() - LATEST_READING_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await getSupabaseAdmin()
      .from("dataforseo_serp_history")
      .select("query, captured_at, own_rank, top_domains")
      .eq("tenant_id", tenantId)
      .gte("captured_at", cutoffIso)
      .order("captured_at", { ascending: true }) // ascending so the last write per query wins below
      .limit(LATEST_READING_ROW_LIMIT);
    if (error || !Array.isArray(data)) return out;
    for (const r of data as Array<{ query: string; captured_at: string; own_rank: number | null; top_domains: SerpOrganicItem[] | null }>) {
      const query = (r.query ?? "").trim();
      if (!query) continue;
      out.set(query, {
        query,
        capturedAt: r.captured_at,
        ownRank: typeof r.own_rank === "number" ? r.own_rank : null,
        topDomains: Array.isArray(r.top_domains) ? r.top_domains : [],
      });
    }
    return out;
  } catch {
    return out;
  }
});

// ─── Broken-competitor + Google-results feature-change reads (P9) ────────────
//
// Both diff the SAME already-persisted dataforseo_serp_history rows at $0 (no
// new paid pull) and both fail soft to empty. Kept here (the SERP-history I/O
// boundary) so the pure detectors (broken-competitor.ts / serp-feature-change.ts)
// stay dependency-free and unit-testable with zero mocking.

/** Bound how far back the tenant-wide broken-competitor / feature-change scan
 *  looks and how many rows it can return - a diagnostic read, not an unbounded
 *  table scan. Mirrors the AI-Overview / feature-steal reader bounds above; the
 *  row limit comfortably covers many queries with several captures each. */
const COMPETITOR_WATCH_LOOKBACK_DAYS = 45;
const COMPETITOR_WATCH_ROW_LIMIT = 3_000;

/**
 * Every history row for this tenant across all tracked queries, in the fields
 * broken-competitor.ts AND serp-feature-change.ts need (both diff the same
 * columns). ONE bounded read shared by both P9 loaders below. Empty when
 * history has nothing yet, the table is missing, or Supabase is unreachable -
 * never throws.
 */
const competitorWatchHistoryRows = cache(
  async (
    tenantId: string,
    now: Date = new Date(),
  ): Promise<
    Array<{
      query: string;
      capturedAt: string;
      ownRank: number | null;
      topDomains: SerpOrganicItem[];
      serpFeatures: string[];
      aiOverviewPresent: boolean;
      snippetOwner: ParsedFeaturedSnippet | null;
      paaQuestions: ParsedPaaQuestion[];
    }>
  > => {
    if (!tenantId || !isSupabaseConfigured()) return [];
    try {
      const cutoffIso = new Date(now.getTime() - COMPETITOR_WATCH_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
      const { data, error } = await getSupabaseAdmin()
        .from("dataforseo_serp_history")
        .select("query, captured_at, own_rank, top_domains, serp_features, ai_overview_present, snippet_owner, paa_questions")
        .eq("tenant_id", tenantId)
        .gte("captured_at", cutoffIso)
        .order("captured_at", { ascending: true })
        .limit(COMPETITOR_WATCH_ROW_LIMIT);
      if (error || !Array.isArray(data)) return [];
      return (
        data as Array<{
          query: string;
          captured_at: string;
          own_rank: number | null;
          top_domains: SerpOrganicItem[] | null;
          serp_features: string[] | null;
          ai_overview_present: boolean | null;
          snippet_owner: ParsedFeaturedSnippet | null;
          paa_questions: ParsedPaaQuestion[] | null;
        }>
      ).map((r) => ({
        query: (r.query ?? "").trim(),
        capturedAt: r.captured_at,
        ownRank: typeof r.own_rank === "number" ? r.own_rank : null,
        topDomains: Array.isArray(r.top_domains) ? r.top_domains : [],
        serpFeatures: Array.isArray(r.serp_features) ? r.serp_features : [],
        aiOverviewPresent: r.ai_overview_present === true,
        snippetOwner: r.snippet_owner ?? null,
        paaQuestions: Array.isArray(r.paa_questions) ? r.paa_questions : [],
      }));
    } catch {
      return [];
    }
  },
);

/**
 * $0 read: every real broken-competitor opening for this tenant across its
 * tracked queries (a rival that held a top spot in an earlier capture and is
 * gone from the latest). [] when there is no diff-able history yet, the tenant
 * domain is unknown, or nothing dropped. Fails soft on any error - never throws.
 */
export const loadBrokenCompetitorFindings = cache(
  async (tenantId: string, now: Date = new Date()): Promise<BrokenCompetitorFinding[]> => {
    try {
      const rows = await competitorWatchHistoryRows(tenantId, now);
      if (rows.length === 0) return [];
      const domain = await currentTenant()
        .then((t) => t.domain ?? null)
        .catch(() => null);
      const detectorRows: BrokenCompetitorHistoryRow[] = rows.map((r) => ({
        query: r.query,
        capturedAt: r.capturedAt,
        ownRank: r.ownRank,
        topDomains: r.topDomains,
      }));
      return computeBrokenCompetitors(detectorRows, domain, { now });
    } catch {
      return [];
    }
  },
);

/**
 * $0 read: every real Google-results feature appear/disappear change for this
 * tenant across its tracked queries. [] when there is no diff-able history yet
 * or nothing changed. Fails soft on any error - never throws.
 */
export const loadSerpFeatureChanges = cache(
  async (tenantId: string, now: Date = new Date()): Promise<SerpFeatureChange[]> => {
    try {
      const rows = await competitorWatchHistoryRows(tenantId, now);
      if (rows.length === 0) return [];
      const detectorRows: SerpFeatureHistoryRow[] = rows.map((r) => ({
        query: r.query,
        capturedAt: r.capturedAt,
        ownRank: r.ownRank,
        serpFeatures: r.serpFeatures,
        aiOverviewPresent: r.aiOverviewPresent,
        snippetOwner: r.snippetOwner,
        paaQuestions: r.paaQuestions,
      }));
      return computeSerpFeatureChanges(detectorRows, { now });
    } catch {
      return [];
    }
  },
);
