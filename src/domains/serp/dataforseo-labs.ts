import "server-only";

import { log } from "@/lib/logger";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId } from "@/lib/tenant-context";
import { recordSpendSupabase, getTenantSpentThisMonthUsd } from "@/lib/cost/budget-ledger-supabase";
import { resolveAuthB64, isDataForSeoConfigured, isDryRun, monthlyCapUsd } from "./dataforseo-serp";
import type { KeywordGapRow } from "./keyword-gaps";

/**
 * dataforseo-labs (2026-07-02, master plan item 16) - the SAFE DataForSEO Labs
 * runner behind the competitor keyword gap engine. Two endpoints:
 *
 *   - ranked_keywords: one competitor domain in, its Google ranking portfolio out
 *     (keyword + volume + rank), capped at 300 rows / top-20 ranks.
 *   - domain_intersection (intersections: false): keywords the competitor ranks
 *     for where the tenant does NOT appear - the literal gap list.
 *
 * The money gauntlet is IDENTICAL to dataforseo-serp/-keywords and is the whole
 * point: (1) configured check; (2) 30-DAY cache first (a re-run within a month is
 * $0); (3) DRY-RUN default ON (returns the priced plan, spends nothing); (4) hard
 * shared monthly cap re-checked before EVERY call, fail-CLOSED; only then (5)
 * fetch; then (6) record spend in the durable ledger under the SHARED
 * "dataforseo-serp" platform (one cap governs ALL DataForSEO spend) + cache +
 * structured ledger line. Every dependency is injectable so tests never spend.
 */

// DataForSEO Labs "live" pricing is ~$0.01/task + ~$0.0001/row, so a 300-row call
// is ~$0.04 list price. We estimate at $0.11 (about 2.5x) so the shared cap trips
// early rather than late - same conservative posture as SERP_COST_USD ($0.003 vs
// ~$0.0006 list) and KEYWORDS_COST_USD ($0.075 vs ~$0.05).
export const LABS_COST_USD = 0.11;
const LABS_CACHE_STORE = "dataforseo-labs-cache";
/** 30 days - competitor portfolios move slowly; a monthly re-run is free. */
const LABS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LABS_BASE = "https://api.dataforseo.com/v3/dataforseo_labs/google";
/** Hard row ceiling per call - bounded response, bounded per-row pricing. */
export const LABS_ROW_LIMIT = 300;

export type LabsPlan = {
  endpoint: string;
  cacheKey: string;
  estCostUsd: number;
};

export type LabsRunStatus = "disabled" | "cache_hit" | "dry_run" | "capped" | "ok" | "error";
export type LabsRunResult = {
  status: LabsRunStatus;
  plan: LabsPlan;
  rows: KeywordGapRow[];
  costUsd: number;
  detail: string;
};

type CacheRow = { key: string; rows: KeywordGapRow[]; fetchedAt: string };

export type LabsRunDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  tenantId: () => Promise<string>;
  spentThisMonthUsd: (tenantId: string, now: Date) => Promise<number | null>;
  recordSpend: (tenantId: string, costUsd: number) => Promise<void>;
  readCache: () => Promise<CacheRow[]>;
  writeCache: (rows: CacheRow[]) => Promise<void>;
  fetchImpl: typeof fetch;
};

const defaultDeps: LabsRunDeps = {
  env: process.env,
  now: () => new Date(),
  tenantId: currentTenantId,
  // SHARED DataForSEO budget: cap + spend ride the "dataforseo-serp" platform so
  // every DataForSEO call draws from ONE monthly cap (no new ledger key).
  spentThisMonthUsd: (t, now) => getTenantSpentThisMonthUsd(t, now, "dataforseo-serp"),
  recordSpend: (tenantId, costUsd) => recordSpendSupabase({ tenantId, platform: "dataforseo-serp", costUsd }),
  readCache: () => readStore<CacheRow>(LABS_CACHE_STORE, []),
  writeCache: (rows) => writeStore(LABS_CACHE_STORE, rows),
  fetchImpl: fetch,
};

/** Normalize an operator/graph-supplied domain to a bare Labs target
 *  ("https://www.Foo.com/bar" -> "foo.com"). */
