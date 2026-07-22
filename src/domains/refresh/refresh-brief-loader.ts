/**
 * refresh/refresh-brief-loader (BEACON_500 item 56) - the bounded I/O that feeds the PURE
 * buildRefreshBrief for a small, already-ranked set of fading pages. Every read here is an
 * EXISTING $0 reader, page-scoped and capped:
 *
 *   - loadTopQueriesForPages / loadQueryDeclinesForPages (gsc_daily_rows, `page IN (...)`,
 *     <= 25 pages, ROW_BUDGET-capped - the worklist's own per-page query readers)
 *   - getPageSnapshots (the cached crawl, one read for the batch) for the page's own H2s
 *   - loadChangePacksForTenant (the cached demand-graph + competitor-teardown fusion the
 *     daily preview already reads) for the winner's sections, with the SAME relevance gate
 *     build-today-preview applies (on-topic, not loosely matched)
 *
 * Fail-soft everywhere: a missing source produces an honestly thinner brief, never an error
 * and never a fabricated evidence line.
 */

import "server-only";

import {
  loadTopQueriesForPages,
  loadQueryDeclinesForPages,
} from "@/domains/recommendation-intelligence/gsc-page-queries";
import { getPageSnapshots } from "@/domains/pages/snapshot-store";
import { loadChangePacksForTenant } from "@/domains/demand-graph/gap-compiler";
/** Path normalizer (inlined; the daily-experiment domain that owned it was removed). */
function normalizePath(u: string | null | undefined): string {
  if (!u) return "";
  return ((u.replace(/^https?:\/\/[^/]+/i, "") || "/").replace(/[?#].*$/, "").replace(/\/+$/, "") || "/").toLowerCase();
}
import type { PageSnapshot } from "@/domains/pages/types";
import type { RefreshCandidateRank } from "./decay-queue";
import { buildRefreshBrief, type RefreshBrief, type LosingQuery } from "./refresh-brief";

/** The per-page query readers bound their IN-lists to 25 pages; the refresh queue never
 *  needs more than a handful anyway. */
const MAX_BRIEF_PAGES = 10;

type CompetitorForBrief = { domain: string; outline: string[]; freshnessDate: string | null };

/**
 * Build full refresh briefs for a small ranked set of fading pages. Bounded (MAX_BRIEF_PAGES),
 * fail-soft per source: any reader that errors just leaves its evidence part empty.
 */
export async function loadRefreshBriefsForTenant(
  tenantId: string,
  ranks: readonly RefreshCandidateRank[],
): Promise<RefreshBrief[]> {
  const bounded = ranks.slice(0, MAX_BRIEF_PAGES);
  if (!tenantId || bounded.length === 0) return [];
  const pages = bounded.map((r) => r.page);

  const [topQueriesByPage, declinesByPage, snapshots, packsResult] = await Promise.all([
    loadTopQueriesForPages(tenantId, pages).catch(() => new Map<string, Array<{ query: string; impressions: number }>>()),
    loadQueryDeclinesForPages(tenantId, pages).catch(
      () => new Map<string, Array<{ query: string; priorClicks: number; recentClicks: number; dropPct: number }>>(),
    ),
    getPageSnapshots().catch(() => [] as PageSnapshot[]),
    loadChangePacksForTenant(tenantId, { limit: 120 }).catch(() => ({ packets: [] })),
  ]);

  // Own H2s by normalized path (the cached crawl's h2_list).
  const h2sByPath = new Map<string, string[]>();
  for (const s of snapshots) {
    if (!s.url) continue;
    h2sByPath.set(normalizePath(s.url), s.h2_list ?? []);
  }

  // On-topic competitor teardown by normalized owned-page path - the SAME gate
  // build-today-preview applies (relevance >= 0.3, never loosely matched, facts present).
  const competitorByPath = new Map<string, CompetitorForBrief>();
  for (const p of packsResult.packets ?? []) {
    const ownedUrl = p.yourPage?.url;
    const c = p.competitor;
    if (!ownedUrl || !c || !c.domain || !c.facts || c.looselyMatched || (c.relevance ?? 0) < 0.3) continue;
    const key = normalizePath(ownedUrl);
    if (competitorByPath.has(key)) continue; // first (highest-ranked move) wins
    competitorByPath.set(key, {
      domain: c.domain,
      outline: c.facts.outline ?? [],
      freshnessDate: c.facts.freshnessDate ?? null,
    });
  }

  return bounded.map((rank) => {
    const path = normalizePath(rank.page);
    const losingQueries: LosingQuery[] = (declinesByPage.get(rank.page) ?? []).map((d) => ({
      query: d.query,
      priorClicks: d.priorClicks,
      recentClicks: d.recentClicks,
      dropPct: d.dropPct,
    }));
    return buildRefreshBrief({
      rank,
      pageQueries: (topQueriesByPage.get(rank.page) ?? []).map((q) => ({ query: q.query, impressions: q.impressions })),
      ownH2s: h2sByPath.get(path) ?? [],
      losingQueries,
      competitor: competitorByPath.get(path) ?? null,
    });
  });
}
