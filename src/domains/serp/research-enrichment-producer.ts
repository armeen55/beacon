/**
 * research-enrichment-producer (2026-06-29) — the OPERATOR-TRIGGERED DataForSEO producer
 * for PageResearchPack. Populates the caches the research module reads:
 *   - keyword VOLUME (own + cross-link terms) via runKeywordVolume
 *   - SERP winner-title/format PATTERN (one per page primary intent) via runSerpQuery
 *
 * Safety: NEVER runs on the render path (called only from an operator action). DRY-RUN
 * is the DEFAULT — when DATAFORSEO_DRY_RUN !== "false" it reports the plan + estimate and
 * makes ZERO calls. Live mode rides the SAME shared DataForSEO monthly cap + 14d cache +
 * ledger as every other DataForSEO call (the gauntlets self-enforce). Fail-soft per call.
 */

import "server-only";

import { runKeywordVolume, readAllCachedKeywordDemand } from "./dataforseo-keywords";
import { runSerpQuery, isDryRun, isDataForSeoConfigured } from "./dataforseo-serp";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import {
  extractSerpPattern,
  planResearchEnrichment,
  type ResearchPackLite,
  type SerpPattern,
  type EnrichmentPlan,
} from "./research-enrichment";

/** Tenant-scoped cache of the SERP "what wins" pattern per query (see store-classification). */
const PATTERN_STORE = "research-serp-patterns";

const norm = (s: string) => s.trim().toLowerCase();

/** Read the cached SERP patterns (no call, $0) → query(lc) → pattern. For the consumer. */
export async function readCachedSerpPatterns(): Promise<Map<string, SerpPattern>> {
  const rows = await readStore<SerpPattern>(PATTERN_STORE, []).catch(() => [] as SerpPattern[]);
  const m = new Map<string, SerpPattern>();
  for (const r of rows) if (r?.query) m.set(norm(r.query), r);
  return m;
}

/** Merge freshly-extracted patterns into the tenant-scoped cache (idempotent by query). */
async function persistPatterns(fresh: SerpPattern[]): Promise<void> {
  if (fresh.length === 0) return;
  const existing = await readStore<SerpPattern>(PATTERN_STORE, []).catch(() => [] as SerpPattern[]);
  const byKey = new Map(existing.filter((p) => p?.query).map((p) => [norm(p.query), p]));
  for (const p of fresh) byKey.set(norm(p.query), p);
  await writeStore(PATTERN_STORE, [...byKey.values()]).catch(() => {});
}

/**
 * Item 29 - live SERP for tonight's selected picks' target queries (<= 8 a night, ~$0.02), so
 * the Google-results teammate almost never abstains on the batch. Rides the SAME gauntlet as
 * every DataForSEO call (14d cache, fail-closed monthly cap, ledger). Dry-run or unconfigured
 * -> $0 no-op. Fail-soft per query.
 */
export async function enrichPickSerpPatterns(queries: string[]): Promise<{ fetched: number; spentUsd: number }> {
  if (isDryRun() || !isDataForSeoConfigured()) return { fetched: 0, spentUsd: 0 };
  const cached = await readCachedSerpPatterns();
  const missing = [...new Set(queries.map(norm).filter(Boolean))].filter((q) => !cached.has(q)).slice(0, 8);
  if (missing.length === 0) return { fetched: 0, spentUsd: 0 };
  let spent = 0;
  const fresh: SerpPattern[] = [];
  for (const q of missing) {
    const r = await runSerpQuery(q).catch(() => null);
    if (!r) continue;
    spent += r.costUsd;
    if (r.status === "ok" && r.snapshot && r.snapshot.results.length > 0) fresh.push(extractSerpPattern(r.snapshot));
  }
  await persistPatterns(fresh);
  return { fetched: fresh.length, spentUsd: Number(spent.toFixed(3)) };
}

export type EnrichmentRunResult = {
  mode: "dry_run" | "live";
  configured: boolean;
  plan: EnrichmentPlan;
  /** live only */
  volumeStatus?: string;
  patternsWritten: number;
  spentUsd: number;
};

/**
 * Enrich the given research packs. DRY-RUN default → plan + estimate, no call. Live →
 * fetch missing volume + SERP patterns through the capped/cached gauntlets, persist.
 */
export async function enrichResearchPacks(packs: ResearchPackLite[]): Promise<EnrichmentRunResult> {
  // Build the plan against the CURRENT caches ($0 reads).
  const cachedKw = await readAllCachedKeywordDemand().catch(() => []);
  const volumeCached = new Set(cachedKw.map((k) => norm(k.keyword)));
  const cachedPatterns = await readCachedSerpPatterns();
  const serpCached = new Set([...cachedPatterns.keys()]);
  const plan = planResearchEnrichment(packs, { volumeCached, serpCached });
  const configured = isDataForSeoConfigured();

  // DRY-RUN (default): report the plan + estimate, make NO paid call.
  if (isDryRun()) {
    return { mode: "dry_run", configured, plan, patternsWritten: 0, spentUsd: 0 };
  }

  // LIVE: the gauntlets still enforce cap + 14d cache; fail-soft per call so one bad
  // term never blocks the rest, and nothing here touches the render path.
  let spent = 0;
  let volumeStatus: string | undefined;
  if (plan.volumeMissing.length > 0) {
    const r = await runKeywordVolume(plan.volumeMissing).catch(() => null);
    if (r) {
      volumeStatus = r.status;
      spent += r.costUsd;
    }
  }
  const fresh: SerpPattern[] = [];
  for (const q of plan.serpMissing) {
    const r = await runSerpQuery(q).catch(() => null);
    if (!r) continue;
    spent += r.costUsd;
    if (r.status === "ok" && r.snapshot && r.snapshot.results.length > 0) fresh.push(extractSerpPattern(r.snapshot));
  }
  await persistPatterns(fresh);
  return { mode: "live", configured, plan, volumeStatus, patternsWritten: fresh.length, spentUsd: Number(spent.toFixed(3)) };
}
