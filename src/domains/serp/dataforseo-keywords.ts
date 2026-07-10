import "server-only";

import { log } from "@/lib/logger";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId } from "@/lib/tenant-context";
import { recordSpendSupabase, getTenantSpentThisMonthUsd } from "@/lib/cost/budget-ledger-supabase";
import { perfCountExternal } from "@/lib/obs/perf-log";
import { resolveAuthB64, isDataForSeoConfigured, isDryRun, monthlyCapUsd } from "./dataforseo-serp";

/**
 * dataforseo-keywords (2026-06-25, Sprint 4A) — the SAFE keyword-demand runner.
 * Reuses the exact money gauntlet of dataforseo-serp (configured → cache → DRY-RUN
 * default → hard monthly cap fail-CLOSED → fetch → record spend → cache → ledger),
 * but hits the Google Ads Search Volume endpoint to get REAL search volume + CPC +
 * competition + a 12-month trend per keyword. Spend is recorded under the SHARED
 * `dataforseo-serp` ledger platform so the monthly cap governs ALL DataForSEO calls
 * — NO migration needed. Every dependency is injectable so tests never spend.
 *
 * One small call covers up to ~1000 keywords, so opportunity discovery batches the
 * whole seed set into ONE request. No fabricated volume: a keyword with no data
 * comes back with null volume + low confidence, never a guessed number.
 */

// Google Ads search_volume "live" ≈ $0.05–0.08 per call (any keyword count). Use a
// conservative flat estimate so the shared DataForSEO cap trips early, not late.
export const KEYWORDS_COST_USD = 0.075;
const KW_CACHE_STORE = "dataforseo-keywords-cache";
const KW_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const KW_ENDPOINT = "https://api.dataforseo.com/v3/keywords_data/google_ads/search_volume/live";
/** Hard ceiling on keywords per call — keeps one request small + bounded. */
const MAX_KEYWORDS_PER_CALL = 200;

export type KeywordDemand = {
  keyword: string;
  /** Avg monthly searches, or null when DataForSEO has no data (never guessed). */
  searchVolume: number | null;
  cpcUsd: number | null;
  /** 0..1 paid competition index, or null. */
  competition: number | null;
  competitionLevel: "low" | "medium" | "high" | null;
  /** 12-month trend (most recent last) — powers Trend Radar. */
  monthlySearches: { year: number; month: number; volume: number }[];
  locationCode: number;
  languageCode: string;
  source: "dataforseo";
  fetchedAt: string;
  confidence: "high" | "medium" | "low";
  evidenceRef: string;
};

export type KeywordsPlan = {
  endpoint: string;
  keywords: string[];
  locationCode: number;
  languageCode: string;
  estCostUsd: number;
};

export type KeywordsRunStatus = "disabled" | "cache_hit" | "dry_run" | "capped" | "ok" | "error";
export type KeywordsRunResult = {
  status: KeywordsRunStatus;
  plan: KeywordsPlan;
  keywords: KeywordDemand[];
  costUsd: number;
  detail: string;
};