export function normalizeDomainTarget(domain: string): string {
  const raw = domain.trim().toLowerCase();
  if (!raw) return "";
  try {
    const u = new URL(/^https?:\/\//.test(raw) ? raw : `https://${raw}`);
    return u.hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").split("/")[0] ?? "";
  }
}

/** rank_group (fallback rank_absolute) from a Labs serp element - defensively
 *  accepts both the nested { serp_item: {...} } and the flattened shape. */
function rankOf(el: unknown): number | null {
  if (!el || typeof el !== "object") return null;
  const rec = el as Record<string, unknown>;
  const item = (rec.serp_item && typeof rec.serp_item === "object" ? rec.serp_item : rec) as Record<string, unknown>;
  const r = typeof item.rank_group === "number" ? item.rank_group : item.rank_absolute;
  return typeof r === "number" && r > 0 ? r : null;
}

function keywordDataOf(it: Record<string, unknown>): { keyword: string; volume: number | null; cpc: number | null } {
  const kd = (it.keyword_data ?? {}) as Record<string, unknown>;
  const info = (kd.keyword_info ?? {}) as Record<string, unknown>;
  return {
    keyword: typeof kd.keyword === "string" ? kd.keyword : "",
    volume: typeof info.search_volume === "number" ? info.search_volume : null,
    cpc: typeof info.cpc === "number" ? info.cpc : null,
  };
}

function labsItems(body: unknown): Array<Record<string, unknown>> {
  return (
    (body as { tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }> })?.tasks?.[0]
      ?.result?.[0]?.items ?? []
  );
}

/** Parse a ranked_keywords body into lean gap rows (ownRank unknown here). PURE,
 *  honest: malformed body -> [] (never throws, never fabricates). */
export function parseRankedKeywords(body: unknown, competitorDomain: string): KeywordGapRow[] {
  const out: KeywordGapRow[] = [];
  try {
    for (const it of labsItems(body)) {
      const { keyword, volume, cpc } = keywordDataOf(it);
      const rank = rankOf(it.ranked_serp_element);
      if (!keyword || rank == null) continue;
      out.push({
        keyword,
        volume,
        competitorDomain,
        competitorRank: rank,
        ownRank: null,
        cpcUsd: cpc,
        source: "ranked_keywords",
      });
    }
  } catch {
    /* malformed body -> [] */
  }
  return out;
}

/** Parse a domain_intersection body (target1 = competitor, target2 = tenant,
 *  intersections: false -> the tenant element is absent = they rank, you do not). */
export function parseDomainIntersection(body: unknown, competitorDomain: string): KeywordGapRow[] {
  const out: KeywordGapRow[] = [];
  try {
    for (const it of labsItems(body)) {
      const { keyword, volume, cpc } = keywordDataOf(it);
      const rank = rankOf(it.first_domain_serp_element);
      if (!keyword || rank == null) continue;
      out.push({
        keyword,
        volume,
        competitorDomain,
        competitorRank: rank,
        ownRank: rankOf(it.second_domain_serp_element),
        cpcUsd: cpc,
        source: "domain_intersection",
      });
    }
  } catch {
    /* malformed body -> [] */
  }
  return out;
}

/**
 * Run ONE DataForSEO Labs query through the full money gauntlet. Never throws.
 * Spends real money ONLY on status "ok" (configured + not dry-run + under the
 * shared cap + cache miss). Generic: endpoints below supply path/payload/parse.
 */
export async function runLabsQuery(
  path: string,
  payload: Record<string, unknown>,
  opts: { cacheKey: string; estCostUsd?: number; parse: (body: unknown) => KeywordGapRow[] },
  depsOverride: Partial<LabsRunDeps> = {},
): Promise<LabsRunResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const plan: LabsPlan = {
    endpoint: `${LABS_BASE}/${path}`,
    cacheKey: opts.cacheKey,
    estCostUsd: opts.estCostUsd ?? LABS_COST_USD,
  };

  if (!isDataForSeoConfigured(deps.env)) {
    return { status: "disabled", plan, rows: [], costUsd: 0, detail: "DataForSEO not configured" };
  }

  const now = deps.now();
  const nowMs = now.getTime();

  // (2) 30-day cache - serve a fresh result without spending.
  try {
    const rows = await deps.readCache();
    const hit = rows.find((r) => r.key === plan.cacheKey);
    if (hit && nowMs - Date.parse(hit.fetchedAt) < LABS_CACHE_TTL_MS) {
      log.info("[dataforseo-labs] cache hit", { key: plan.cacheKey, fetchedAt: hit.fetchedAt });
      return { status: "cache_hit", plan, rows: hit.rows, costUsd: 0, detail: "served from 30d cache" };
    }
  } catch {
    /* cache read failure is non-fatal - fall through */
  }

  // (3) DRY-RUN (default) - return the priced plan, spend nothing.
  if (isDryRun(deps.env)) {
    log.info("[dataforseo-labs] DRY-RUN (no spend)", { endpoint: plan.endpoint, estCostUsd: plan.estCostUsd });
    return { status: "dry_run", plan, rows: [], costUsd: 0, detail: `dry run, would spend ~$${plan.estCostUsd}` };
  }

  // (4) hard shared monthly cap - FAIL-CLOSED (over cap or unknown spend = no call).
  const tenantId = await deps.tenantId();
  const cap = monthlyCapUsd(deps.env);
  const spent = await deps.spentThisMonthUsd(tenantId, now).catch(() => null);
  if (spent === null) {
    log.warn("[dataforseo-labs] spend unknown, failing closed (no call)", { tenantId });
    return { status: "capped", plan, rows: [], costUsd: 0, detail: "monthly spend unknown, failing closed" };
  }
  if (spent + plan.estCostUsd > cap) {
    log.warn("[dataforseo-labs] monthly cap reached, no call", { tenantId, spent, cap });
    return { status: "capped", plan, rows: [], costUsd: 0, detail: `cap reached (${spent.toFixed(3)}/${cap} USD this month)` };
  }

  // (5) the paid call.
  try {
    const auth = resolveAuthB64(deps.env) ?? "";
    const res = await deps.fetchImpl(plan.endpoint, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([payload]),
    });
    if (!res.ok) {
      log.warn("[dataforseo-labs] non-2xx", { endpoint: plan.endpoint, status: res.status });
      return { status: "error", plan, rows: [], costUsd: 0, detail: `http ${res.status}` };
    }
    const body = await res.json();
    const rows = opts.parse(body);

    // (6) record spend (durable) + cache + structured ledger line.
    await deps.recordSpend(tenantId, plan.estCostUsd).catch((err) =>
      log.warn("[dataforseo-labs] durable spend write failed (non-fatal)", { error: String(err) }),
    );
    try {
      const cached = (await deps.readCache()).filter((r) => r.key !== plan.cacheKey);
      cached.push({ key: plan.cacheKey, rows, fetchedAt: now.toISOString() });
      await deps.writeCache(cached);
    } catch {
      /* cache write failure is non-fatal */
    }
    log.info("[dataforseo-labs] LEDGER", {
      tenantId,
      endpoint: plan.endpoint,
      key: plan.cacheKey,
      estCostUsd: plan.estCostUsd,
      rows: rows.length,
      cache: "miss",
    });
    return { status: "ok", plan, rows, costUsd: plan.estCostUsd, detail: `${rows.length} rows` };
  } catch (err) {
    log.warn("[dataforseo-labs] fetch threw (non-fatal)", {
      endpoint: plan.endpoint,
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "error", plan, rows: [], costUsd: 0, detail: "fetch failed" };
  }
}

