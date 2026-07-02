/**
 * load-coverage-map (2026-07-02, master-plan item 9) - the I/O edge for the
 * topical coverage map. Assembles the demand universe from ALREADY-STORED, $0
 * sources, hands it to the pure clustering + coverage modules, and returns the
 * top hubs. No live API calls, no LLM, fail-soft everywhere.
 *
 * Sources:
 *   - Demand graph (SWR snapshot): GSC demand nodes + queries, owned edges
 *     (the query-to-page answers), create_page moves (missing-page pointers),
 *     and the AI-attention gap nodes.
 *   - GSC question-shaped queries (loadQuestionQueries): the long tail of real
 *     questions the tenant already appears for.
 *   - Keyword-universe cache (readAllCachedKeywordDemand): discovered market
 *     terms + volume, $0 cached read.
 *   - Profound fanout seeds: the sub-questions AI expands prompts into.
 *   - Cached prompt opportunities (profound_citation/answer rows): AI-checked
 *     questions + whether the tenant was cited.
 *   - Cached LLM mention records (dataforseo-llm-mentions): owned AI-visibility
 *     checks per topic.
 *
 * "Answered" means an owned page serves the term: direct demand-graph edge for
 * GSC node queries, token-overlap match against the owned-page universe for
 * everything else (same matching family as load-graph competitor matching).
 */

import "server-only";
import { cache } from "react";

