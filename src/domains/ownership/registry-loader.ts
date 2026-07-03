/**
 * registry-loader.ts (2026-07-02, BEACON_500 item N2) - the I/O boundary for
 * registry.ts. Reads the SAME two already-built, already-paid-for sources the
 * app already computes elsewhere and reduces them into one OwnershipRegistry:
 *
 *   1. gsc-cannibalization.ts's `gsc_cannibalization_v1` RPC - per-query,
 *      per-owned-URL impressions/position, straight from Google's own crawl
 *      (the `gsc_ranks` basis - the strongest, most current signal).
 *   2. intent-clusters-loader.ts's SERP-overlap clusters, built from already-
 *      stored `dataforseo_serp_history` rows (the `serp_cluster` basis - fills
 *      in queries gsc_ranks did not resolve, e.g. new pages with little GSC
 *      history yet but a captured SERP).
 *
 * Both reads are the exact loaders other engines already call (gsc-
 * cannibalization.ts is read by the opportunity map + today-moves-data.ts;
 * intent-clusters-loader.ts is read by the trigger loader for N7) - this
 * module spends NOTHING new. Cached per-request via React `cache()`, the same
 * convention `loadDemandGraphForTenantCached` and the other per-tenant loaders
 * in this codebase use, so a page that resolves ownership for many queries in
 * one render only pays for the two underlying reads once.
 *
 * Fail-soft throughout: any failure narrows the registry (fewer resolved
 * queries) rather than throwing - a caller enforcing at a creation choke point
 * must never be able to crash the pipeline it protects.
 */

import "server-only";

import { cache } from "react";

import { loadGscCannibalizationForTenant } from "@/domains/recommendation-intelligence/gsc-cannibalization";
import { loadIntentClustersForTenant } from "@/domains/serp/intent-clusters-loader";
import { loadGscPageSignalsForTenant, type GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { log } from "@/lib/logger";

import { buildOwnershipRegistry, type OwnershipRegistry } from "./registry";

const EMPTY_REGISTRY: OwnershipRegistry = {
  byQuery: new Map(),
  conflicts: [],
  coverage: { totalQueries: 0, gscBasisCount: 0, serpClusterBasisCount: 0, unresolvedCount: 0 },
};

/**
 * Load the ownership registry for one tenant end to end. Optionally accepts
 * an already-loaded GSC signal map + owned domain (callers that already paid
 * for `loadGscPageSignalsForTenant` this render - e.g. the trigger loader -
 * should pass it through so this never re-reads it).
 */
export async function loadOwnershipRegistryForTenant(
  tenantId: string,
  opts: { gscSignals?: ReadonlyMap<string, GscPageSignal>; ownDomain?: string | null } = {},
): Promise<OwnershipRegistry> {
  if (!tenantId) return EMPTY_REGISTRY;
  try {
    const gscSignals = opts.gscSignals ?? (await loadGscPageSignalsForTenant(tenantId).catch(() => new Map<string, GscPageSignal>()));
    const ownDomain = opts.ownDomain ?? deriveOwnDomainFromSignals(gscSignals);

    const [cannibalization, clusterResult] = await Promise.all([
      loadGscCannibalizationForTenant(tenantId).catch((e) => {
        log.warn("[ownership-registry] cannibalization read failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
        return [];
      }),
      loadIntentClustersForTenant({ tenantId, gscSignals, ownDomain }).catch((e) => {
        log.warn("[ownership-registry] intent-cluster read failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
        return { clusters: [], coverage: { totalQueries: 0, queriesWithSerpData: 0, queriesMissingSerpData: [], coverageRatio: 0 } };
      }),
    ]);

    // Tracked-query universe for the honest coverage count: every distinct GSC
    // query this tenant has signal for (the same universe intent-clusters
    // draws its own tracked-query count from), so "unresolvedCount" means
    // something real rather than just "queries the two bases happened to
    // mention".
    const trackedQueries = new Set<string>();
    for (const signal of gscSignals.values()) {
      for (const q of signal.topQueries ?? []) {
        const norm = q.query.trim().toLowerCase();
        if (norm) trackedQueries.add(norm);
      }
    }

    return buildOwnershipRegistry({
      cannibalization,
      clusters: clusterResult.clusters,
      trackedQueryCount: trackedQueries.size,
    });
  } catch (e) {
    log.warn("[ownership-registry] load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
    return EMPTY_REGISTRY;
  }
}

export const loadOwnershipRegistryForTenantCached = cache(
  (tenantId: string): Promise<OwnershipRegistry> => loadOwnershipRegistryForTenant(tenantId),
);

function deriveOwnDomainFromSignals(gscSignals: ReadonlyMap<string, GscPageSignal>): string | null {
  const hostCount = new Map<string, number>();
  for (const [page] of gscSignals) {
    try {
      const h = new URL(page).hostname.replace(/^www\./i, "").toLowerCase();
      hostCount.set(h, (hostCount.get(h) ?? 0) + 1);
    } catch {
      /* skip unparsable */
    }
  }
  return [...hostCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

export type { OwnershipRegistry, OwnerEntry, OwnershipBasis, OwnershipConfidence, OwnershipContender } from "./registry";
export { resolveOwner, hasKnownOwner, buildOwnershipRegistry } from "./registry";
