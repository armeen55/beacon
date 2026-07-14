import "server-only";

import { log } from "@/lib/logger";
import {
  runRankedKeywords,
  runRankedKeywordsForPage,
  runRelatedKeywords,
  runDomainIntersection,
  readAllCachedKeywordDifficulty,
  LABS_COST_USD,
  PAGE_KEYWORDS_COST_USD,
  RELATED_KEYWORDS_COST_USD,
  type LabsRunResult,
  type LabsRunStatus,
  type RelatedKeywordRow,
} from "./dataforseo-labs";
import {
  computeKeywordGaps,
  pickGapCompetitorDomains,
  applyWinnabilityToGaps,
  type KeywordGap,
  type KeywordGapRow,
  type OwnedQuery,
} from "./keyword-gaps";
import { writeKeywordGapResults, type StoredKeywordGaps } from "./keyword-gap-store";
import { aggregateMoneyPages, pickTeardownTargets, type MoneyPage } from "./money-pages";
import { buildCloneBrief, type CloneBrief } from "./clone-brief";
import { writeCloneBriefResults } from "./clone-brief-store";
import {
  auditCompetitorPage,
  getCompetitorAuditsForTenant,
  isTeardownFresh,
  whatWins,
  type CompetitorPageAudit,
} from "@/domains/demand-graph/competitor-page-audit";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";

/**
 * keyword-gap-producer (2026-07-02, master plan items 16 + 60) - the
 * OPERATOR-TRIGGERED bounded batch behind "Find what competitors rank for". NO
 * cron wiring.
 *
 * Hard ceilings, by construction:
 *   - top MAX_COMPETITORS competitors only (from the demand graph's citation
 *     evidence, noise/reference domains filtered)
 *   - 2 discovery calls per competitor (ranked_keywords + domain_intersection),
 *     then for the top five proven pages one exact-page 500-keyword corpus and
 *     one maximum-width 1,000-keyword related-topic corpus
 *   - every call re-runs the full money gauntlet (cache -> dry-run -> shared cap)
 *     inside dataforseo-labs, so the cap is re-checked before EVERY call and a
 *     re-run within 30 days is served from cache for $0
 *   - every keyword corpus is retained in the 30-day cache and reused by the
 *     unified keyword library; compact receipts and winner blueprints flow to
 *     the recommendation path instead of giant raw responses
 *   - item 60 adds up to MAX_BRIEF_TEARDOWNS (5) bounded, polite, 14d-cached
 *     competitor page fetches through the existing teardown engine
 *
 * Item 18 wiring: every gap is labeled with computeWinnability from a CACHED
 * difficulty read (readAllCachedKeywordDifficulty - $0, no fresh Labs call) so an
 * unwinnable gap is shown honestly instead of silently queued as if it were equal
 * to a winnable one. Labeling only - a "reject" gap still appears, just marked.
 *
 * Dry-run safe: with DATAFORSEO_DRY_RUN unset/true this returns a priced plan
 * (which competitors, which calls, total estimate) and spends nothing.
 */

export const MAX_GAP_COMPETITORS = 3;
export const MAX_GAP_CALLS = MAX_GAP_COMPETITORS * 2;
/** Item 60: bounded teardown fetches per run - top 5 money pages, polite + cached. */
export const MAX_BRIEF_TEARDOWNS = 5;
/** One exact-page keyword corpus per teardown target, cached for 30 days. */
export const MAX_PAGE_KEYWORD_CALLS = MAX_BRIEF_TEARDOWNS;
export const MAX_RELATED_KEYWORD_CALLS = MAX_BRIEF_TEARDOWNS;
/** The documented per-run ceiling at conservative estimates: three domain pairs
 * plus five exact-page 500-keyword reads. */
export const MAX_GAP_RUN_COST_USD = Number(
  (MAX_GAP_CALLS * LABS_COST_USD + MAX_PAGE_KEYWORD_CALLS * PAGE_KEYWORDS_COST_USD + MAX_RELATED_KEYWORD_CALLS * RELATED_KEYWORDS_COST_USD).toFixed(2),
);

