import "server-only";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { buildOpportunities, type DemandOpportunity } from "./keyword-opportunities";
import { buildTrendRadar, type TrendOpportunity } from "./trend-radar";
import { buildProductOpportunities, type ProductOpportunity } from "./product-opportunities";
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

export type TrendOpportunityRow = TrendOpportunity & { learnedTag: string | null };
export type ProductOpportunityRow = ProductOpportunity & { learnedTag: string | null };

export type DemandOpportunitiesResult = {
  opportunities: DemandOpportunityRow[];
  /** 4D — rising/declining/seasonal trend opportunities. */
  trends: TrendOpportunityRow[];
  /** 4E — store/product opportunities (concept-only unless inventory verified). */
  products: ProductOpportunityRow[];
  /** True when at least one fresh cached keyword backed the result. */
  cached: boolean;
  keywordsConsidered: number;
};

export async function loadDemandOpportunities(
  tenantId: string,
  opts: { limit?: number; currentMonth?: number } = {},
): Promise<DemandOpportunitiesResult> {
  const keywords = await readAllCachedKeywordDemand().catch(() => []);
  if (keywords.length === 0) {
    return { opportunities: [], trends: [], products: [], cached: false, keywordsConsidered: 0 };
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

  const limit = opts.limit ?? 12;
  // currentMonth from the caller (or server time) — coarse, only for seasonal "why now".
  const currentMonth = opts.currentMonth ?? new Date().getMonth() + 1;

  const opps = buildOpportunities({ keywords, ownedPages, tenantTopics });
  const trends = buildTrendRadar({ keywords, ownedPages, currentMonth });
  // Tenant-agnostic: without a connected commerce platform (Wix Store, etc.) we
  // can't verify inventory, so owned pages are candidate product/collection matches
  // by URL/topic only and every product opportunity stays concept_only until a real
  // in-stock product is confirmed.
  const products = buildProductOpportunities({ keywords, pages: ownedPages });

  // Sprint-3 outcome prior → bounded re-rank + explanation tag. Decided-only,
  // ±15%, backoff; with no settled outcomes the order is unchanged (neutral).
  let table: ReturnType<typeof computeDimPriors> = new Map();
  try {
    table = computeDimPriors(await loadExperimentOutcomes(tenantId));
  } catch {
    /* no priors → neutral */
  }
  const priorFor = (actionType: string): { multiplier: number; tag: string | null } => {
    if (table.size === 0) return { multiplier: 1, tag: null };
    const p = resolvePrior({ actionType: canonicalMoveType(actionType) }, table);
    return { multiplier: p?.multiplier ?? 1, tag: p?.tag ?? null };
  };

  const rankedOpps = opps
    .map((o) => {
      const p = priorFor(o.action);
      return { o, sortKey: o.estDemand * p.multiplier, tag: p.tag };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  const rankedTrends = trends
    .map((o) => {
      const p = priorFor(o.recommendedAction);
      return { o, sortKey: (o.estDemand ?? 0) * p.multiplier, tag: p.tag };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  const rankedProducts = products
    .map((o) => {
      const p = priorFor(o.recommendedAction);
      return { o, sortKey: o.estDemand * p.multiplier, tag: p.tag };
    })
    .sort((a, b) => b.sortKey - a.sortKey);

  return {
    opportunities: rankedOpps.slice(0, limit).map(({ o, tag }) => ({ ...o, learnedTag: tag })),
    trends: rankedTrends.slice(0, limit).map(({ o, tag }) => ({ ...o, learnedTag: tag })),
    products: rankedProducts.slice(0, limit).map(({ o, tag }) => ({ ...o, learnedTag: tag })),
    cached: true,
    keywordsConsidered: keywords.length,
  };
}
