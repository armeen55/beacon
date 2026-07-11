/**
 * load-graph (2026-06-24, Step 1 + Step 2), assemble the REAL demand graph for
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
 * LOW until SERP/volume confirms, Step L7). Tenant-agnostic via connectors.
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
import { loadExperimentOutcomes, loadChangePatternOutcomes, loadEffectObservations, loadProofOutcomeRows } from "@/domains/learning/load-experiment-outcomes";
import { applyExperimentPriorToMoves, canonicalMoveType, pageTypeFromUrl, queryClusterKey } from "@/domains/learning/experiment-prior";
import { applyEffectSizePriorToMoves } from "@/domains/learning/effect-size-prior";
import { applyProofOutcomeCautionToMoves } from "@/domains/demand-graph/proof-outcome-caution";
import { applyDismissalLearning } from "@/domains/learning/dismissal-learning";
import { loadDismissalSignals } from "@/domains/learning/load-dismissal-signals";
import {
  buildDemandGraph,
  type DemandInput,
  type OwnedPageInput,
  type CompetitorCitationInput,
  type DemandGraph,
  type DemandGraphConfig,
} from "./build-graph";
import { attachProfoundEvidenceToMoves } from "./profound-evidence-fusion";
import { collapseCreatePageSiblings } from "./collapse-create-page-siblings";
import { checkTopicCoherence } from "./topic-coherence-gate";
import { gateCreatePageOwnershipWithRegistry } from "./create-page-ownership-gate";
import { loadOwnershipRegistryForTenant } from "@/domains/ownership/registry-loader";
import { isUnparseableLabel } from "./clean-topic-label";
import { readAllCachedKeywordDemand, type KeywordDemand } from "@/domains/serp/dataforseo-keywords";
import { getLatestMoveDrafts } from "./move-draft-store";
import { getCompetitorAuditsForTenant } from "./competitor-page-audit";
import {
  buildCreatePageInfoGainInputs,
  gateCreatePageInfoGain,
  type InfoGainChange,
} from "@/domains/drafts/info-gain-gate";
import { loadCachedPromptOpportunities } from "@/domains/profound-coverage/load-cached";
import {
  readGraphSnapshot,
  writeGraphSnapshot,
  isGraphStale,
  isGraphSnapshotValid,
  GRAPH_SCHEMA_VERSION,
} from "./graph-snapshot-store";

export type DemandGraphCoverage = {
  gscPages: number;
  ga4Pages: number;
  clarityPages: number;
  competitorCitations: number;
  competitorEdges: number;
  createPageCandidates: number;
  ownedCited: number;
  emptySources: string[];
  /** UX0 (2026-07-02), the topic coherence gate's honest tally: create_page
   *  candidates SUPPRESSED entirely (mostly-incoherent member mix) and candidates
   *  that survived with one or more off-topic members trimmed. Zero on a clean
   *  tenant; never silent when the gate actually fires. */
  coherence: { suppressedCandidates: { label: string; reason: string }[]; trimmedCandidates: { label: string; droppedCount: number; reason: string }[] };
  /** UX0 (2026-07-02), create_page candidates the ownership gate reclassified
   *  (own page already cited -> edit_page) or dropped (cited but no specific URL). */
  ownershipReclassified: { label: string; action: "reclassified" | "dropped"; ownedUrl: string | null; reason: string }[];
  /** N5 (2026-07-03), the information-gain gate's honest tally: create_page
   *  candidates dropped (they would only repeat what the cited winners already
   *  say), reclassified to an edit, or demoted below every adds-something row.
   *  Absent/empty when nothing had both a brief and teardown evidence to score
   *  (the gate never blocks on missing data). */
  infoGain?: { label: string; action: "dropped" | "reclassified" | "demoted"; verdict: string; reason: string }[];
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
 *  tokens, NOT vertical/tenant hardcoding, so this code-excludes the junk the
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
  // geo/id slug e.g. g293998 (letter-prefixed) or a long pure-digit id, but NOT
  // a 4-digit year (2026/1998 are legit topic tokens).
  if (tokens.some((t) => /^[a-z]{1,2}\d{3,}$/.test(t) || /^\d{5,}$/.test(t))) return true;
  // Grammar sanity (2026-07-02 UX0): drop it here too, before it ever becomes a
  // create_page candidate, ground-truth found a URL-slug label trailing off on a
  // bare verb ("...Hear Cross") that reached the board as a broken title.
  if (isUnparseableLabel(tokens.join(" "))) return true;
  return false;
}
// Display label for a create_page candidate: drop the leaked CMS-section prefixes so
// the card reads "persian new year", not "news persian new year".
export function cleanTopicLabel(label: string): string {
  const tokens = stripLeadingCmsTokens(label.trim().toLowerCase().split(/\s+/).filter(Boolean));
  return tokens.length ? tokens.join(" ") : label.trim();
}