export type LabsQueryOpts = { locationCode?: number; languageCode?: string };

/**
 * One competitor's Google ranking portfolio: top LABS_ROW_LIMIT keywords they hold
 * at rank <= 20, ordered by search volume. ownRank is unknown here (null) - the
 * pure gap math joins the tenant's GSC positions instead.
 */
export async function runRankedKeywords(
  competitorDomain: string,
  opts: LabsQueryOpts = {},
  depsOverride: Partial<LabsRunDeps> = {},
): Promise<LabsRunResult> {
  const target = normalizeDomainTarget(competitorDomain);
  if (!target) {
    return {
      status: "error",
      plan: { endpoint: `${LABS_BASE}/ranked_keywords/live`, cacheKey: "", estCostUsd: LABS_COST_USD },
      rows: [],
      costUsd: 0,
      detail: "empty domain",
    };
  }
  const locationCode = opts.locationCode ?? 2840; // United States
  const languageCode = opts.languageCode ?? "en";
  return runLabsQuery(
    "ranked_keywords/live",
    {
      target,
      location_code: locationCode,
      language_code: languageCode,
      limit: LABS_ROW_LIMIT,
      ignore_synonyms: true,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
      filters: [["ranked_serp_element.serp_item.rank_group", "<=", 20]],
    },
    {
      cacheKey: `ranked_keywords|${locationCode}|${languageCode}|${target}`,
      parse: (body) => parseRankedKeywords(body, target),
    },
    depsOverride,
  );
}

/**
 * Keywords the competitor ranks for where the tenant does NOT appear
 * (intersections: false), ordered by search volume. The literal gap list.
 */
export async function runDomainIntersection(
  competitorDomain: string,
  ownDomain: string,
  opts: LabsQueryOpts = {},
  depsOverride: Partial<LabsRunDeps> = {},
): Promise<LabsRunResult> {
  const target1 = normalizeDomainTarget(competitorDomain);
  const target2 = normalizeDomainTarget(ownDomain);
  if (!target1 || !target2) {
    return {
      status: "error",
      plan: { endpoint: `${LABS_BASE}/domain_intersection/live`, cacheKey: "", estCostUsd: LABS_COST_USD },
      rows: [],
      costUsd: 0,
      detail: "empty domain",
    };
  }
  const locationCode = opts.locationCode ?? 2840; // United States
  const languageCode = opts.languageCode ?? "en";
  return runLabsQuery(
    "domain_intersection/live",
    {
      target1,
      target2,
      intersections: false,
      location_code: locationCode,
      language_code: languageCode,
      limit: LABS_ROW_LIMIT,
      order_by: ["keyword_data.keyword_info.search_volume,desc"],
    },
    {
      cacheKey: `domain_intersection|${locationCode}|${languageCode}|${target1}|${target2}`,
      parse: (body) => parseDomainIntersection(body, target1),
    },
    depsOverride,
  );
}
