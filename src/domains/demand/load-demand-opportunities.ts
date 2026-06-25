import "server-only";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { buildOpportunities, type DemandOpportunity } from "./keyword-opportunities";
import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { loadExperimentOutcomes } from "@/domains/learning/load-experiment-outcomes";
import { computeDimPriors, resolvePrior, canonicalMoveType } from "@/domains/learning/experiment-prior";

/**
 * load-demand-opportunities (2026-06-25, Sprint 4F) — the cockpit loader for the
 * demand-expansion engine. CACHE-ONLY (reads already-fetched DataForSEO keyword
 * demand — NO paid call on render, $0), fuses it with the tenant's owned pages +
 * topics (from the demand graph) through the pure opportunity engine, then applies
 * the Sprint-3 outcome prior to RANK (influence, not dominate — bounded, never
 * touches the raw demand evidence). Fail-soft → empty (honest: no cached data →
 * nothing shown until the operator runs Discover). Tenant-agnostic.
 */

export type DemandOpportunityRow = DemandOpportunity & {
  /** "ranked because similar moves won before" — null when no settled evidence. */
  learnedTag: string | null;
};

export type DemandOpportunitiesResult = {
  opportunities: DemandOpportunityRow[];
  /** True when at least one fresh cached keyword backed the result. */
  cached: boolean;
  keywordsConsidered: number;
};

export async function loadDemandOpportunities(
  tenantId: string,
  opts: { limit?: number } = {},
): Promise<DemandOpportunitiesResult> {
  const keywords = await readAllCachedKeywordDemand().catch(() => []);
  if (keywords.length === 0) {
    return { opportunities: [], cached: false, keywordsConsidered: 0 };
  }

  let ownedPages: { url: string }[] = [];
  let tenantTopics: string[] = [];
  try {
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    ownedPages = graph.pageNodes.filter((p) => p.isOwned).map((p) => ({ url: p.url }));
    tenantTopics = [...new Set([...graph.moves.map((m) => m.label), ...ownedPages.map((p) => p.url)])];
  } catch {
    /* no graph → opportunities still build, just without page-match/relevance gating */
  }

  const opps = buildOpportunities({ keywords, ownedPages, tenantTopics });

  // Sprint-3 outcome prior → bounded re-rank + explanation tag. Decided-only,
  // ±15%, backoff; with no settled outcomes the order is unchanged (neutral).
  let table: ReturnType<typeof computeDimPriors> = new Map();
  try {
    table = computeDimPriors(await loadExperimentOutcomes(tenantId));
  } catch {
    /* no priors → neutral */
  }
  const ranked = opps
    .map((o) => {
      const prior = table.size > 0 ? resolvePrior({ actionType: canonicalMoveType(o.action) }, table) : null;
      return { o, sortKey: o.estDemand * (prior?.multiplier ?? 1), tag: prior?.tag ?? null };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  return {
    opportunities: ranked.slice(0, opts.limit ?? 12).map(({ o, tag }) => ({ ...o, learnedTag: tag })),
    cached: true,
    keywordsConsidered: keywords.length,
  };
}