/** Per-process lock: tenants with an in-flight background graph refresh. Prevents
 *  concurrent stale visits from each launching a duplicate ~6s rebuild. */
const graphRefreshing = new Set<string>();

/** Per-process SINGLE-FLIGHT for the synchronous miss build: concurrent cold/post-
 *  invalidation requests (different request scopes, so `react.cache` can't dedupe them)
 *  share ONE build instead of each launching a duplicate ~6s graph compute (a thundering
 *  herd that quadruples wall-clock under contention). */
const graphBuilding = new Map<string, Promise<LoadGraphResult>>();

/** Build the graph once + persist; subsequent concurrent callers await the same promise.
 *  Sibling fix (2026-07-10 hygiene batch) - `tenantId` threads explicitly into the write
 *  (the same P2-f discipline changes-surface-store already applies), so the persisted
 *  snapshot can never land under json-store's ambient currentTenantSlug() resolution
 *  disagreeing with the tenant this after()/detached background build ran for. */
function buildAndPersistOnce(tenantId: string): Promise<LoadGraphResult> {
  const existing = graphBuilding.get(tenantId);
  if (existing) return existing;
  const t0 = Date.now();
  const p = (async () => {
    const fresh = await loadDemandGraphForTenant(tenantId);
    await writeGraphSnapshot(fresh, new Date().toISOString(), tenantId);
    log.info("[graph-snapshot] built + persisted", { tenantId, buildMs: Date.now() - t0, version: GRAPH_SCHEMA_VERSION });
    return fresh;
  })().finally(() => graphBuilding.delete(tenantId));
  graphBuilding.set(tenantId, p);
  return p;
}

/** Schedule ONE background graph recompute for a stale tenant (throttled by the lock).
 *  Uses `after()` when in a request scope (so it survives the response on serverless);
 *  falls back to a detached promise otherwise. Fail-soft, a refresh failure leaves the
 *  stale snapshot in place; the next visit retries. */
