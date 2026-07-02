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
