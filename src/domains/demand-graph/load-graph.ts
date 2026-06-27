/**
 * load-graph (2026-06-24, Step 1 + Step 2) — assemble the REAL demand graph for
 * a tenant from already-synced signals, then hand it to the pure
 * `buildDemandGraph` assembler. This is the I/O edge; `build-graph.ts` stays pure.
 *
 * Sources (all stored, deterministic, $0):
 *   - GSC page+query signals  → demand + owned CTR/position (the spine)
 *   - GA4 page values         → the $ signal (conversions = money-first)
 *   - Clarity page signals    → friction (conversion leaks)
 *   - Profound citations      → competitor edges + owned AI-citation presence
 *
 * Step 2 wiring: competitor cited pages are matched to owned pages by topic-token
 * overlap (→ real answer_block / visibilityGap where AI cites a rival but not
 * you), and unmatched CONTENT competitors are synthesized into `create_page`
 * candidates (demand proxied by AI-citation breadth × volume, confidence honestly
 * LOW until SERP/volume confirms — Step L7). Tenant-agnostic via connectors.
 */

import "server-only";
import { cache } from "react";

import { loadGscPageSignalsForTenant, type GscPageSignal } from "@/domains/recommendation-intelligence/gsc-page-signals";
import {
  loadGa4PageValuesForTenant,
  loadGa4PageRevenueForTenant,
  type Ga4PageValue,
} from "@/domains/recommendation-intelligence/ga4-page-values";
import {
  normalizePageRevenue,
  revenueScoreMultiplier,
  type PageRevenueValue,
} from "@/domains/recommendation-intelligence/ga4-revenue";
import { loadClarityPageSignalsForTenant, type ClarityPageSignal } from "@/domains/recommendation-intelligence/clarity-page-signals";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import { log } from "@/lib/logger";

import { loadCompetitorCitedPagesForTenant, type CompetitorCitationsResult } from "./competitor-citations-loader";
import { loadFanoutSeedsForTenant, fanoutSeedsForNode, type FanoutSeed } from "./load-fanout-seeds";
import { loadExperimentOutcomes } from "@/domains/learning/load-experiment-outcomes";
import { applyExperimentPriorToMoves, canonicalMoveType, pageTypeFromUrl, queryClusterKey } from "@/domains/learning/experiment-prior";
import {
  buildDemandGraph,
  type DemandInput,
  type OwnedPageInput,
  type CompetitorCitationInput,
  type DemandGraph,
  type DemandGraphConfig,
} from "./build-graph";
import { attachProfoundEvidenceToMoves } from "./profound-evidence-fusion";
import { loadCachedPromptOpportunities } from "@/domains/profound-coverage/load-cached";

export type DemandGraphCoverage = {
  gscPages: number;
  ga4Pages: number;
  clarityPages: number;
  competitorCitations: number;
  competitorEdges: number;
  createPageCandidates: number;
  ownedCited: number;
  emptySources: string[];
};

export type LoadGraphResult = {
  graph: DemandGraph;
  coverage: DemandGraphCoverage;
};

const MAX_CREATE_CANDIDATES = 40;

const STOP = new Set([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are",
  "with", "best", "top", "how", "what", "why", "list", "guide", "your", "you",
]);

/** AI-industry/meta-prompt noise from the BORROWED Profound account (whose
 *  "Evaluate <AI company>…" meta-prompts cite AI-company pages). Generic AI-vendor
 *  tokens — NOT vertical/tenant hardcoding — so this code-excludes the junk the
 *  operator flagged, for any tenant on that shared account. */
const AI_NOISE = new Set([
  "openai", "anthropic", "claude", "chatgpt", "gpt", "gemini", "grok", "deepmind",
  "copilot", "mistral", "llm", "llms", "frontier", "pentagon", "huggingface",
  "perplexity", "datacamp", "mckinsey",
]);

function isAiNoise(domainFirst: string, topicTokens: string[]): boolean {
  if (AI_NOISE.has(domainFirst)) return true;
  return topicTokens.some((t) => AI_NOISE.has(t));
}

