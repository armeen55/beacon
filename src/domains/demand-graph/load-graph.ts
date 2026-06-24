/**
 * load-graph (2026-06-24, Step 1) — assemble the REAL demand graph for a tenant
 * from already-synced signals, then hand it to the pure `buildDemandGraph`
 * assembler. This is the I/O edge; `build-graph.ts` stays pure/testable.
 *
 * v0 sources (all stored, deterministic, $0):
 *   - GSC page+query signals  → demand + owned page CTR/position (the spine)
 *   - GA4 page values         → the $ signal (conversions = money-first)
 *   - Clarity page signals    → friction (conversion leaks)
 *
 * Competitor citation EDGES are deferred to Step 2: the only stored competitor
 * source today (`profound_citation_rows`) is the pre-topic-scoping cache for
 * Iranopedia (36k AI-company rows) and carries no query/topic to map onto a
 * cluster — so attaching it now would inject junk. Step 2 (the cited-page
 * loader) wires it once the topic-scoped resync lands. Until then the graph is
 * an honest OWNED-page worklist (edit / fix_experience / healthy), which is a
 * valid first truth test: does demand rank sanely? does GA4 $ lift money pages?
 * does Clarity friction surface? Works for ANY tenant via its connectors.
 */

import "server-only";

import { loadGscPageSignalsForTenant, type GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import { loadGa4PageValuesForTenant, type Ga4PageValue } from "@/domains/recommendation-intelligence/ga4-page-values";
import { loadClarityPageSignalsForTenant, type ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { log } from "@/lib/logger";

import {
  buildDemandGraph,
  type DemandInput,
  type OwnedPageInput,
  type CompetitorCitationInput,
  type DemandGraph,
  type DemandGraphConfig,
} from "./build-graph";

export type DemandGraphCoverage = {
  gscPages: number;
  ga4Pages: number;
  clarityPages: number;
  competitorCitations: number;
  /** Sources that returned zero rows — honest "why is this empty" for the UI. */
  emptySources: string[];
};

export type LoadGraphResult = {
  graph: DemandGraph;
  coverage: DemandGraphCoverage;
};

/** Human label from a URL path, e.g. ".../persian-female-first-names" →
 *  "persian female first names". */
function prettyLabel(url: string): string {
  try {
    const path = new URL(url).pathname;
    const slug = path.replace(/\/+$/, "").split("/").filter(Boolean).pop() ?? "home";
    return slug.replace(/[-_]+/g, " ").trim() || "home";
  } catch {
    return url;
  }
}

export async function loadDemandGraphForTenant(
  tenantId: string,
  now: Date = new Date(),
  config?: DemandGraphConfig,
): Promise<LoadGraphResult> {
  const [gsc, ga4, clarity] = await Promise.all([
    loadGscPageSignalsForTenant(tenantId, now).catch((e): Map<string, GscPageSignal> => {
      log.warn("[load-graph] gsc read failed", { tenantId, error: String(e) });
      return new Map();
    }),
    loadGa4PageValuesForTenant(tenantId, now).catch((e): Map<string, Ga4PageValue> => {
      log.warn("[load-graph] ga4 read failed", { tenantId, error: String(e) });
      return new Map();
    }),
    loadClarityPageSignalsForTenant(tenantId, now).catch((e): Map<string, ClarityPageSignal> => {
      log.warn("[load-graph] clarity read failed", { tenantId, error: String(e) });
      return new Map();
    }),
  ]);

  const demand: DemandInput[] = [];
  const ownedPages: OwnedPageInput[] = [];

  for (const [page, g] of gsc) {
    // One demand cluster per owned page (v0). Real cluster grouping by topic
    // arrives with the Profound prompt-level data in a later step.
    const key = page;
    const topQuery = g.topQueries[0]?.query;
    demand.push({
      key,
      label: topQuery || prettyLabel(page),
      queries: g.topQueries.map((q) => q.query),
      gscImpressions: g.impressions90d,
    });

    const ga = ga4.get(page);
    const cl = clarity.get(page);
    ownedPages.push({
      url: page,
      servesDemandKeys: [key],
      gscImpressions: g.impressions90d,
      gscClicks: g.clicks90d,
      gscCtr: g.ctr90d,
      gscPosition: g.position90d,
      ga4Sessions: ga?.sessions28d ?? null,
      ga4Conversions: ga?.conversions28d ?? null,
      // Money-first $ signal: real conversions (leads/sales). Content tenants
      // with no goals configured read 0 — honest; demand still ranks them.
      ga4Value: ga?.conversions28d ?? 0,
      clarityRageClicks: cl?.rageClicks ?? null,
      clarityDeadClicks: cl?.deadClicks ?? null,
      clarityScriptErrors: cl?.scriptErrors ?? null,
      // Owned AI-citation count is wired in Step 2 (needs clean topic-scoped
      // Profound rows); 0/undefined here never triggers a false answer_block.
      aiCitationCount: null,
    });
  }

  const competitorCitations: CompetitorCitationInput[] = []; // Step 2

  const graph = buildDemandGraph({ demand, ownedPages, competitorCitations, config });

  const emptySources: string[] = [];
  if (gsc.size === 0) emptySources.push("gsc");
  if (ga4.size === 0) emptySources.push("ga4");
  if (clarity.size === 0) emptySources.push("clarity");

  return {
    graph,
    coverage: {
      gscPages: gsc.size,
      ga4Pages: ga4.size,
      clarityPages: clarity.size,
      competitorCitations: competitorCitations.length,
      emptySources,
    },
  };
}