import { loadDemandGraphForTenantCached } from "@/domains/demand-graph/load-graph";
import { loadFanoutSeedsForTenant } from "@/domains/demand-graph/load-fanout-seeds";
import { loadCachedPromptOpportunities } from "@/domains/profound-coverage/load-cached";
import { loadQuestionQueries } from "@/domains/recommendation-intelligence/gsc-page-queries";
import { readAllCachedKeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { readAllCachedLlmMentions } from "@/domains/serp/dataforseo-llm-mentions";
import { log } from "@/lib/logger";

import { buildTopicHubs, sharedTokenCount, tokenizeTopic, type HubTerm } from "./build-hubs";
import { buildCoverageMap, DEFAULT_MAX_HUBS, type CoverageMap, type CreatePagePointer } from "./coverage-map";

export type CoverageSourceCounts = {
  searchQuestions: number;
  aiQuestions: number;
  keywords: number;
  fanouts: number;
};

export type CoverageMapResult = {
  map: CoverageMap;
  sourceCounts: CoverageSourceCounts;
};

const MAX_QUESTION_QUERIES = 400;
const MAX_KEYWORDS = 400;
const MAX_PROMPTS = 300;
const MIN_CLUSTER_SIZE = 3;

function pathTokens(url: string): string[] {
  try {
    const path = new URL(url.startsWith("http") ? url : `https://${url}`).pathname;
    return tokenizeTopic(path.replace(/[/_-]+/g, " "));
  } catch {
    return tokenizeTopic(url.replace(/[/_-]+/g, " "));
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

type OwnedPageTokens = { url: string; tokens: Set<string> };

/** Owned-page match: 2 shared tokens (1 for single-token terms) wins; best
 *  overlap first, then url asc for determinism. */
function bestOwnedMatch(termTokens: ReadonlySet<string>, pages: ReadonlyArray<OwnedPageTokens>): string | null {
  if (termTokens.size === 0) return null;
  const needed = Math.min(2, termTokens.size);
  let best: string | null = null;
  let bestShared = 0;
  for (const p of pages) {
    const shared = sharedTokenCount(termTokens, p.tokens);
    if (shared < needed) continue;
    if (shared > bestShared || (shared === bestShared && best !== null && p.url < best)) {
      best = p.url;
      bestShared = shared;
    }
  }
  return best;
}

async function loadCoverageMapImpl(tenantId: string): Promise<CoverageMapResult | null> {
  if (!tenantId) return null;
  try {
    // All reads are cached/stored ($0): SWR graph snapshot, bounded GSC read,
    // json-store caches, durable Supabase rows. Each fails soft to empty.
    const [graphResult, questionQueries, keywords, fanoutSeeds, promptOpps, llmMentions] = await Promise.all([
      loadDemandGraphForTenantCached(tenantId).catch(() => null),
      loadQuestionQueries(tenantId).catch(() => []),
      readAllCachedKeywordDemand().catch(() => []),
      loadFanoutSeedsForTenant(tenantId).catch(() => []),
      loadCachedPromptOpportunities(tenantId).catch(() => null),
      readAllCachedLlmMentions().catch(() => []),
    ]);
    const graph = graphResult?.graph ?? null;

    // Owned-page universe: path tokens per owned page, enriched with the
    // demand-node labels/queries each page serves (from the graph edges).
    const ownedTokenByUrl = new Map<string, Set<string>>();
    const ownedHostCount = new Map<string, number>();
    if (graph) {
      for (const p of graph.pageNodes) {
        if (!p.isOwned) continue;
        ownedTokenByUrl.set(p.url, new Set(pathTokens(p.url)));
        const h = hostOf(p.url);
        if (h) ownedHostCount.set(h, (ownedHostCount.get(h) ?? 0) + 1);
      }
      const nodeByKey = new Map(graph.demandNodes.map((d) => [d.key, d]));
      for (const e of graph.edges) {
        if (!e.isOwned) continue;
        const node = nodeByKey.get(e.demandKey);
        const set = ownedTokenByUrl.get(e.url);
        if (!node || !set) continue;
        for (const t of tokenizeTopic([node.label, ...node.queries].join(" "))) set.add(t);
      }
    }
    const ownedPages: OwnedPageTokens[] = [...ownedTokenByUrl.entries()]
      .map(([url, tokens]) => ({ url, tokens }))
      .sort((a, b) => a.url.localeCompare(b.url));
    const ownedDomain = [...ownedHostCount.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "";

    const terms: HubTerm[] = [];
    const counts: CoverageSourceCounts = { searchQuestions: 0, aiQuestions: 0, keywords: 0, fanouts: 0 };

    // 1) Demand-graph nodes. GSC nodes carry their page as the direct answer
    //    (the owned edge IS the query-to-page match); gap nodes have no page.
    if (graph) {
      const ownedUrlByKey = new Map<string, { url: string; weight: number }>();
      for (const e of graph.edges) {
        if (!e.isOwned) continue;
        const prev = ownedUrlByKey.get(e.demandKey);
        if (!prev || e.weight > prev.weight) ownedUrlByKey.set(e.demandKey, { url: e.url, weight: e.weight });
      }
      for (const node of graph.demandNodes) {
        const ownedUrl = ownedUrlByKey.get(node.key)?.url ?? null;
        if (node.queries.length === 0) {
          // AI-attention gap node (create_page candidate) or labeled topic.
          terms.push({ text: node.label, demand: node.demandWeight, source: "ai_question", answeredBy: ownedUrl, aiChecked: false, aiCited: false });
          counts.aiQuestions += 1;
          continue;
        }
        for (const q of node.queries) {
          terms.push({ text: q, demand: node.demandWeight, source: "search", answeredBy: ownedUrl, aiChecked: false, aiCited: false });
          counts.searchQuestions += 1;
        }
      }
    }

    // 2) GSC question-shaped long tail: answered = owned-page token match
    //    (impressions prove the site appears; the match names the page).
    for (const q of questionQueries.slice(0, MAX_QUESTION_QUERIES)) {
      terms.push({
        text: q.query,
        demand: q.impressions,
        source: "search",
        answeredBy: bestOwnedMatch(new Set(tokenizeTopic(q.query)), ownedPages),
        aiChecked: false,
        aiCited: false,
      });
      counts.searchQuestions += 1;
    }

    // 3) Keyword-universe cache (discovered market demand, $0 cached read).
    for (const k of keywords.slice(0, MAX_KEYWORDS)) {
      terms.push({
        text: k.keyword,
        demand: k.searchVolume ?? 0,
        source: "keyword",
        answeredBy: bestOwnedMatch(new Set(tokenizeTopic(k.keyword)), ownedPages),
        aiChecked: false,
        aiCited: false,
      });
      counts.keywords += 1;
    }

    // 4) Profound fanout sub-queries: the questions AI actually expands into.
    for (const f of fanoutSeeds) {
      terms.push({
        text: f.subQuery,
        demand: f.weight,
        source: "fanout",
        answeredBy: bestOwnedMatch(new Set(tokenizeTopic(f.subQuery)), ownedPages),
        aiChecked: false,
        aiCited: false,
      });
      counts.fanouts += 1;
    }

    // 5) AI-checked prompts (durable Profound citation/answer rows): the
    //    citation join. Cited = the tenant's domain cited or brand mentioned.
    for (const o of (promptOpps?.opportunities ?? []).slice(0, MAX_PROMPTS)) {
      terms.push({
        text: o.prompt,
        demand: o.executions,
        source: "ai_question",
        answeredBy: o.ownCitedUrls[0] ?? bestOwnedMatch(new Set(tokenizeTopic(o.prompt)), ownedPages),
        aiChecked: true,
        aiCited: o.ownCitationCount > 0 || o.ownMentionCount > 0,
      });
      counts.aiQuestions += 1;
    }

    // 6) Owned AI-visibility checks (cached LLM answers per topic).
    for (const r of llmMentions) {
      const cited = !!ownedDomain && r.mentions.some((m) => m.domain === ownedDomain || m.domain.endsWith("." + ownedDomain));
      terms.push({
        text: r.topic,
        demand: 0,
        source: "ai_question",
        answeredBy: bestOwnedMatch(new Set(tokenizeTopic(r.topic)), ownedPages),
        aiChecked: true,
        aiCited: cited,
      });
      counts.aiQuestions += 1;
    }

    if (terms.length === 0) return null;

    const { hubs, other } = buildTopicHubs(terms, { minClusterSize: MIN_CLUSTER_SIZE });
    const createPageMoves: CreatePagePointer[] = (graph?.moves ?? [])
      .filter((m) => m.gap === "create_page")
      .map((m) => ({ label: m.label, demandKey: m.demandKey }));
    const map = buildCoverageMap({ hubs, other, createPageMoves, maxHubs: DEFAULT_MAX_HUBS });
    if (map.rows.length === 0) return null;
    return { map, sourceCounts: counts };
  } catch (e) {
    log.warn("[coverage-map] load failed (section self-hides)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/** Request-memoized coverage map, bounded to the top hubs. Null = self-hide. */
export const loadCoverageMapForTenant = cache(loadCoverageMapImpl);