function scheduleGraphRefresh(tenantId: string): void {
  if (graphRefreshing.has(tenantId)) return;
  graphRefreshing.add(tenantId);
  const run = async (): Promise<void> => {
    try {
      // Reuse the single-flight builder so a stale-serve refresh + a concurrent sync miss
      // share ONE build (never two concurrent ~6s computes for the same tenant).
      await buildAndPersistOnce(tenantId);
    } catch (e) {
      log.warn("[graph-snapshot] background refresh failed (stale snapshot kept)", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      graphRefreshing.delete(tenantId);
    }
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { after } = require("next/server") as { after: (cb: () => Promise<void>) => void };
    after(run);
  } catch {
    void run(); // not a request scope (or next/server unavailable) → detached, fail-soft
  }
}

/**
 * Cross-request stale-while-revalidate Demand Graph cache. The ~6s graph build is
 * INDEPENDENTLY rebuilt by every surface that needs it (Worklist/ActionPack, New Pages,
 * Today, Recommendations/Drafts, page-factory, enrichment), `react.cache` only dedupes
 * within ONE request. This serves the last persisted snapshot across requests and refreshes
 * in the background when stale, so warm consumers read it in ~ms instead of rebuilding.
 *
 * - First-ever / invalid / version-mismatch → compute synchronously + persist.
 * - Fresh snapshot → serve it, no rebuild.
 * - Stale snapshot → serve immediately + schedule ONE background refresh (throttled).
 * Tenant-scoped; fail-soft (a read error → synchronous build, never a crash).
 */
async function loadDemandGraphForTenantSWR(tenantId: string): Promise<LoadGraphResult> {
  const snap = await readGraphSnapshot(tenantId).catch(() => null);
  if (isGraphSnapshotValid(snap)) {
    const stale = isGraphStale(snap.computedAt, Date.now());
    if (stale) scheduleGraphRefresh(tenantId);
    // Phase-6 operator diagnostics: graph cache hit + freshness + whether a refresh fired.
    log.info("[graph-snapshot] hit", {
      tenantId,
      computedAt: snap.computedAt,
      ageMin: Math.round((Date.now() - Date.parse(snap.computedAt)) / 60000),
      state: stale ? "stale" : "fresh",
      refreshScheduled: stale,
      version: GRAPH_SCHEMA_VERSION,
    });
    return snap.data;
  }
  // miss / corrupt / stale-version → compute synchronously (single-flight so concurrent
  // cold requests share ONE build), then persist for next time.
  return buildAndPersistOnce(tenantId);
}

/**
 * Request-cached, single-arg entry point, now backed by the cross-request SWR snapshot.
 * `react.cache` still dedupes the (possibly snapshot-read) call WITHIN one request, so the
 * multiple in-request callers on a `/` render share one read; the SWR shares the underlying
 * graph COMPUTE across requests. Use this on render paths; the raw `loadDemandGraphForTenant`
 * stays for callers that pass an explicit `now`/`config` or must bypass the cache.
 */
export const loadDemandGraphForTenantCached = cache(
  (tenantId: string): Promise<LoadGraphResult> => loadDemandGraphForTenantSWR(tenantId),
);

export async function loadDemandGraphForTenant(
  tenantId: string,
  now: Date = new Date(),
  config?: DemandGraphConfig,
): Promise<LoadGraphResult> {
  // Kick off the durable Profound evidence read NOW so it runs CONCURRENTLY with
  // the graph's own loaders (below), attaching it after buildDemandGraph then
  // adds ~0 wall-clock instead of a serial +2.4s that would trip downstream
  // timeouts (e.g. the New Pages board's 8s guard). Cached store only, no live API.
  const aeoEvidencePromise = loadCachedPromptOpportunities(tenantId).catch(() => null);
  // Same trick for create_page canonicalization inputs (keyword-volume cache + move
  // drafts), kicked off NOW so collapseCreatePageSiblings adds ~0 wall-clock below.
  const collapseInputsPromise = Promise.all([
    readAllCachedKeywordDemand().catch((): KeywordDemand[] => []),
    getLatestMoveDrafts(tenantId).catch(() => new Map<string, { content: string }>()),
  ]).catch((): [KeywordDemand[], Map<string, { content: string }>] => [[], new Map()]);

  const [gsc, ga4, ga4Revenue, clarity, fanoutSeeds] = await Promise.all([
    loadGscPageSignalsForTenant(tenantId, now).catch((e): Map<string, GscPageSignal> => {
      log.warn("[load-graph] gsc read failed", { tenantId, error: String(e) });
      return new Map();
    }),
    loadGa4PageValuesForTenant(tenantId, now).catch((e): Map<string, Ga4PageValue> => {
      log.warn("[load-graph] ga4 read failed", { tenantId, error: String(e) });
      return new Map();
    }),
    // 2026-06-26 revenue: SEPARATE, isolated read, empty map (→ conversion
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
  // Brand token (first label of the owned domain), used to drop "the tenant's
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
    // (revenueScoreMultiplier), never the old conversions-as-dollars bug.
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

  // Tenant topic vocabulary (union of all owned-page tokens), used to keep
  // create_page candidates ON-topic for THIS tenant (derived from its own pages,
  // not hardcoded), which also drops off-topic junk that slipped the AI-noise net.
  const tenantVocab = new Set<string>();
  for (const s of ownedTokensByKey.values()) for (const t of s) tenantVocab.add(t);

  // ── match competitor cited pages to owned demand, or synthesize create_page ──
  const competitorCitations: CompetitorCitationInput[] = [];
  let competitorEdges = 0;
  type CreateCand = {
    label: string;
    urls: string[];
    /** Per-URL label (from the competitor's own URL slug), for the coherence gate,
     *  parallel to `urls` (member i's label is memberLabels[i]). */
    memberLabels: string[];
    citationCount: number;
    modelCount: number;
  };
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
      const ex = createByTopic.get(tkey) ?? { label: cleanTopicLabel(c.label), urls: [], memberLabels: [], citationCount: 0, modelCount: 0 };
      ex.urls.push(c.url);
      ex.memberLabels.push(c.label);
      ex.citationCount += c.citationCount;
      ex.modelCount = Math.max(ex.modelCount, c.modelCount);
      createByTopic.set(tkey, ex);
    }
  }

  // Top create_page candidates by AI attention (breadth × volume). Demand is an
  // AI-citation proxy (NOT measured search volume) → confidence stays LOW. Scaled
  // ×100 to read as an "AI-attention score" (citation_count is share-scaled).
  // UX0 coherence gate (2026-07-02): a bucket can still land unrelated member URLs
  // when their first-3-sorted-tokens key happens to collide (rare, but ground-truth
  // proved it happens), before this candidate becomes a Move, verify its OWN members
  // actually agree with its head label; drop the disagreeing ones, and suppress the
  // whole candidate when most of them disagree (never publish an averaged-together
  // topic). Logged so `npm run` probes can list exactly what got dropped/suppressed.
  const coherenceDropped: Array<{ tkey: string; label: string; droppedUrls: string[]; reason: string }> = [];
  const coherenceSuppressed: Array<{ tkey: string; label: string; reason: string }> = [];
  const createTopRaw = [...createByTopic.entries()]
    .map(([k, v]) => {
      // Gate on each member's human-readable slug label (a stronger coherence signal
      // than the raw URL), then map surviving indices back to their URL.
      const members = v.memberLabels.map((text, i) => ({ id: String(i), text }));
      const verdict = checkTopicCoherence(v.label, members);
      const keptIdx = new Set(verdict.kept.map((m) => Number(m.id)));
      const keptUrls = v.urls.filter((_, i) => keptIdx.has(i));
      const droppedUrls = v.urls.filter((_, i) => !keptIdx.has(i));
      if (droppedUrls.length > 0) {
        coherenceDropped.push({ tkey: k, label: v.label, droppedUrls, reason: verdict.reason });
      }
      if (verdict.suppressCandidate) {
        coherenceSuppressed.push({ tkey: k, label: v.label, reason: verdict.reason });
        return null;
      }
      return { k, label: v.label, urls: keptUrls, citationCount: v.citationCount, modelCount: v.modelCount };
    })
    .filter((v): v is { k: string; label: string; urls: string[]; citationCount: number; modelCount: number } => v !== null && v.urls.length > 0);
  if (coherenceDropped.length > 0 || coherenceSuppressed.length > 0) {
    log.info("[load-graph] topic coherence gate", {
      tenantId,
      droppedMemberBuckets: coherenceDropped.length,
      suppressedCandidates: coherenceSuppressed.length,
      suppressed: coherenceSuppressed.map((s) => s.label),
    });
  }
  const createTop = createTopRaw
    .map((v) => ({ ...v, proxy: Math.max(1, Math.round(v.citationCount * (1 + v.modelCount) * 100)) }))
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

  // Sprint 3, LEARNING REWEIGHT (outside the pure scorer): tilt the ranking by
  // past won/lost outcomes from the proof ledger. Bounded ±15%, decided-only,
  // ≥3-sample, with backoff, so it influences ties, never dominates, and a fresh
  // tenant (no settled outcomes) gets byte-identical ordering. Fail-soft → raw
  // graph. Raw MoveComponents are never touched (the lie detector stays honest).
  let moves = graph.moves;
  try {
    // RANK-1: the SAME bounded, decided-only prior is now fed by TWO sources that
    // share one dimension space and one win-rate math - the proof ledger's own
    // settled verdicts AND the change-pattern brain's per-(signal x asset)
    // success rates (each pattern reduced to synthetic decided outcomes on the
    // actionType dimension, only where it cleared its own >= 3 sample floor). Both
    // are concatenated and handed to the ONE computeDimPriors, so change-patterns
    // strengthens the same multiplier instead of being a second, drifting prior.
    // A fresh tenant has neither source -> empty list -> byte-identical ranking.
    const [ledgerOutcomes, patternOutcomes] = await Promise.all([
      loadExperimentOutcomes(tenantId),
      loadChangePatternOutcomes(),
    ]);
    const outcomes = [...ledgerOutcomes, ...patternOutcomes];
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
  // R5 / N15 - EFFECT-SIZE REWEIGHT (outside the pure scorer): the win-rate prior
  // above learns how OFTEN moves like this won; this second, independent multiplier
  // learns how MUCH they moved clicks when they settled. Bounded [0.8, 1.3],
  // decided-only, >= 3 samples per (lever x page-type) bucket with backoff to the
  // lever then the site mean, ~90 day recency half-life, shrunken toward the site
  // mean so a thin bucket tilts gently. Byte-identical ranking when no level has
  // 3+ usable settled magnitudes (pinned). Fail-soft -> current moves.
  try {
    const effectObservations = await loadEffectObservations(tenantId);
    if (effectObservations.length > 0) {
      moves = applyEffectSizePriorToMoves(moves, effectObservations, (m) => ({
        leverFamily: canonicalMoveType(m.gap),
        pageType: pageTypeFromUrl(m.ownedUrl ?? ""),
      }));
    }
  } catch {
    /* additive - never let the magnitude layer break the graph */
  }
  // PAGE-SPECIFIC outcome caution (2026-06-28), complements the pattern-level prior
  // above with THIS page's own shipped changes: hold a Move while its page is mid-
  // measurement, demote a no-lift repeat, modestly boost a follow-up on a page that
  // lifted. Bounded ±10%, OUTSIDE the pure scorer, fail-soft. Reuses the Results-linker
  // page+family matching. No shipped changes → neutral (byte-identical order).
  try {
    const proofRows = await loadProofOutcomeRows(tenantId);
    if (proofRows.length > 0) moves = applyProofOutcomeCautionToMoves(moves, proofRows);
  } catch {
    /* additive, never let it break the graph */
  }
  // R23 P15 - LEARN FROM SKIPS (do-not-repeat + kind demotion), OUTSIDE the pure
  // scorer. Never re-suggest an exact thing the operator already rejected or that
  // is already shipped/live, and gently deprioritize a KIND of move they keep
  // skipping (>= 3 dismissals, bounded [0.8, 1.0]). DECIDED-ONLY: a fresh tenant
  // with no dismissals and no shipped changes gets its moves back UNCHANGED
  // (byte-identical). Fail-soft; raw MoveComponents are never touched.
  try {
    const signals = await loadDismissalSignals(tenantId);
    if (signals.doNotRepeat.length > 0 || signals.dismissals.length > 0) {
      const learned = applyDismissalLearning(moves, signals);
      moves = learned.moves;
      if (learned.suppressed.length > 0 || learned.demotions.length > 0) {
        log.info("[load-graph] dismissal learning", {
          tenantId,
          suppressed: learned.suppressed.length,
          suppressedLabels: learned.suppressed.map((s) => s.label),
          demotedKinds: learned.demotions.map((d) => `${d.kind}(x${d.dismissals})`),
        });
      }
    }
  } catch {
    /* additive - never let the skip-learning layer break the graph */
  }
  // Profound AEO EVIDENCE fusion (evidence-only; no score change, no new actions).
  // Reads the DURABLE cached store (loadCachedPromptOpportunities, NO live
  // Profound API on render), time-boxed + fail-soft so it can never hang or break
  // the cockpit. Attaches `aeoEvidence` to matched Moves so a card can say "AI is
  // asked X, fans out into Y, cites these competitors, you're absent". The
  // coverage compiler's internal_link_fix/consolidate decisions are NOT promoted
  // to customer Moves here, they stay in the operator coverage diagnostic.
  try {
    // The read was started at the top (concurrent with the graph loaders); this
    // is almost always already resolved, so the await adds ~0. Time-boxed as a
    // safety net so a slow Supabase read can never delay the graph.
    const aeo = await Promise.race([
      aeoEvidencePromise,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
    ]);
    if (aeo && aeo.opportunities.length > 0) {
      moves = attachProfoundEvidenceToMoves(moves, aeo.opportunities);
    }
  } catch {
    // evidence is additive, never let it affect the graph
  }
  // UX0 ownership gate (2026-07-02), a create_page Move whose own AEO evidence shows
  // the tenant is ALREADY cited for this topic must never say "you have no page yet"
  // (ground-truth: "Persian Literature" pitched as missing while iranopedia.com's own
  // URL was in the cited pages). Runs right after the AEO attach (needs aeoEvidence)
  // and BEFORE canonicalization (a reclassified move must not merge as a sibling).
  //
  // N2 (2026-07-02), extended to a SUPERSET check: the ownership registry
  // (src/domains/ownership/registry.ts) also knows when Google's own GSC
  // impressions or a SERP-overlap intent cluster already send this topic to
  // one of the tenant's own pages, even when AI never cited it. Reuses the
  // GSC signal map already loaded above (no second GSC read); the registry's
  // own two reads (GSC cannibalization RPC + intent clusters) are the only
  // new I/O, and both are already-computed, already-stored, $0 sources other
  // engines read too. Fail-soft: a registry load failure just means this run
  // falls back to the citation-only gate (`gateCreatePageOwnershipWithRegistry`
  // treats a missing/empty registry as a no-op superset).
  let ownershipReclassified: ReturnType<typeof gateCreatePageOwnershipWithRegistry>["changes"] = [];
  try {
    const registry = await loadOwnershipRegistryForTenant(tenantId, { gscSignals: gsc, ownDomain: ownedDomain }).catch(() => null);
    const gated = gateCreatePageOwnershipWithRegistry(moves, registry);
    moves = gated.moves;
    ownershipReclassified = gated.changes;
    if (ownershipReclassified.length > 0) {
      log.info("[load-graph] create_page ownership gate", {
        tenantId,
        reclassified: ownershipReclassified.filter((c) => c.action === "reclassified").length,
        dropped: ownershipReclassified.filter((c) => c.action === "dropped").length,
        labels: ownershipReclassified.map((c) => c.label),
      });
    }
  } catch (e) {
    log.warn("[load-graph] create_page ownership gate skipped", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  // Canonicalize near-duplicate create_page moves (2026-06-29), the 3 nowruz labels,
  // persian/iranian wedding, etc. collapse to ONE canonical move per opportunity so
  // EVERY consumer (New Pages board, ActionPack worklist, prepare-verdicts) sees one
  // card. Reuses the cached keyword-volume + drafts read kicked off at the top, so it
  // adds ~0 wall-clock. Conservative + fail-soft (any throw → siblings remain, no break).
  try {
    const [keywords, drafts] = await collapseInputsPromise;
    moves = collapseCreatePageSiblings(moves, { keywords, drafts });
  } catch (e) {
    // additive dedup, never break the graph, but don't degrade SILENTLY (the New
    // Pages board would then show un-collapsed siblings with no "Also covers" line).
    log.warn("[load-graph] create_page canonicalization skipped", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  // N5 information-gain gate (2026-07-03, R8), the law that unfreezes the page
  // factories: a create_page Move whose persisted brief + torn-down competitors
  // can actually be compared must ADD something the cited winners do not already
  // say. duplicate_of_serp -> reclassify to edit_page at a known owned URL, else
  // drop with the honest reason; thin_addition -> demoted below every
  // adds_something row. A Move with no brief or no teardown evidence is
  // UNCHECKED and untouched, never block on missing data, never fake a check
  // (byte-identical no-op pinned in info-gain-gate tests). Runs AFTER the
  // ownership gate + sibling collapse so it scores the canonical survivors.
  let infoGainChanges: InfoGainChange[] = [];
  try {
    if (moves.some((m) => m.gap === "create_page")) {
      const [, drafts] = await collapseInputsPromise;
      const audits = await getCompetitorAuditsForTenant().catch(() => new Map());
      const inputs = buildCreatePageInfoGainInputs({
        moves,
        auditsByUrl: audits,
        drafts,
        canonicalize: canonicalizeCitationUrl,
      });
      const gated = gateCreatePageInfoGain(moves, inputs);
      moves = gated.moves;
      infoGainChanges = gated.changes;
      if (infoGainChanges.length > 0) {
        log.info("[load-graph] create_page info-gain gate", {
          tenantId,
          dropped: infoGainChanges.filter((c) => c.action === "dropped").length,
          reclassified: infoGainChanges.filter((c) => c.action === "reclassified").length,
          demoted: infoGainChanges.filter((c) => c.action === "demoted").length,
          labels: infoGainChanges.map((c) => c.label),
        });
      }
    }
  } catch (e) {
    log.warn("[load-graph] create_page info-gain gate skipped", { tenantId, error: e instanceof Error ? e.message : String(e) });
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
      coherence: {
        suppressedCandidates: coherenceSuppressed.map((s) => ({ label: s.label, reason: s.reason })),
        trimmedCandidates: coherenceDropped.map((d) => ({ label: d.label, droppedCount: d.droppedUrls.length, reason: d.reason })),
      },
      ownershipReclassified: ownershipReclassified.map((c) => ({ label: c.label, action: c.action, ownedUrl: c.ownedUrl, reason: c.reason })),
      infoGain: infoGainChanges.map((c) => ({ label: c.label, action: c.action, verdict: c.verdict, reason: c.reason })),
    },
  };
}