export type KeywordGapCallReceipt = {
  competitor: string;
  endpoint: "ranked_keywords" | "domain_intersection" | "page_ranked_keywords" | "related_keywords";
  status: LabsRunStatus;
  costUsd: number;
  rows: number;
};

export type KeywordGapRunResult = {
  status: "ok" | "dry_run" | "disabled" | "capped" | "no_competitors" | "error";
  competitors: string[];
  ownDomain: string;
  calls: KeywordGapCallReceipt[];
  /** Real money spent this run (0 on dry-run / cache-served runs). */
  spentUsd: number;
  /** What the still-unfetched calls would cost (the dry-run plan estimate). */
  plannedUsd: number;
  cacheHits: number;
  gapsFound: number;
  gaps: KeywordGap[];
  /** Item 60: traffic-weighted competitor money pages found from the SAME rows
   *  (top 20 per competitor, $0 marginal cost). Empty on dry-run/disabled/capped. */
  moneyPagesFound: number;
  /** Item 60: "their best page, our better version" briefs, bounded to the top
   *  MAX_BRIEF_TEARDOWNS money pages actually torn down this run. */
  cloneBriefs: CloneBrief[];
  /** Exact competitor pages researched beyond the domain-level discovery pass. */
  pagesDeepResearched?: number;
  /** Real page-level keyword rows returned across those pages. */
  pageKeywordsFound?: number;
  relatedKeywordsFound?: number;
  /** Operator-facing receipt. First person, concrete numbers, no dashes. */
  message: string;
};

export type ProduceKeywordGapsDeps = {
  now: () => Date;
  loadGraph: (tenantId: string) => Promise<{
    moves: ReadonlyArray<{ competitorUrls: string[]; label?: string; ownedUrl?: string | null }>;
    pageNodes: ReadonlyArray<{ url: string; isOwned: boolean }>;
  } | null>;
  loadOwnedQueries: (tenantId: string) => Promise<OwnedQuery[]>;
  runRanked: (domain: string) => Promise<LabsRunResult>;
  runIntersection: (competitorDomain: string, ownDomain: string) => Promise<LabsRunResult>;
  runPageRanked: (pageUrl: string) => Promise<LabsRunResult>;
  runRelated: (seedKeyword: string) => Promise<LabsRunResult<RelatedKeywordRow>>;
  writeResults: (r: StoredKeywordGaps) => Promise<void>;
  /** Item 60: cached-only difficulty read for the winnability labeling ($0). */
  readCachedDifficulty: () => Promise<Map<string, number | null>>;
  /** Item 60: the existing teardown cache, read-only (no fresh fetch). */
  readTeardownCache: () => Promise<Map<string, { fetchStatus: CompetitorPageAudit["fetchStatus"]; facts: CompetitorPageAudit["facts"]; auditedAt: string }>>;
  /** Item 60: ONE bounded, polite, cache-aware fetch of a competitor page. */
  auditPage: (url: string) => Promise<{ fetchStatus: CompetitorPageAudit["fetchStatus"]; facts: CompetitorPageAudit["facts"] }>;
  writeBriefs: (tenantId: string, briefs: CloneBrief[], now: Date) => Promise<void>;
};