function normKeyword(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Build the planned call (endpoint + estimated cost) without performing it. */
export function planKeywordsCall(
  keywords: string[],
  opts: { locationCode?: number; languageCode?: string } = {},
): KeywordsPlan {
  const cleaned = [...new Set(keywords.map(normKeyword).filter((k) => k.length >= 2))].slice(0, MAX_KEYWORDS_PER_CALL);
  return {
    endpoint: KW_ENDPOINT,
    keywords: cleaned,
    locationCode: opts.locationCode ?? 2840, // United States
    languageCode: opts.languageCode ?? "en",
    estCostUsd: KEYWORDS_COST_USD,
  };
}

type CacheRow = { key: string; keywords: KeywordDemand[]; fetchedAt: string };
const cacheKey = (plan: KeywordsPlan): string =>
  `${plan.locationCode}|${plan.languageCode}|${[...plan.keywords].sort().join(",")}`;

function competitionLevelOf(idx: number | null): KeywordDemand["competitionLevel"] {
  if (idx == null) return null;
  if (idx >= 0.66) return "high";
  if (idx >= 0.33) return "medium";
  return "low";
}

/** Parse a Google Ads search_volume response into normalized KeywordDemand[]. PURE.
 *  Honest: a keyword DataForSEO returns no volume for → searchVolume null, low
 *  confidence. Never fabricates a number. */
export function parseKeywordVolume(
  body: unknown,
  plan: KeywordsPlan,
  nowIso: string,
): KeywordDemand[] {
  const out: KeywordDemand[] = [];
  try {
    const items =
      (body as { tasks?: Array<{ result?: Array<Record<string, unknown>> }> })?.tasks?.[0]?.result ?? [];
    for (const it of items) {
      const keyword = typeof it.keyword === "string" ? it.keyword : "";
      if (!keyword) continue;
      const sv = typeof it.search_volume === "number" ? it.search_volume : null;
      const cpc = typeof it.cpc === "number" ? it.cpc : null;
      const comp = typeof it.competition_index === "number" ? it.competition_index / 100 : typeof it.competition === "number" ? it.competition : null;
      const monthly = Array.isArray(it.monthly_searches)
        ? (it.monthly_searches as Array<Record<string, unknown>>)
            .map((m) => ({
              year: Number(m.year ?? 0),
              month: Number(m.month ?? 0),
              volume: typeof m.search_volume === "number" ? m.search_volume : 0,
            }))
            .filter((m) => m.year > 0)
            .sort((a, b) => a.year - b.year || a.month - b.month)
        : [];
      out.push({
        keyword: normKeyword(keyword),
        searchVolume: sv,
        cpcUsd: cpc,
        competition: comp != null ? Math.max(0, Math.min(1, comp)) : null,
        competitionLevel: competitionLevelOf(comp != null ? Math.max(0, Math.min(1, comp)) : null),
        monthlySearches: monthly,
        locationCode: plan.locationCode,
        languageCode: plan.languageCode,
        source: "dataforseo",
        fetchedAt: nowIso,
        confidence: sv != null && sv > 0 ? (monthly.length >= 6 ? "high" : "medium") : "low",
        evidenceRef: "dataforseo:keywords_data/google_ads/search_volume",
      });
    }
  } catch {
    /* malformed body → empty (honest, never throws) */
  }
  return out;
}

/**
 * Read ALL fresh cached keyword demand (no call, NO spend) — flattened + deduped
 * by keyword (newest wins), stale rows (>14d) dropped. Lets the cockpit surface
 * already-discovered demand on render at $0. Fail-soft → [].
 */
export async function readAllCachedKeywordDemand(
  deps: { now?: () => Date; readCache?: () => Promise<CacheRow[]> } = {},
): Promise<KeywordDemand[]> {
  const nowMs = (deps.now ?? (() => new Date()))().getTime();
  let rows: CacheRow[];
  try {
    rows = await (deps.readCache ?? defaultDeps.readCache)();
  } catch {
    return [];
  }
  const byKw = new Map<string, KeywordDemand>();
  for (const r of rows) {
    if (nowMs - Date.parse(r.fetchedAt) >= KW_CACHE_TTL_MS) continue; // stale row
    for (const k of r.keywords) {
      const prev = byKw.get(k.keyword);
      if (!prev || Date.parse(k.fetchedAt) > Date.parse(prev.fetchedAt)) byKw.set(k.keyword, k);
    }
  }
  return [...byKw.values()];
}

export type KeywordsRunDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  tenantId: () => Promise<string>;
  spentThisMonthUsd: (tenantId: string, now: Date) => Promise<number | null>;
  recordSpend: (tenantId: string, costUsd: number) => Promise<void>;
  readCache: () => Promise<CacheRow[]>;
  writeCache: (rows: CacheRow[]) => Promise<void>;
  fetchImpl: typeof fetch;
};

const defaultDeps: KeywordsRunDeps = {
  env: process.env,
  now: () => new Date(),
  tenantId: currentTenantId,
  // SHARED DataForSEO budget: cap + spend both ride the "dataforseo-serp" platform
  // so all DataForSEO calls draw from ONE monthly cap (no new ledger key/migration).
  spentThisMonthUsd: (t, now) => getTenantSpentThisMonthUsd(t, now, "dataforseo-serp"),
  recordSpend: (tenantId, costUsd) => recordSpendSupabase({ tenantId, platform: "dataforseo-serp", costUsd }),
  readCache: () => readStore<CacheRow>(KW_CACHE_STORE, []),
  writeCache: (rows) => writeStore(KW_CACHE_STORE, rows),
  fetchImpl: fetch,
};

/**
 * Fetch real keyword demand through the full safety gauntlet. Never throws. Spends
 * real money ONLY on status "ok" (configured + not dry-run + under cap + cache miss).
 */
