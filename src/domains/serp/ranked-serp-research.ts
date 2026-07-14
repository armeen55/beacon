import "server-only";

import type { RankedUnifiedEntry } from "@/domains/allocator/unified-list";
import {
  auditCompetitorUrls,
  type CompetitorPageAudit,
} from "@/domains/demand-graph/competitor-page-audit";
import { competitorRelevance, isNoiseDomain } from "@/domains/evidence/relevance-gate";
import { runSerpQuery, type SerpRunResult } from "./dataforseo-serp";
import { rootDomain } from "./serp-provider";

export type RankedSerpResearchResult = {
  entries: RankedUnifiedEntry[];
  byQuery: Map<string, SerpRunResult>;
  queriesChecked: number;
  winnerPagesAnalyzed: number;
  winnerPagesFromCache: number;
  costUsd: number;
};

export type RankedSerpResearchDeps = {
  runSerp: typeof runSerpQuery;
  auditUrls: (urls: readonly string[]) => Promise<{ audits: CompetitorPageAudit[]; fromCache: number }>;
};

const defaultDeps: RankedSerpResearchDeps = {
  runSerp: (query, opts) => runSerpQuery(query, opts),
  auditUrls: (urls) => auditCompetitorUrls(urls),
};

const norm = (value: string) => value.trim().toLocaleLowerCase("en-US");

function ownDomains(entries: readonly RankedUnifiedEntry[]): Set<string> {
  return new Set(entries.map((entry) => rootDomain(entry.page ?? "")).filter(Boolean));
}

/**
 * Research the exact final Changes order before packets are compiled. One
 * guarded/cache-first SERP read per top entry, then at most two on-topic organic
 * winners per query are torn down through the existing polite cached auditor.
 * No ranking happens here: the input order and scores are preserved byte for
 * byte; only grounded winner URLs are added to each entry's evidence receipt.
 */
export async function researchFinalRankedSerps(
  entries: readonly RankedUnifiedEntry[],
  opts: { maxEntries?: number; winnersPerQuery?: number } = {},
  depsOverride: Partial<RankedSerpResearchDeps> = {},
): Promise<RankedSerpResearchResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const maxEntries = Math.max(0, Math.min(opts.maxEntries ?? 10, 10));
  const winnersPerQuery = Math.max(1, Math.min(opts.winnersPerQuery ?? 2, 3));
  const owners = ownDomains(entries);
  const byQuery = new Map<string, SerpRunResult>();
  const winnersById = new Map<string, string[]>();
  let queriesChecked = 0;
  let costUsd = 0;

  for (const entry of entries.slice(0, maxEntries)) {
    const query = entry.query.trim();
    if (!query) continue;
    const result = await deps.runSerp(query, { depth: 10 }).catch(() => null);
    if (!result) continue;
    byQuery.set(norm(query), result);
    costUsd += result.costUsd;
    if ((result.status !== "ok" && result.status !== "cache_hit") || !result.snapshot) continue;
    queriesChecked += 1;
    const winners = [...result.snapshot.results]
      .sort((a, b) => a.rank - b.rank)
      .filter((row) => !owners.has(rootDomain(row.url)))
      .filter((row) => !isNoiseDomain(row.url))
      .filter((row) => competitorRelevance(query, { url: row.url, title: row.title }).relevant)
      .slice(0, winnersPerQuery)
      .map((row) => row.url);
    if (winners.length > 0) winnersById.set(entry.id, winners);
  }

  const winnerUrls = [...new Set([...winnersById.values()].flat())];
  const audited = winnerUrls.length > 0
    ? await deps.auditUrls(winnerUrls).catch(() => ({ audits: [] as CompetitorPageAudit[], fromCache: 0 }))
    : { audits: [] as CompetitorPageAudit[], fromCache: 0 };
  const analyzedUrls = new Set(
    audited.audits
      .filter((audit) => audit.fetchStatus === "ok" && audit.facts != null)
      .map((audit) => audit.url),
  );
  const enriched = entries.map((entry) => {
    const winners = winnersById.get(entry.id) ?? [];
    if (winners.length === 0) return entry;
    return {
      ...entry,
      competitorUrls: [...new Set([...winners, ...entry.competitorUrls])].slice(0, 8),
    };
  });

  return {
    entries: enriched,
    byQuery,
    queriesChecked,
    winnerPagesAnalyzed: analyzedUrls.size,
    winnerPagesFromCache: audited.fromCache,
    costUsd: Number(costUsd.toFixed(3)),
  };
}
