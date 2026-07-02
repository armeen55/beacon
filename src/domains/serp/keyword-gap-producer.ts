import "server-only";

import { log } from "@/lib/logger";
import {
  runRankedKeywords,
  runDomainIntersection,
  LABS_COST_USD,
  type LabsRunResult,
  type LabsRunStatus,
} from "./dataforseo-labs";
import {
  computeKeywordGaps,
  pickGapCompetitorDomains,
  type KeywordGap,
  type KeywordGapRow,
  type OwnedQuery,
} from "./keyword-gaps";
import { writeKeywordGapResults, type StoredKeywordGaps } from "./keyword-gap-store";

/**
 * keyword-gap-producer (2026-07-02, master plan item 16) - the OPERATOR-TRIGGERED
 * bounded batch behind "Find what competitors rank for". NO cron wiring.
 *
 * Hard ceilings, by construction:
 *   - top MAX_COMPETITORS competitors only (from the demand graph's citation
 *     evidence, noise/reference domains filtered)
 *   - 2 calls per competitor (ranked_keywords + domain_intersection) = at most
 *     MAX_COMPETITORS * 2 calls, ~$0.66 at the conservative $0.11/call estimate
 *   - every call re-runs the full money gauntlet (cache -> dry-run -> shared cap)
 *     inside dataforseo-labs, so the cap is re-checked before EVERY call and a
 *     re-run within 30 days is served from cache for $0
 *
 * Dry-run safe: with DATAFORSEO_DRY_RUN unset/true this returns a priced plan
 * (which competitors, which calls, total estimate) and spends nothing.
 */

export const MAX_GAP_COMPETITORS = 3;
export const MAX_GAP_CALLS = MAX_GAP_COMPETITORS * 2;
/** The documented per-run ceiling at the conservative estimate. */
export const MAX_GAP_RUN_COST_USD = Number((MAX_GAP_CALLS * LABS_COST_USD).toFixed(2));

export type KeywordGapCallReceipt = {
  competitor: string;
  endpoint: "ranked_keywords" | "domain_intersection";
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
  /** Operator-facing receipt. First person, concrete numbers, no dashes. */
  message: string;
};

export type ProduceKeywordGapsDeps = {
  now: () => Date;
  loadGraph: (tenantId: string) => Promise<{
    moves: ReadonlyArray<{ competitorUrls: string[] }>;
    pageNodes: ReadonlyArray<{ url: string; isOwned: boolean }>;
  } | null>;
  loadOwnedQueries: (tenantId: string) => Promise<OwnedQuery[]>;
  runRanked: (domain: string) => Promise<LabsRunResult>;
  runIntersection: (competitorDomain: string, ownDomain: string) => Promise<LabsRunResult>;
  writeResults: (r: StoredKeywordGaps) => Promise<void>;
};

// Default deps use lazy imports so tests (and the pure math) never drag the full
// demand-graph/Supabase import chain in - same fail-soft posture as json-store.
const defaultDeps: ProduceKeywordGapsDeps = {
  now: () => new Date(),
  loadGraph: async (tenantId) => {
    const { loadDemandGraphForTenantCached } = await import("@/domains/demand-graph/load-graph");
    const { graph } = await loadDemandGraphForTenantCached(tenantId);
    return {
      moves: graph.moves.map((m) => ({ competitorUrls: m.competitorUrls })),
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
  writeResults: (r) => writeKeywordGapResults(r),
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
      message: `I checked ${competitors.length} competitors (${names}) but the lookups came back empty. Nothing beyond ${usd(spentUsd)} was spent. Try again later.`,
    };
  }

  const gaps = computeKeywordGaps({ rows, ownedQueries, ownDomain });
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

  const cacheNote =
    cacheHits > 0 ? ` ${cacheHits} of ${calls.length} lookups came from my 30 day cache at no extra cost.` : "";
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
    message: `I checked ${competitors.length} competitors on Google's index for ${usd(spentUsd)} and found ${gaps.length} keywords they win that you do not.${cacheNote} The best ones are on the New Pages board now.`,
  };
}