function toks(s: string): string[] {
  return (s || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t));
}

function pathOf(url: string): string {
  try {
    return new URL(url.startsWith("http") ? url : `https://${url}`).pathname
      .replace(/\/+$/, "")
      .toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function stripWww(h: string): string {
  return h.replace(/^www\./i, "").toLowerCase();
}

function prettyLabel(url: string): string {
  const slug = pathOf(url).split("/").filter(Boolean).pop() ?? "home";
  return slug.replace(/[-_]+/g, " ").trim() || "home";
}

// ── create-page hygiene (generic, NOT vertical/tenant-specific) ──
// Marketplace / UGC / social platforms: you can't "out-build" them and a brand's
// own listing there isn't a content gap. Matched by domain label so subdomains/
// cctlds are caught (ru.pinterest.com, etsy.com.bh).
const PLATFORM_NOISE_HOSTS = new Set([
  "etsy", "pinterest", "reddit", "facebook", "quora", "tripadvisor",
  "amazon", "instagram", "youtube", "tiktok", "ebay",
]);
export function isPlatformNoiseHost(host: string): boolean {
  return host.toLowerCase().split(".").some((l) => PLATFORM_NOISE_HOSTS.has(l));
}
// URL-path fragments that aren't real content topics (CMS prefixes, geo/id slugs).
const CMS_PATH_FIRST = new Set([
  "shop", "product", "products", "category", "categories", "collection",
  "collections", "blog", "blogs", "news", "tag", "tags", "page", "pages",
  "market", "author", "profile", "user", "cart", "account",
]);
// Competitor labels are built from the FULL URL path, so section prefixes leak in
// (/news/persian-new-year → "news persian new year"). Strip leading CMS prefixes so
// a real topic that merely sits under /news/ or /blogs/ isn't wrongly dropped.
function stripLeadingCmsTokens(tokens: string[]): string[] {
  let t = tokens;
  while (t.length && CMS_PATH_FIRST.has(t[0]!)) t = t.slice(1);
  return t;
}
export function isJunkTopicLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  if (!l) return true;
  const tokens = stripLeadingCmsTokens(l.split(/\s+/).filter(Boolean));
  if (tokens.length === 0) return true; // bare CMS path ("shop product", "category")
  if (tokens.join(" ").startsWith("research starters")) return true; // EBSCO-style slug
  // geo/id slug e.g. g293998 (letter-prefixed) or a long pure-digit id — but NOT
  // a 4-digit year (2026/1998 are legit topic tokens).
  if (tokens.some((t) => /^[a-z]{1,2}\d{3,}$/.test(t) || /^\d{5,}$/.test(t))) return true;
  return false;
}
// Display label for a create_page candidate: drop the leaked CMS-section prefixes so
// the card reads "persian new year", not "news persian new year".
export function cleanTopicLabel(label: string): string {
  const tokens = stripLeadingCmsTokens(label.trim().toLowerCase().split(/\s+/).filter(Boolean));
  return tokens.length ? tokens.join(" ") : label.trim();
}

/**
 * Request-cached, single-arg entry point. The heavy graph compute (a paginated
 * ~22k-row competitor-citation read + GSC/GA4/Clarity reads + in-memory assembly)
 * is triggered by MULTIPLE in-request callers on one `/` render (Today's Moves via
 * the change-pack loader + the New Pages board directly). `react.cache` keys on the
 * args, so this single-arg wrapper shares ONE compute per tenant per request —
 * halving the Supabase egress on the most-loaded page. Use this on render paths;
 * the raw function stays for callers that pass an explicit `now`/`config`.
 */
export const loadDemandGraphForTenantCached = cache(
  (tenantId: string): Promise<LoadGraphResult> => loadDemandGraphForTenant(tenantId),
);

export async function loadDemandGraphForTenant(
  tenantId: string,
  now: Date = new Date(),
  config?: DemandGraphConfig,
): Promise<LoadGraphResult> {
  const [gsc, ga4, ga4Revenue, clarity, fanoutSeeds] = await Promise.all([
    loadGscPageSignalsForTenant(tenantId, now).catch((e): Map<string, GscPageSignal> => {
      log.warn("[load-graph] gsc read failed", { tenantId, error: String(e) });
      return new Map();
    }),
    loadGa4PageValuesForTenant(tenantId, now).catch((e): Map<string, Ga4PageValue> => {
      log.warn("[load-graph] ga4 read failed", { tenantId, error: String(e) });
      return new Map();
    }),
    // 2026-06-26 revenue: SEPARATE, isolated read — empty map (→ conversion
    // fallback) when revenue columns don't exist yet / no ecommerce. Never
    // breaks the traffic read above.
    loadGa4PageRevenueForTenant(tenantId, now).catch((e): Map<string, PageRevenueValue> => {
      log.warn("[load-graph] ga4 revenue read failed (conversion fallback)", { tenantId, error: String(e) });
      return new Map();
    }),
    loadClarityPageSignalsForTenant(tenantId, now).catch((e): Map<string, ClarityPageSignal> => {
      log.warn("[load-graph] clarity read failed", { tenantId, error: String(e) });
      return new Map();
    }),
    // Phase 5: Profound fanout sub-queries → grounds content Moves in the actual
    // AI sub-questions. Empty (honest) until a Profound fanout sync lands rows.
    loadFanoutSeedsForTenant(tenantId).catch((e): FanoutSeed[] => {
      log.warn("[load-graph] fanout read failed", { tenantId, error: String(e) });
      return [];
    }),
  ]);

  // Derive the owned domain from the tenant's own pages (no config dependency).
  const hostCount = new Map<string, number>();
  for (const [page] of gsc) {
    try {
      const h = stripWww(new URL(page).hostname);
      hostCount.set(h, (hostCount.get(h) ?? 0) + 1);
    } catch {
      /* skip */
    }
  }
  const ownedDomain = [...hostCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  // Brand token (first label of the owned domain) — used to drop "the tenant's
  // own brand on a third-party platform" create-page noise (e.g. etsy.com/shop/Iranopedia).
  const brandToken = (ownedDomain.split(".")[0] ?? "").toLowerCase();

  const emptyComp: CompetitorCitationsResult = {
    competitors: [],
    ownedCitedUrls: new Map<string, number>(),
    rowsScanned: 0,
  };
  const { competitors, ownedCitedUrls } = ownedDomain
    ? await loadCompetitorCitedPagesForTenant(tenantId, ownedDomain).catch((e): CompetitorCitationsResult => {
        log.warn("[load-graph] competitor citations read failed", { tenantId, error: String(e) });
        return emptyComp;
      })
    : emptyComp;

  // Owned pages AI cited → match by pathname so answer_block only fires when you
  // are genuinely absent from AI answers.
  const ownedCitedPaths = new Map<string, number>();
  for (const [u, count] of ownedCitedUrls) ownedCitedPaths.set(pathOf(u), count);

  const demand: DemandInput[] = [];
  const ownedPages: OwnedPageInput[] = [];
  const ownedTokensByKey = new Map<string, Set<string>>();
  let ownedCitedHits = 0;

  for (const [page, g] of gsc) {
    const key = page;
    const topQuery = g.topQueries[0]?.query;
    const label = topQuery || prettyLabel(page);
    const aiCit = ownedCitedPaths.get(pathOf(page)) ?? 0;
    if (aiCit > 0) ownedCitedHits += 1;

    const nodeQueries = g.topQueries.map((q) => q.query);
    demand.push({
      key,
      label,
      queries: nodeQueries,
      gscImpressions: g.impressions90d,
      // your AI presence for this cluster (drives visibilityGap magnitude)
      ownedAiShare: aiCit > 0 ? 0.5 : 0,
      // Phase 5: real Profound sub-questions this page's topic expands into.
      fanoutSubQueries: fanoutSeedsForNode(label, nodeQueries, fanoutSeeds),
    });
    ownedTokensByKey.set(key, new Set([...toks(label), ...toks(pathOf(page))]));

    const ga = ga4.get(page);
    const cl = clarity.get(page);
    // 2026-06-26 revenue-aware $ signal. Prefer the normalized revenue value;
    // when revenue is unknown (pre-migration / no ecommerce), build a
    // conversion-only aggregate so the BOUNDED conversion fallback still applies
    // (revenueScoreMultiplier) — never the old conversions-as-dollars bug.
    const rev: PageRevenueValue =
      ga4Revenue.get(page) ??
      normalizePageRevenue({
        page,
        sessions: ga?.sessions28d ?? 0,
        engagedSessions: ga?.engaged28d ?? 0,
        conversions: ga?.conversions28d ?? 0,
        totalRevenue: null,
        purchaseRevenue: null,
        transactions: null,
        revenueCurrency: null,
        revenueObserved: false,
      });
    const revInfluence = revenueScoreMultiplier(rev);
    ownedPages.push({
      url: page,
      servesDemandKeys: [key],
      gscImpressions: g.impressions90d,
      gscClicks: g.clicks90d,
      gscCtr: g.ctr90d,
      gscPosition: g.position90d,
      ga4Sessions: ga?.sessions28d ?? null,
      ga4Conversions: ga?.conversions28d ?? null,
      ga4Value: ga?.conversions28d ?? 0,
      revenueValue: rev.revenue,
      revenueMultiplier: revInfluence.multiplier,
      revenueBasis: revInfluence.basis,
      clarityRageClicks: cl?.rageClicks ?? null,
      clarityDeadClicks: cl?.deadClicks ?? null,
      clarityScriptErrors: cl?.scriptErrors ?? null,
      aiCitationCount: aiCit,
    });
  }

  // Tenant topic vocabulary (union of all owned-page tokens) — used to keep
  // create_page candidates ON-topic for THIS tenant (derived from its own pages,
  // not hardcoded), which also drops off-topic junk that slipped the AI-noise net.
  const tenantVocab = new Set<string>();
  for (const s of ownedTokensByKey.values()) for (const t of s) tenantVocab.add(t);

  // ── match competitor cited pages to owned demand, or synthesize create_page ──
  const competitorCitations: CompetitorCitationInput[] = [];
  let competitorEdges = 0;
  type CreateCand = { label: string; urls: string[]; citationCount: number; modelCount: number };
  const createByTopic = new Map<string, CreateCand>();

  for (const c of competitors) {
    // Drop AI-industry meta-prompt noise from BOTH matched edges and create candidates.
    if (isAiNoise(c.domain.split(".")[0] ?? "", c.topicTokens)) continue;

    const ctoks = new Set(c.topicTokens);
    let bestKey: string | null = null;
    let bestShared = 0;
    for (const [key, otoks] of ownedTokensByKey) {
      let shared = 0;
      for (const t of ctoks) if (otoks.has(t)) shared += 1;
      if (shared > bestShared) {
        bestShared = shared;
        bestKey = key;
      }
    }
    if (bestKey && bestShared >= 2) {
      competitorCitations.push({ url: c.url, demandKey: bestKey, weight: c.citationCount * (1 + c.modelCount) });
      competitorEdges += 1;
    } else if (
      !c.isAggregator &&
      !isPlatformNoiseHost(c.domain) && // drop etsy/pinterest/reddit/tripadvisor/… marketplace+UGC
      !isJunkTopicLabel(c.label) && // drop URL-path fragments + geo/id slugs (g293998, "product …")
      // drop the tenant's own brand on a third-party platform (etsy.com/shop/Iranopedia)
      !(brandToken.length >= 4 && c.label.toLowerCase().includes(brandToken) && !c.domain.toLowerCase().includes(brandToken)) &&
      c.topicTokens.length >= 2 &&
      c.topicTokens.some((t) => tenantVocab.has(t)) // on-topic for this tenant
    ) {
      // unmatched content competitor → a create_page candidate, grouped by topic
      const tkey = "gap:" + c.topicTokens.slice(0, 3).sort().join("-");
      const ex = createByTopic.get(tkey) ?? { label: cleanTopicLabel(c.label), urls: [], citationCount: 0, modelCount: 0 };
      ex.urls.push(c.url);
      ex.citationCount += c.citationCount;
      ex.modelCount = Math.max(ex.modelCount, c.modelCount);
      createByTopic.set(tkey, ex);
    }
  }

  // Top create_page candidates by AI attention (breadth × volume). Demand is an
  // AI-citation proxy (NOT measured search volume) → confidence stays LOW. Scaled
  // ×100 to read as an "AI-attention score" (citation_count is share-scaled).
  const createTop = [...createByTopic.entries()]
    .map(([k, v]) => ({ k, ...v, proxy: Math.max(1, Math.round(v.citationCount * (1 + v.modelCount) * 100)) }))
    .sort((a, b) => b.proxy - a.proxy)
    .slice(0, MAX_CREATE_CANDIDATES);

  for (const c of createTop) {
    demand.push({
      key: c.k,
      label: c.label,
      queries: [],
      aiExecutions: c.proxy, // AI-attention proxy demand (no GSC/volume yet)
      fanoutSubQueries: fanoutSeedsForNode(c.label, [], fanoutSeeds),
    });
    for (const u of c.urls.slice(0, 5)) {
      competitorCitations.push({ url: u, demandKey: c.k, weight: c.citationCount });
      competitorEdges += 1;
    }
  }

  const graph = buildDemandGraph({ demand, ownedPages, competitorCitations, config });

  // Sprint 3 — LEARNING REWEIGHT (outside the pure scorer): tilt the ranking by
  // past won/lost outcomes from the proof ledger. Bounded ±15%, decided-only,
  // ≥3-sample, with backoff — so it influences ties, never dominates, and a fresh
  // tenant (no settled outcomes) gets byte-identical ordering. Fail-soft → raw
  // graph. Raw MoveComponents are never touched (the lie detector stays honest).
  let moves = graph.moves;
  try {
    const outcomes = await loadExperimentOutcomes(tenantId);
    if (outcomes.length > 0) {
      moves = applyExperimentPriorToMoves(graph.moves, outcomes, (m) => ({
        actionType: canonicalMoveType(m.gap),
        pageType: pageTypeFromUrl(m.ownedUrl ?? ""),
        queryCluster: queryClusterKey(m.label),
      }));
    }
  } catch {
    moves = graph.moves; // never let the learning layer break the graph
  }
  // Profound AEO EVIDENCE fusion (evidence-only; no score change, no new actions).
  // Reads the DURABLE cached store (loadCachedPromptOpportunities — NO live
  // Profound API on render), time-boxed + fail-soft so it can never hang or break
  // the cockpit. Attaches `aeoEvidence` to matched Moves so a card can say "AI is
  // asked X, fans out into Y, cites these competitors, you're absent". The
  // coverage compiler's internal_link_fix/consolidate decisions are NOT promoted
  // to customer Moves here — they stay in the operator coverage diagnostic.
  try {
    const aeo = await Promise.race([
      loadCachedPromptOpportunities(tenantId),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 4000)),
    ]);
    if (aeo && aeo.opportunities.length > 0) {
      moves = attachProfoundEvidenceToMoves(moves, aeo.opportunities);
    }
  } catch {
    // evidence is additive — never let it affect the graph
  }
  const reweightedGraph: DemandGraph = moves === graph.moves ? graph : { ...graph, moves };

  const emptySources: string[] = [];
  if (gsc.size === 0) emptySources.push("gsc");
  if (ga4.size === 0) emptySources.push("ga4");
  if (clarity.size === 0) emptySources.push("clarity");
  if (competitors.length === 0) emptySources.push("profound-citations");

  return {
    graph: reweightedGraph,
    coverage: {
      gscPages: gsc.size,
      ga4Pages: ga4.size,
      clarityPages: clarity.size,
      competitorCitations: competitors.length,
      competitorEdges,
      createPageCandidates: createTop.length,
      ownedCited: ownedCitedHits,
      emptySources,
    },
  };
}
