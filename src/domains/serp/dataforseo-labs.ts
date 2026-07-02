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

// ── Winnability-read cost constants (2026-07-02, master plan item 18) ─────────
// All three are conservative OVER-estimates of list price so the shared cap trips
// early rather than late (the same posture as LABS_COST_USD above):
//   - bulk_keyword_difficulty: list ~$0.01/task + ~$0.00003/keyword, so 1000
//     keywords is ~$0.04. We charge the ledger $0.05 per call.
//   - backlinks bulk_ranks: list ~$0.02 per 1000 targets. We charge $0.05.
//   - backlinks bulk_referring_domains: list ~$0.02 per 1000 targets. We charge $0.05.
// A FULL winnability pass over a verdict batch is therefore 3 batched calls at an
// estimated $0.15, with a documented HARD ceiling of $0.50 per verdict run
// (WINNABILITY_RUN_CEILING_USD) - and every call still re-checks the shared
// $50/month fail-closed cap before spending a cent.
export const LABS_BULK_DIFFICULTY_COST_USD = 0.05;
export const BACKLINKS_BULK_RANKS_COST_USD = 0.05;
export const BACKLINKS_REFERRING_DOMAINS_COST_USD = 0.05;
/** Documented hard ceiling for one full winnability pass (3 batched calls). */
export const WINNABILITY_RUN_CEILING_USD = 0.5;

const LABS_CACHE_STORE = "dataforseo-labs-cache";
/** 30 days - competitor portfolios move slowly; a monthly re-run is free. */
const LABS_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LABS_BASE = "https://api.dataforseo.com/v3/dataforseo_labs/google";
/** The Backlinks API rides a different path prefix but the SAME money gauntlet. */
const BACKLINKS_BASE = "https://api.dataforseo.com/v3/backlinks";
/** Hard row ceiling per call - bounded response, bounded per-row pricing. */
export const LABS_ROW_LIMIT = 300;
/** Batch-first ceilings: difficulty/ranks ride 1000-target bulk endpoints; the
 *  backlinks read is bounded to 100 page targets per verdict run. */
export const BULK_KEYWORDS_LIMIT = 1000;
export const BULK_TARGETS_LIMIT = 1000;
export const BACKLINKS_TARGETS_LIMIT = 100;

export type LabsPlan = {
  endpoint: string;
  cacheKey: string;
  estCostUsd: number;
};

export type LabsRunStatus = "disabled" | "cache_hit" | "dry_run" | "capped" | "ok" | "error";
export type LabsRunResult<T = KeywordGapRow> = {
  status: LabsRunStatus;
  plan: LabsPlan;
  rows: T[];
  costUsd: number;
  detail: string;
};

// ── Winnability read row shapes (2026-07-02, master plan item 18) ──────────────

/** One keyword's Google keyword-difficulty score (0-100, higher = harder). */
export type KeywordDifficultyRow = {
  keyword: string;
  /** 0-100 DataForSEO keyword_difficulty, or null when the API has no score. */
  difficulty: number | null;
};

/** One domain's Labs rank score (0-100 domain-strength proxy, higher = stronger). */
export type DomainRankRow = {
  domain: string;
  /** 0-100 rank score (domain_rank_overview's rank field), or null when absent. */
  rank: number | null;
};

/** One URL's backlinks summary (page-level, not domain-level). */
export type BacklinksSummaryRow = {
  url: string;
  /** Distinct referring domains, or null when the API has no data for this URL. */
  referringDomains: number | null;
  /** Total backlinks, or null when the API has no data for this URL. */
  backlinks: number | null;
};

// ── Historical volume (2026-07-02, master plan item 63) ─────────────────────

/** One keyword's multi-year monthly search-volume curve from Labs'
 *  historical_search_volume endpoint - the read that confirms a seasonality
 *  detector's one_season finding as a REPEATED, proven yearly wave. */
export type HistoricalVolumeRow = {
  keyword: string;
  /** Ascending by (year, month); one entry per month DataForSEO has a score for. */
  monthly: Array<{ year: number; month: number; searchVolume: number }>;
};

/** List price is per-keyword-batch (~$0.05/task + a few cents per keyword for
 *  monthly history); charged conservatively so the shared cap trips early. */
export const HISTORICAL_VOLUME_COST_USD = 0.08;
/** Bounded per master plan item 63: only the top detected seasonal cluster
 *  heads are ever checked, never a general keyword-research sweep. */
