/**
 * intent-clusters-loader.ts (2026-07-02, BEACON_500 item N7) - the I/O
 * boundary for intent-clusters.ts. Reads ONLY already-stored
 * `dataforseo_serp_history` rows ($0 marginal cost - the SERP calls that
 * wrote them were already paid for elsewhere); this loader spends NOTHING
 * and never calls DataForSEO itself.
 *
 * Kept in its own file (not inside serp-history.ts, per this slice's
 * ownership boundary) so intent-clusters.ts stays a pure, dependency-free
 * module callers can unit test with zero mocking.
 *
 * QUERY UNIVERSE: the tenant's tracked queries come from the SAME GSC
 * page-signal map the other trigger predicates already load
 * (`gsc-page-signals.ts::loadGscPageSignalsForTenant` -> `topQueries` per
 * page) - this loader takes that map as an input rather than re-deriving
 * it, so the wiring file loads GSC exactly once per run. Coverage is
 * reported against that same universe.
 */

import "server-only";

import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/persistence/supabase";
import type { SerpOrganicItem } from "./dataforseo-serp";
import {
  computeIntentClusters,
  type IntentClusterResult,
  type QuerySerpSnapshot,
} from "./intent-clusters";
import type { GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";

/** Bound how many distinct queries one run clusters over - a diagnostic
 *  read, not an unbounded table scan. Mirrors the AI-Overview / feature-steal
 *  reader row caps in serp-history.ts. */
const MAX_TRACKED_QUERIES = 300;
/** Bound how many history rows one run reads - comfortably covers
 *  MAX_TRACKED_QUERIES queries even with several captures each. */
const ROW_LIMIT = 3_000;

/** Every distinct query worth clustering: the top GSC queries across every
 *  page this tenant has signal for, deduped, capped. Pure reduction over an
 *  already-loaded map - no I/O here. */
export function trackedQueriesFromGscSignals(
  gscSignals: ReadonlyMap<string, GscPageSignal>,
  maxQueries: number = MAX_TRACKED_QUERIES,
): string[] {
  const seen = new Set<string>();
  for (const signal of gscSignals.values()) {
    for (const q of signal.topQueries ?? []) {
      const norm = q.query.trim().toLowerCase();
      if (norm) seen.add(norm);
      if (seen.size >= maxQueries) return [...seen];
    }
  }
  return [...seen];
}

/**
 * Read the latest `dataforseo_serp_history` row per query for this tenant,
 * restricted to `queries`. Fail-soft: no table / no env / any Supabase error
 * -> empty array (the caller's coverage math then honestly reports every
 * query as missing, never guesses a cluster from absent data).
 */
export async function loadSerpSnapshotsForQueries(
  tenantId: string,
  queries: ReadonlyArray<string>,
): Promise<QuerySerpSnapshot[]> {
  const normQueries = [...new Set(queries.map((q) => q.trim().toLowerCase()).filter((q) => q.length > 0))];
  if (!tenantId || normQueries.length === 0 || !isSupabaseConfigured()) return [];
  try {
    const { data, error } = await getSupabaseAdmin()
      .from("dataforseo_serp_history")
      .select("query, captured_at, top_domains")
      .eq("tenant_id", tenantId)
      .in("query", normQueries)
      .order("captured_at", { ascending: false })
      .limit(ROW_LIMIT);
    if (error || !Array.isArray(data)) return [];
    return (
      data as Array<{ query: string; captured_at: string; top_domains: SerpOrganicItem[] | null }>
    ).map((r) => ({
      query: r.query,
      capturedAt: r.captured_at,
      topResults: Array.isArray(r.top_domains) ? r.top_domains : [],
    }));
  } catch {
    return [];
  }
}

/**
 * Compute intent clusters for a tenant end to end: derive the tracked-query
 * universe from the already-loaded GSC signal map, read whatever SERP
 * history already exists for those queries ($0, no new paid pulls), and
 * reduce to clusters. Fails soft to an empty-clusters, zero-coverage result
 * on any error - never throws into the trigger loader.
 */
export async function loadIntentClustersForTenant(input: {
  tenantId: string;
  gscSignals: ReadonlyMap<string, GscPageSignal>;
  ownDomain: string | null;
}): Promise<IntentClusterResult> {
  const { tenantId, gscSignals, ownDomain } = input;
  try {
    const trackedQueries = trackedQueriesFromGscSignals(gscSignals);
    if (trackedQueries.length === 0) {
      return {
        clusters: [],
        coverage: { totalQueries: 0, queriesWithSerpData: 0, queriesMissingSerpData: [], coverageRatio: 0 },
      };
    }
    const snapshots = await loadSerpSnapshotsForQueries(tenantId, trackedQueries);
    return computeIntentClusters({ trackedQueries, snapshots, ownDomain });
  } catch {
    return {
      clusters: [],
      coverage: { totalQueries: 0, queriesWithSerpData: 0, queriesMissingSerpData: [], coverageRatio: 0 },
    };
  }
}
