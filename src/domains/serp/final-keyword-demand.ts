import "server-only";

import { readGraphSnapshot } from "@/domains/demand-graph/graph-snapshot-store";
import { loadGapVerdictsForTenant } from "@/domains/demand-graph/native-teardown-runner";
import { loadStealBriefsForTenant } from "./serp-steal-lane";
import {
  readAllCachedKeywordDemand,
  runKeywordVolume,
  type KeywordDemand,
  type KeywordsRunResult,
} from "./dataforseo-keywords";

export const MAX_FINAL_KEYWORD_QUERIES = 25;

export type FinalKeywordDemandResult = {
  status: KeywordsRunResult["status"] | "already_fresh";
  candidates: number;
  missing: number;
  checked: number;
  withVolume: number;
  costUsd: number;
};

export type FinalKeywordDemandDeps = {
  loadGraphQueries: (tenantId: string) => Promise<string[]>;
  loadGapQueries: (tenantId: string) => Promise<string[]>;
  loadStealQueries: (tenantId: string) => Promise<string[]>;
  loadCached: () => Promise<KeywordDemand[]>;
  runVolume: typeof runKeywordVolume;
};

const norm = (value: string) => value.trim().toLocaleLowerCase("en-US").replace(/\s+/g, " ");

/** Priority is newly discovered AI gaps, then proven SERP steals, then graph moves. */
export function planFinalKeywordQueries(input: {
  gapQueries: readonly string[];
  stealQueries: readonly string[];
  graphQueries: readonly string[];
  cachedQueries: ReadonlySet<string>;
  maxQueries?: number;
}): { candidates: string[]; missing: string[] } {
  const max = Math.max(0, Math.min(input.maxQueries ?? MAX_FINAL_KEYWORD_QUERIES, MAX_FINAL_KEYWORD_QUERIES));
  const candidates = [...new Set(
    [...input.gapQueries, ...input.stealQueries, ...input.graphQueries]
      .map(norm)
      .filter((query) => query.length >= 2),
  )].slice(0, max);
  return {
    candidates,
    missing: candidates.filter((query) => !input.cachedQueries.has(query)),
  };
}

const defaultDeps: FinalKeywordDemandDeps = {
  loadGraphQueries: async (tenantId) => {
    const snapshot = await readGraphSnapshot(tenantId).catch(() => null);
    return snapshot?.data.graph.moves
      .filter((move) => move.gap !== "healthy" && move.gap !== "low_demand")
      .map((move) => move.label) ?? [];
  },
  loadGapQueries: async (tenantId) => (await loadGapVerdictsForTenant(tenantId)).map((row) => row.promptText),
  loadStealQueries: async (tenantId) => (await loadStealBriefsForTenant(tenantId)).map((row) => row.keyword),
  loadCached: () => readAllCachedKeywordDemand(),
  runVolume: (queries, opts) => runKeywordVolume(queries, opts),
};

/**
 * Complete keyword demand for the candidate pool immediately before the one
 * final allocator run. This is visit-runner only, never a render path. It
 * reuses the existing DataForSEO cache, dry-run, ledger, breaker, and monthly
 * cap and makes at most one bounded volume call.
 */
export async function completeFinalKeywordDemandForTenant(
  tenantId: string,
  opts: { maxQueries?: number } = {},
  depsOverride: Partial<FinalKeywordDemandDeps> = {},
): Promise<FinalKeywordDemandResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const [gapQueries, stealQueries, graphQueries, cached] = await Promise.all([
    deps.loadGapQueries(tenantId).catch(() => []),
    deps.loadStealQueries(tenantId).catch(() => []),
    deps.loadGraphQueries(tenantId).catch(() => []),
    deps.loadCached().catch(() => []),
  ]);
  const cachedQueries = new Set(cached.map((row) => norm(row.keyword)));
  const plan = planFinalKeywordQueries({ gapQueries, stealQueries, graphQueries, cachedQueries, maxQueries: opts.maxQueries });
  if (plan.missing.length === 0) {
    return { status: "already_fresh", candidates: plan.candidates.length, missing: 0, checked: 0, withVolume: 0, costUsd: 0 };
  }
  const result = await deps.runVolume(plan.missing).catch(() => null);
  if (!result) {
    return { status: "error", candidates: plan.candidates.length, missing: plan.missing.length, checked: 0, withVolume: 0, costUsd: 0 };
  }
  return {
    status: result.status,
    candidates: plan.candidates.length,
    missing: plan.missing.length,
    checked: result.keywords.length,
    withVolume: result.keywords.filter((row) => row.searchVolume != null).length,
    costUsd: result.costUsd,
  };
}