export async function runKeywordVolume(
  keywords: string[],
  opts: { locationCode?: number; languageCode?: string } = {},
  depsOverride: Partial<KeywordsRunDeps> = {},
): Promise<KeywordsRunResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const plan = planKeywordsCall(keywords, opts);
  if (plan.keywords.length === 0) {
    return { status: "error", plan, keywords: [], costUsd: 0, detail: "no usable keywords" };
  }
  if (!isDataForSeoConfigured(deps.env)) {
    return { status: "disabled", plan, keywords: [], costUsd: 0, detail: "DataForSEO not configured" };
  }

  const now = deps.now();
  const nowMs = now.getTime();

  // (2) cache — serve a fresh result without spending.
  try {
    const rows = await deps.readCache();
    const hit = rows.find((r) => r.key === cacheKey(plan));
    if (hit && nowMs - Date.parse(hit.fetchedAt) < KW_CACHE_TTL_MS) {
      log.info("[dataforseo-keywords] cache hit", { count: plan.keywords.length, fetchedAt: hit.fetchedAt });
      return { status: "cache_hit", plan, keywords: hit.keywords, costUsd: 0, detail: "served from 14d cache" };
    }
  } catch {
    /* non-fatal */
  }

  // (3) DRY-RUN (default) — return the plan, spend nothing.
  if (isDryRun(deps.env)) {
    log.info("[dataforseo-keywords] DRY-RUN (no spend)", { count: plan.keywords.length, estCostUsd: plan.estCostUsd });
    return { status: "dry_run", plan, keywords: [], costUsd: 0, detail: `dry-run — would spend ~$${plan.estCostUsd}` };
  }

  // (4) hard monthly cap — FAIL-CLOSED.
  const tenantId = await deps.tenantId();
  const cap = monthlyCapUsd(deps.env);
  const spent = await deps.spentThisMonthUsd(tenantId, now).catch(() => null);
  if (spent === null) {
    log.warn("[dataforseo-keywords] spend unknown — failing closed", { tenantId });
    return { status: "capped", plan, keywords: [], costUsd: 0, detail: "monthly spend unknown — failing closed" };
  }
  if (spent + plan.estCostUsd > cap) {
    log.warn("[dataforseo-keywords] monthly cap reached — no call", { tenantId, spent, cap });
    return { status: "capped", plan, keywords: [], costUsd: 0, detail: `cap reached (${spent.toFixed(3)}/${cap} USD this month)` };
  }

  // (5) the paid call.
  try {
    // W2-B - count the live DataForSEO keyword-volume call at its transport.
    perfCountExternal("dataforseo", "keywords");
    const auth = resolveAuthB64(deps.env) ?? "";
    const res = await deps.fetchImpl(plan.endpoint, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        { keywords: plan.keywords, location_code: plan.locationCode, language_code: plan.languageCode },
      ]),
    });
    if (!res.ok) {
      log.warn("[dataforseo-keywords] non-2xx", { status: res.status });
      return { status: "error", plan, keywords: [], costUsd: 0, detail: `http ${res.status}` };
    }
    const body = await res.json();
    const parsed = parseKeywordVolume(body, plan, now.toISOString());

    await deps.recordSpend(tenantId, plan.estCostUsd).catch((err) =>
      log.warn("[dataforseo-keywords] durable spend write failed (non-fatal)", { error: String(err) }),
    );
    try {
      const rows = (await deps.readCache()).filter((r) => r.key !== cacheKey(plan));
      rows.push({ key: cacheKey(plan), keywords: parsed, fetchedAt: now.toISOString() });
      await deps.writeCache(rows);
    } catch {
      /* non-fatal */
    }
    log.info("[dataforseo-keywords] LEDGER", {
      tenantId,
      endpoint: plan.endpoint,
      requested: plan.keywords.length,
      returned: parsed.length,
      withVolume: parsed.filter((k) => k.searchVolume != null).length,
      estCostUsd: plan.estCostUsd,
      cache: "miss",
    });
    return { status: "ok", plan, keywords: parsed, costUsd: plan.estCostUsd, detail: `${parsed.length} keywords` };
  } catch (err) {
    log.warn("[dataforseo-keywords] fetch threw (non-fatal)", { error: err instanceof Error ? err.message : String(err) });
    return { status: "error", plan, keywords: [], costUsd: 0, detail: "fetch failed" };
  }
}