export const HISTORICAL_VOLUME_KEYWORDS_LIMIT = 20;

type CacheRow = { key: string; rows: unknown[]; fetchedAt: string };

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

/** The competitor's actual ranking URL from a Labs serp element (item 60's
 *  money-page aggregation) - same defensive nested/flattened access as rankOf. */
function urlOf(el: unknown): string | null {
  if (!el || typeof el !== "object") return null;
  const rec = el as Record<string, unknown>;
  const item = (rec.serp_item && typeof rec.serp_item === "object" ? rec.serp_item : rec) as Record<string, unknown>;
  return typeof item.url === "string" && item.url.trim() ? item.url.trim() : null;
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
        rankingUrl: urlOf(it.ranked_serp_element),
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
        rankingUrl: urlOf(it.first_domain_serp_element),
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
 *
 * Item 18: genericized over the row type (default KeywordGapRow, unchanged for
 * every existing caller) so the winnability reads (difficulty/ranks/backlinks)
 * can ride the IDENTICAL gauntlet without a second copy of the money logic. An
 * optional `base` lets a caller point at the Backlinks API path prefix instead
 * of the Labs one - same host, same auth, same gauntlet, different route tree.
 */
export async function runLabsQuery<T = KeywordGapRow>(
  path: string,
  payload: Record<string, unknown>,
  opts: { cacheKey: string; estCostUsd?: number; parse: (body: unknown) => T[]; base?: string },
  depsOverride: Partial<LabsRunDeps> = {},
): Promise<LabsRunResult<T>> {
  const deps = { ...defaultDeps, ...depsOverride };
  const plan: LabsPlan = {
    endpoint: `${opts.base ?? LABS_BASE}/${path}`,
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
      return { status: "cache_hit", plan, rows: hit.rows as T[], costUsd: 0, detail: "served from 30d cache" };
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

// ── Winnability reads (2026-07-02, master plan item 18) ────────────────────────
// Three cheap, BATCH-FIRST reads that turn a verdict from SERP-shape vibes into
// arithmetic: keyword difficulty (Labs), domain-strength ranks (Backlinks), and a
// page-level backlinks gap for the top winning URLs vs the tenant's own page. Each
// rides the IDENTICAL money gauntlet (runLabsQuery) - configured check, 30d cache,
// dry-run default, fail-closed shared cap, ledger - never a second money path.

function bulkItems(body: unknown): Array<Record<string, unknown>> {
  return (
    (body as { tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }> })?.tasks?.[0]
      ?.result?.[0]?.items ?? []
  );
}

/** Parse a bulk_keyword_difficulty body. PURE, honest: malformed/missing -> null score. */
export function parseBulkKeywordDifficulty(body: unknown): KeywordDifficultyRow[] {
  const out: KeywordDifficultyRow[] = [];
  try {
    for (const it of bulkItems(body)) {
      const keyword = typeof it.keyword === "string" ? it.keyword : "";
      if (!keyword) continue;
      const kd = typeof it.keyword_difficulty === "number" ? it.keyword_difficulty : null;
      out.push({ keyword, difficulty: kd });
    }
  } catch {
    /* malformed body -> [] */
  }
  return out;
}

/** Parse a backlinks bulk_ranks body. PURE, honest: malformed/missing -> null rank. */
export function parseBulkDomainRanks(body: unknown): DomainRankRow[] {
  const out: DomainRankRow[] = [];
  try {
    for (const it of bulkItems(body)) {
      const domain = typeof it.target === "string" ? it.target : "";
      if (!domain) continue;
      const rank = typeof it.rank === "number" ? it.rank : null;
      out.push({ domain: normalizeDomainTarget(domain), rank });
    }
  } catch {
    /* malformed body -> [] */
  }
  return out;
}

/** Parse a backlinks bulk_referring_domains body. PURE, honest: malformed -> null counts. */
export function parseBacklinksSummary(body: unknown): BacklinksSummaryRow[] {
  const out: BacklinksSummaryRow[] = [];
  try {
    for (const it of bulkItems(body)) {
      const url = typeof it.target === "string" ? it.target : "";
      if (!url) continue;
      const referringDomains = typeof it.referring_domains === "number" ? it.referring_domains : null;
      const backlinks = typeof it.backlinks === "number" ? it.backlinks : null;
      out.push({ url, referringDomains, backlinks });
    }
  } catch {
    /* malformed body -> [] */
  }
  return out;
}

/**
 * Google's keyword-difficulty score (0-100) for EVERY candidate keyword in ONE
 * batched call (up to BULK_KEYWORDS_LIMIT). This is the arithmetic serp-validation
 * lacked - a real difficulty number instead of judging SERP shape alone.
 */
export async function runBulkKeywordDifficulty(
  keywords: string[],
  opts: LabsQueryOpts = {},
  depsOverride: Partial<LabsRunDeps> = {},
): Promise<LabsRunResult<KeywordDifficultyRow>> {
  const clean = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(0, BULK_KEYWORDS_LIMIT);
  if (clean.length === 0) {
    return {
      status: "error",
      plan: { endpoint: `${LABS_BASE}/bulk_keyword_difficulty/live`, cacheKey: "", estCostUsd: LABS_BULK_DIFFICULTY_COST_USD },
      rows: [],
      costUsd: 0,
      detail: "no keywords",
    };
  }
  const locationCode = opts.locationCode ?? 2840; // United States
  const languageCode = opts.languageCode ?? "en";
  const cacheKey = `bulk_keyword_difficulty|${locationCode}|${languageCode}|${[...clean].sort().join(",")}`;
  return runLabsQuery<KeywordDifficultyRow>(
    "bulk_keyword_difficulty/live",
    { keywords: clean, location_code: locationCode, language_code: languageCode },
    { cacheKey, estCostUsd: LABS_BULK_DIFFICULTY_COST_USD, parse: parseBulkKeywordDifficulty },
    depsOverride,
  );
}

/**
 * Read ALL fresh cached keyword-difficulty rows (no call, NO spend), flattened +
 * deduped by keyword (newest cache entry wins), stale entries (>30d) dropped.
 * Item 18's daily-evidence-brief upgrade: the "competition" line can cite a
 * real difficulty score for a query WITHOUT spending, as long as some past
 * verdict run already fetched it. Fail-soft -> empty map.
 */
export async function readAllCachedKeywordDifficulty(
  deps: { now?: () => Date; readCache?: () => Promise<CacheRow[]> } = {},
): Promise<Map<string, number | null>> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  const out = new Map<string, number | null>();
  let rows: CacheRow[];
  try {
    rows = await (deps.readCache ?? defaultDeps.readCache)();
  } catch {
    return out;
  }
  for (const r of rows) {
    if (!r.key.startsWith("bulk_keyword_difficulty|")) continue;
    if (nowMs - Date.parse(r.fetchedAt) >= LABS_CACHE_TTL_MS) continue; // stale row
    for (const row of r.rows as KeywordDifficultyRow[]) {
      if (row && typeof row.keyword === "string") out.set(row.keyword.toLowerCase(), row.difficulty);
    }
  }
  return out;
}

/**
 * Domain-strength rank scores (0-100) for EVERY winning domain in ONE batched
 * call (up to BULK_TARGETS_LIMIT). A rank-80 SERP is honestly a reject even when
 * the shape (content vs marketplace) looks friendly.
 */
export async function runBulkDomainRanks(
  domains: string[],
  depsOverride: Partial<LabsRunDeps> = {},
): Promise<LabsRunResult<DomainRankRow>> {
  const clean = [...new Set(domains.map(normalizeDomainTarget).filter(Boolean))].slice(0, BULK_TARGETS_LIMIT);
  if (clean.length === 0) {
    return {
      status: "error",
      plan: { endpoint: `${BACKLINKS_BASE}/bulk_ranks/live`, cacheKey: "", estCostUsd: BACKLINKS_BULK_RANKS_COST_USD },
      rows: [],
      costUsd: 0,
      detail: "no domains",
    };
  }
  const cacheKey = `bulk_ranks|${[...clean].sort().join(",")}`;
  return runLabsQuery<DomainRankRow>(
    "bulk_ranks/live",
    { targets: clean },
    { cacheKey, estCostUsd: BACKLINKS_BULK_RANKS_COST_USD, parse: parseBulkDomainRanks, base: BACKLINKS_BASE },
    depsOverride,
  );
}

/**
 * Page-level backlinks summary (referring domains + total backlinks) for a
 * bounded set of URLs - the top BACKLINKS_TARGETS_LIMIT winning pages plus the
 * tenant's own page - in ONE batched call. This is the "their pages average 210
 * linking domains, yours has 3" read.
 */
export async function runBacklinksSummary(
  urls: string[],
  depsOverride: Partial<LabsRunDeps> = {},
): Promise<LabsRunResult<BacklinksSummaryRow>> {
  const clean = [...new Set(urls.map((u) => u.trim()).filter(Boolean))].slice(0, BACKLINKS_TARGETS_LIMIT);
  if (clean.length === 0) {
    return {
      status: "error",
      plan: { endpoint: `${BACKLINKS_BASE}/bulk_referring_domains/live`, cacheKey: "", estCostUsd: BACKLINKS_REFERRING_DOMAINS_COST_USD },
      rows: [],
      costUsd: 0,
      detail: "no urls",
    };
  }
  const cacheKey = `bulk_referring_domains|${[...clean].sort().join(",")}`;
  return runLabsQuery<BacklinksSummaryRow>(
    "bulk_referring_domains/live",
    { targets: clean },
    { cacheKey, estCostUsd: BACKLINKS_REFERRING_DOMAINS_COST_USD, parse: parseBacklinksSummary, base: BACKLINKS_BASE },
    depsOverride,
  );
}

/** Parse a keyword_ideas-shaped historical_search_volume body: one item per
 *  keyword, each carrying a keyword_info.monthly_searches array. PURE, honest:
 *  malformed/missing -> [] for that keyword (never fabricates history). */
export function parseHistoricalVolume(body: unknown): HistoricalVolumeRow[] {
  const out: HistoricalVolumeRow[] = [];
  try {
    for (const it of bulkItems(body)) {
      const keyword = typeof it.keyword === "string" ? it.keyword : "";
      if (!keyword) continue;
      const info = (it.keyword_info ?? {}) as Record<string, unknown>;
      const series = Array.isArray(info.monthly_searches) ? info.monthly_searches : [];
      const monthly: HistoricalVolumeRow["monthly"] = [];
      for (const m of series) {
        if (!m || typeof m !== "object") continue;
        const rec = m as Record<string, unknown>;
        const year = typeof rec.year === "number" ? rec.year : null;
        const month = typeof rec.month === "number" ? rec.month : null;
        const searchVolume = typeof rec.search_volume === "number" ? rec.search_volume : null;
        if (year == null || month == null || searchVolume == null) continue;
        monthly.push({ year, month, searchVolume });
      }
      monthly.sort((a, b) => (a.year - b.year) || (a.month - b.month));
      out.push({ keyword, monthly });
    }
  } catch {
    /* malformed body -> [] */
  }
  return out;
}

/**
 * Multi-year monthly search-volume curves for a bounded batch of keywords (at
 * most HISTORICAL_VOLUME_KEYWORDS_LIMIT) - Google Ads' own market history via
 * DataForSEO Labs, called ONLY for the top detected seasonal cluster heads
 * (never a general research sweep). Confirms a one-season archive finding as a
 * genuine multi-year market pattern before the peak calendar calls it "proven".
 * Same money gauntlet as every other Labs read (30-day cache, dry-run default,
 * fail-closed shared cap) - a dry-run or capped result returns [] rows, never
 * spends, and the caller (computePeakCalendar) treats that as "unconfirmed",
 * not an error.
 */
export async function runHistoricalVolume(
  keywords: string[],
  opts: LabsQueryOpts = {},
  depsOverride: Partial<LabsRunDeps> = {},
): Promise<LabsRunResult<HistoricalVolumeRow>> {
  const clean = [...new Set(keywords.map((k) => k.trim().toLowerCase()).filter(Boolean))].slice(
    0,
    HISTORICAL_VOLUME_KEYWORDS_LIMIT,
  );
  if (clean.length === 0) {
    return {
      status: "error",
      plan: { endpoint: `${LABS_BASE}/historical_search_volume/live`, cacheKey: "", estCostUsd: HISTORICAL_VOLUME_COST_USD },
      rows: [],
      costUsd: 0,
      detail: "no keywords",
    };
  }
  const locationCode = opts.locationCode ?? 2840; // United States
  const languageCode = opts.languageCode ?? "en";
  const cacheKey = `historical_search_volume|${locationCode}|${languageCode}|${[...clean].sort().join(",")}`;
  return runLabsQuery<HistoricalVolumeRow>(
    "historical_search_volume/live",
    { keywords: clean, location_code: locationCode, language_code: languageCode },
    { cacheKey, estCostUsd: HISTORICAL_VOLUME_COST_USD, parse: parseHistoricalVolume },
    depsOverride,
  );
}