// Default deps use lazy imports so tests (and the pure math) never drag the full
// demand-graph/Supabase import chain in - same fail-soft posture as json-store.
const defaultDeps: ProduceKeywordGapsDeps = {
  now: () => new Date(),
  loadGraph: async (tenantId) => {
    const { loadDemandGraphForTenantCached } = await import("@/domains/demand-graph/load-graph");
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    return {
      moves: graph.moves.map((m) => ({ competitorUrls: m.competitorUrls, label: m.label, ownedUrl: m.ownedUrl })),
      pageNodes: graph.pageNodes.map((p) => ({ url: p.url, isOwned: p.isOwned })),
    };
  },
  loadOwnedQueries: async (tenantId) => {
    const { loadTopTenantQueries } = await import("@/domains/recommendation-intelligence/gsc-page-queries");
    const qs = await loadTopTenantQueries(tenantId, { limit: 1000 });
    return qs.map((q) => ({ query: q.query, position: q.position ?? null }));
  },
  runRanked: (domain) => runRankedKeywords(domain),
  runIntersection: (competitorDomain, ownDomain) => runDomainIntersection(competitorDomain, ownDomain),
  runPageRanked: (pageUrl) => runRankedKeywordsForPage(pageUrl),
  runRelated: (seedKeyword) => runRelatedKeywords(seedKeyword),
  writeResults: (r) => writeKeywordGapResults(r),
  readCachedDifficulty: () => readAllCachedKeywordDifficulty(),
  readTeardownCache: async () => {
    const cache = await getCompetitorAuditsForTenant();
    const out = new Map<string, { fetchStatus: CompetitorPageAudit["fetchStatus"]; facts: CompetitorPageAudit["facts"]; auditedAt: string }>();
    for (const [key, a] of cache) out.set(key, { fetchStatus: a.fetchStatus, facts: a.facts, auditedAt: a.auditedAt });
    return out;
  },
  auditPage: async (url) => {
    const a = await auditCompetitorPage(url);
    return { fetchStatus: a.fetchStatus, facts: a.facts };
  },
  writeBriefs: (tenantId, briefs, now) => writeCloneBriefResults({ tenant_id: tenantId, computed_at: now.toISOString(), briefs }),
};

/** The tenant's own domain = the most common hostname across its owned pages. */
function deriveOwnDomain(pageNodes: ReadonlyArray<{ url: string; isOwned: boolean }>): string {
  const counts = new Map<string, number>();
  for (const p of pageNodes) {
    if (!p.isOwned) continue;
    try {
      const h = new URL(p.url).hostname.replace(/^www\./, "").toLowerCase();
      counts.set(h, (counts.get(h) ?? 0) + 1);
    } catch {
      /* skip unparseable */
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
}

const usd = (n: number): string => `$${n.toFixed(2)}`;

/**
 * Run the bounded competitor keyword gap batch for one tenant. Never throws.
 * Persists results only when real rows came back (cache or live), so a dry-run
 * plan never clobbers a previous real run.
 */
export async function produceKeywordGaps(
  tenantId: string,
  depsOverride: Partial<ProduceKeywordGapsDeps> = {},
): Promise<KeywordGapRunResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const empty = {
    calls: [] as KeywordGapCallReceipt[],
    spentUsd: 0,
    plannedUsd: 0,
    cacheHits: 0,
    gapsFound: 0,
    gaps: [] as KeywordGap[],
    moneyPagesFound: 0,
    cloneBriefs: [] as CloneBrief[],
    pagesDeepResearched: 0,
    pageKeywordsFound: 0,
    relatedKeywordsFound: 0,
  };

  let graph: Awaited<ReturnType<ProduceKeywordGapsDeps["loadGraph"]>> = null;
  try {
    graph = await deps.loadGraph(tenantId);
  } catch (e) {
    log.warn("[keyword-gaps] graph load failed", { tenantId, error: e instanceof Error ? e.message : String(e) });
  }
  const ownDomain = graph ? deriveOwnDomain(graph.pageNodes) : "";
  const competitors = graph ? pickGapCompetitorDomains(graph.moves, ownDomain, MAX_GAP_COMPETITORS) : [];
  if (competitors.length === 0) {
    return {
      status: "no_competitors",
      competitors: [],
      ownDomain,
      ...empty,
      message:
        "I do not have enough competitor evidence to pick targets yet. Sync your AI citation data first, then run this again.",
    };
  }

  const ownedQueries = await deps.loadOwnedQueries(tenantId).catch((): OwnedQuery[] => []);

  const calls: KeywordGapCallReceipt[] = [];
  const rows: KeywordGapRow[] = [];
  let spentUsd = 0;
  let plannedUsd = 0;
  let cacheHits = 0;

  // Sequential on purpose: the shared monthly cap is re-checked inside every call.
  for (const competitor of competitors) {
    const planned: Array<{ endpoint: KeywordGapCallReceipt["endpoint"]; run: () => Promise<LabsRunResult> }> = [
      { endpoint: "ranked_keywords", run: () => deps.runRanked(competitor) },
    ];
    if (ownDomain) {
      planned.push({ endpoint: "domain_intersection", run: () => deps.runIntersection(competitor, ownDomain) });
    }
    for (const p of planned) {
      const r = await p.run();
      calls.push({ competitor, endpoint: p.endpoint, status: r.status, costUsd: r.costUsd, rows: r.rows.length });
      spentUsd += r.costUsd;
      if (r.status === "cache_hit") cacheHits += 1;
      if (r.status === "dry_run") plannedUsd += r.plan.estCostUsd;
      if (r.status === "ok" || r.status === "cache_hit") rows.push(...r.rows);
    }
  }
  spentUsd = Number(spentUsd.toFixed(2));
  plannedUsd = Number(plannedUsd.toFixed(2));

  const names = competitors.join(", ");

  // No rows at all: report the honest reason (dry-run plan, disabled, capped).
  if (rows.length === 0) {
    if (calls.some((c) => c.status === "dry_run")) {
      return {
        status: "dry_run",
        competitors,
        ownDomain,
        calls,
        spentUsd: 0,
        plannedUsd,
        cacheHits,
        gapsFound: 0,
        gaps: [],
        moneyPagesFound: 0,
        cloneBriefs: [],
        pagesDeepResearched: 0,
        pageKeywordsFound: 0,
        relatedKeywordsFound: 0,
        message: `Dry run only, I spent nothing. I would check ${competitors.length} competitors (${names}) with ${calls.length} Google index lookups for about ${usd(plannedUsd)}. Turn dry run off and click again to fetch the real list.`,
      };
    }
    if (calls.every((c) => c.status === "disabled")) {
      return {
        status: "disabled",
        competitors,
        ownDomain,
        calls,
        spentUsd: 0,
        plannedUsd: 0,
        cacheHits: 0,
        gapsFound: 0,
        gaps: [],
        moneyPagesFound: 0,
        cloneBriefs: [],
        pagesDeepResearched: 0,
        pageKeywordsFound: 0,
        relatedKeywordsFound: 0,
        message: "DataForSEO is not connected, so I cannot check competitor keywords yet. Add the DataForSEO key first.",
      };
    }
    if (calls.some((c) => c.status === "capped")) {
      return {
        status: "capped",
        competitors,
        ownDomain,
        calls,
        spentUsd,
        plannedUsd: 0,
        cacheHits,
        gapsFound: 0,
        gaps: [],
        moneyPagesFound: 0,
        cloneBriefs: [],
        pagesDeepResearched: 0,
        pageKeywordsFound: 0,
        relatedKeywordsFound: 0,
        message: "I stopped before spending: this month's DataForSEO budget is already used up. I will not go over the cap.",
      };
    }
    return {
      status: "error",
      competitors,
      ownDomain,
      calls,
      spentUsd,
      plannedUsd: 0,
      cacheHits,
      gapsFound: 0,
      gaps: [],
      moneyPagesFound: 0,
      cloneBriefs: [],
      pagesDeepResearched: 0,
      pageKeywordsFound: 0,
      relatedKeywordsFound: 0,
      message: `I checked ${competitors.length} competitors (${names}) but the lookups came back empty. Nothing beyond ${usd(spentUsd)} was spent. Try again later.`,
    };
  }

  // The domain pass discovers which URLs matter. Now research the top five exact
  // pages, sequentially, through the same cache/dry-run/cap guard. This turns a
  // ten-keyword hint into a bounded corpus of up to 500 real keywords per winner.
  const discoveredMoneyPages = aggregateMoneyPages(rows);
  const pageResearch = new Map<string, {
    status: LabsRunStatus;
    keywordCount: number;
    relatedKeywordCount: number;
    withVolume: number;
    totalSearchVolume: number;
  }>();
  for (const page of pickTeardownTargets(discoveredMoneyPages, MAX_PAGE_KEYWORD_CALLS)) {
    const r = await deps.runPageRanked(page.url);
    calls.push({ competitor: page.url, endpoint: "page_ranked_keywords", status: r.status, costUsd: r.costUsd, rows: r.rows.length });
    spentUsd += r.costUsd;
    if (r.status === "cache_hit") cacheHits += 1;
    if (r.status === "dry_run") plannedUsd += r.plan.estCostUsd;
    if (r.status === "ok" || r.status === "cache_hit") {
      rows.push(...r.rows);
      pageResearch.set(page.url, {
        status: r.status,
        keywordCount: r.rows.length,
        relatedKeywordCount: 0,
        withVolume: r.rows.filter((row) => row.volume != null).length,
        totalSearchVolume: r.rows.reduce((sum, row) => sum + (row.volume ?? 0), 0),
      });
    } else {
      pageResearch.set(page.url, { status: r.status, keywordCount: 0, relatedKeywordCount: 0, withVolume: 0, totalSearchVolume: 0 });
    }

    const seed = page.topKeywords[0]?.keyword?.trim() ?? "";
    if (seed) {
      const related = await deps.runRelated(seed);
      calls.push({ competitor: page.url, endpoint: "related_keywords", status: related.status, costUsd: related.costUsd, rows: related.rows.length });
      spentUsd += related.costUsd;
      if (related.status === "cache_hit") cacheHits += 1;
      if (related.status === "dry_run") plannedUsd += related.plan.estCostUsd;
      const prior = pageResearch.get(page.url)!;
      if (related.status === "ok" || related.status === "cache_hit") {
        pageResearch.set(page.url, {
          ...prior,
          relatedKeywordCount: related.rows.length,
          withVolume: prior.withVolume + related.rows.filter((row) => row.volume != null).length,
          totalSearchVolume: prior.totalSearchVolume + related.rows.reduce((sum, row) => sum + (row.volume ?? 0), 0),
        });
      }
    }
  }
  spentUsd = Number(spentUsd.toFixed(2));
  plannedUsd = Number(plannedUsd.toFixed(2));

  let gaps = computeKeywordGaps({ rows, ownedQueries, ownDomain });

  // Item 18 wiring: label every gap with a CACHED-ONLY difficulty read ($0, no
  // fresh Labs call). Fail-soft: a broken cache read just leaves gaps unlabeled.
  try {
    const cachedDifficulty = await deps.readCachedDifficulty();
    gaps = applyWinnabilityToGaps(gaps, cachedDifficulty);
  } catch (e) {
    log.warn("[keyword-gaps] cached difficulty read failed (gaps stay unlabeled)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const now = deps.now();
  try {
    await deps.writeResults({
      tenant_id: tenantId,
      computed_at: now.toISOString(),
      own_domain: ownDomain,
      competitors,
      spent_usd: spentUsd,
      gaps,
    });
  } catch (e) {
    log.warn("[keyword-gaps] persist failed (results still returned)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  // Item 60: money-page aggregation from the SAME rows above, $0 marginal cost.
  const moneyPages = aggregateMoneyPages(rows);
  const cloneBriefs = await buildCloneBriefsForRun({ moneyPages, graph, deps, pageResearch }).catch((e) => {
    log.warn("[clone-brief] brief build failed (gaps still returned)", {
      tenantId,
      error: e instanceof Error ? e.message : String(e),
    });
    return [] as CloneBrief[];
  });
  if (cloneBriefs.length > 0) {
    try {
      await deps.writeBriefs(tenantId, cloneBriefs, now);
    } catch (e) {
      log.warn("[clone-brief] persist failed (briefs still returned)", {
        tenantId,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const cacheNote =
    cacheHits > 0 ? ` ${cacheHits} of ${calls.length} lookups came from my 30 day cache at no extra cost.` : "";
  const briefNote = cloneBriefs.length > 0 ? ` I also built ${cloneBriefs.length} clone-and-beat brief${cloneBriefs.length === 1 ? "" : "s"} from their top money pages.` : "";
  const pageResearchNote = pageResearch.size > 0
    ? ` I deeply researched ${pageResearch.size} winning page${pageResearch.size === 1 ? "" : "s"} and cached ${[...pageResearch.values()].reduce((sum, row) => sum + row.keywordCount, 0).toLocaleString("en-US")} page-ranking keywords plus ${[...pageResearch.values()].reduce((sum, row) => sum + row.relatedKeywordCount, 0).toLocaleString("en-US")} broader topic keywords.`
    : "";
  return {
    status: "ok",
    competitors,
    ownDomain,
    calls,
    spentUsd,
    plannedUsd,
    cacheHits,
    gapsFound: gaps.length,
    gaps,
    moneyPagesFound: moneyPages.length,
    cloneBriefs,
    pagesDeepResearched: [...pageResearch.values()].filter((row) => row.keywordCount > 0).length,
    pageKeywordsFound: [...pageResearch.values()].reduce((sum, row) => sum + row.keywordCount, 0),
    relatedKeywordsFound: [...pageResearch.values()].reduce((sum, row) => sum + row.relatedKeywordCount, 0),
    message: `I checked ${competitors.length} competitors on Google's index for ${usd(spentUsd)} and found ${gaps.length} keywords they win that you do not.${cacheNote}${pageResearchNote}${briefNote} The best ones are on the New Pages board now.`,
  };
}

/**
 * Item 60: build the bounded (MAX_BRIEF_TEARDOWNS) set of clone-and-beat briefs
 * for this run - top money pages, torn down through the EXISTING teardown cache
 * (14d fresh -> reused free; stale/missing -> ONE polite fetch each, never a paid
 * API). Fail-soft per URL: one bad fetch never drops the whole batch.
 */
async function buildCloneBriefsForRun(args: {
  moneyPages: readonly MoneyPage[];
  graph: Awaited<ReturnType<ProduceKeywordGapsDeps["loadGraph"]>>;
  deps: ProduceKeywordGapsDeps;
  pageResearch: ReadonlyMap<string, { status: LabsRunStatus; keywordCount: number; relatedKeywordCount: number; withVolume: number; totalSearchVolume: number }>;
}): Promise<CloneBrief[]> {
  const { moneyPages, graph, deps, pageResearch } = args;
  const targets = pickTeardownTargets(moneyPages, MAX_BRIEF_TEARDOWNS);
  if (targets.length === 0) return [];

  const ownedTopics = (graph?.moves ?? [])
    .filter((m) => m.ownedUrl)
    .map((m) => m.label)
    .filter((l): l is string => Boolean(l));

  const teardownCache = await deps.readTeardownCache().catch(() => new Map());
  const nowMs = deps.now().getTime();

  const briefs: CloneBrief[] = [];
  for (const page of targets) {
    const key = canonicalizeCitationUrl(page.url) || page.url;
    const cached = teardownCache.get(key);
    let audit: { fetchStatus: CompetitorPageAudit["fetchStatus"]; facts: CompetitorPageAudit["facts"] } | null = null;
    if (cached && cached.fetchStatus === "ok" && isTeardownFresh(cached.auditedAt, nowMs)) {
      audit = { fetchStatus: cached.fetchStatus, facts: cached.facts };
    } else {
      audit = await deps.auditPage(page.url).catch(() => null);
    }
    // whatWins() returns a bare em dash when facts is null (dash-clean is THIS
    // module's rule, not that one's) - only call it when there is something real
    // to describe; an "ok" fetch with no facts stays honestly null.
    const wins = audit?.fetchStatus === "ok" && audit.facts ? whatWins(audit.facts) : null;
    briefs.push(buildCloneBrief({ page, audit, whatWins: wins, ownedTopics, keywordResearch: pageResearch.get(page.url) ?? null }));
  }
  return briefs;
}
