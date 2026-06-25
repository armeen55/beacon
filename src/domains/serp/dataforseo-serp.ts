import "server-only";

import { log } from "@/lib/logger";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import { currentTenantId } from "@/lib/tenant-context";
import {
  recordSpendSupabase,
  getTenantSpentThisMonthUsd,
} from "@/lib/cost/budget-ledger-supabase";
import type { SerpSnapshot, SerpResult, SerpFeature } from "./serp-provider";
import { rootDomain } from "./serp-provider";

/**
 * dataforseo-serp (2026-06-25, Phase 3) — the SAFE live-SERP runner for DataForSEO.
 *
 * Money guardrails are NOT optional decoration — they are the whole point of this
 * module. Before ANY paid call it: (1) checks the connector is configured;
 * (2) serves a 14-day cache; (3) honors DRY-RUN (default ON — returns the PLANNED
 * call + est. cost, spends nothing); (4) enforces a hard monthly USD cap
 * (fail-CLOSED — over cap = no call); only then (5) fetches; then records spend in
 * the durable llm_budget_ledger (platform dataforseo-serp) + caches + logs a
 * structured ledger line. Every dependency is injectable so tests never spend.
 *
 * Smallest useful endpoint first: Google organic SERP top-N for ONE query. No
 * broad batches. Backlinks/keyword-volume are separate (deferred) endpoints.
 */

// DataForSEO "Live" Google organic ≈ $0.0006–0.002 / 10-result query. Use a
// conservative estimate so the cap trips early rather than late.
export const SERP_COST_USD = 0.003;
const SERP_CACHE_STORE = "dataforseo-serp-cache";
const SERP_CACHE_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEFAULT_MONTHLY_CAP_USD = 50;
const SERP_ENDPOINT = "https://api.dataforseo.com/v3/serp/google/organic/live/regular";

export type SerpPlan = {
  endpoint: string;
  query: string;
  locationCode: number;
  languageCode: string;
  estCostUsd: number;
};

export type SerpRunStatus = "disabled" | "cache_hit" | "dry_run" | "capped" | "ok" | "error";
export type SerpRunResult = {
  status: SerpRunStatus;
  plan: SerpPlan;
  snapshot: SerpSnapshot | null;
  costUsd: number;
  detail: string;
};

export type DataForSeoEnv = {
  login?: string;
  password?: string;
  /** Pre-encoded base64(login:password) — the "Base64 Format" string DataForSEO
   *  shows in the dashboard. When present it's used verbatim, bypassing any
   *  login/password assembly. Most robust auth path. */
  authB64?: string;
  provider?: string;
  dryRun?: string;
  monthlyCapUsd?: string;
};

function readEnv(env: NodeJS.ProcessEnv = process.env): DataForSeoEnv {
  return {
    login: env.DATAFORSEO_LOGIN,
    password: env.DATAFORSEO_PASSWORD,
    authB64: (env.DATAFORSEO_AUTH_B64 ?? "").trim().replace(/^Basic\s+/i, "") || undefined,
    provider: env.BEACON_SERP_PROVIDER,
    dryRun: env.DATAFORSEO_DRY_RUN,
    monthlyCapUsd: env.DATAFORSEO_MONTHLY_CAP_USD,
  };
}

/** The Basic-auth value to send: the dashboard base64 string if provided, else
 *  base64(login:password). Returns null when nothing usable is set. */
export function resolveAuthB64(env: NodeJS.ProcessEnv = process.env): string | null {
  const e = readEnv(env);
  if (e.authB64) return e.authB64;
  if (e.login && e.password) return Buffer.from(`${e.login}:${e.password}`).toString("base64");
  return null;
}

/** Configured = provider selected AND a usable auth (base64 OR login+password). */
export function isDataForSeoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return readEnv(env).provider === "dataforseo" && resolveAuthB64(env) !== null;
}

/** DRY-RUN is the DEFAULT. Only an explicit DATAFORSEO_DRY_RUN=false turns it off. */
export function isDryRun(env: NodeJS.ProcessEnv = process.env): boolean {
  return readEnv(env).dryRun !== "false";
}

export function monthlyCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(readEnv(env).monthlyCapUsd);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_CAP_USD;
}

/** Build the planned call (endpoint + estimated cost) without performing it. */
export function planSerpCall(
  query: string,
  opts: { locationCode?: number; languageCode?: string } = {},
): SerpPlan {
  return {
    endpoint: SERP_ENDPOINT,
    query: query.trim(),
    locationCode: opts.locationCode ?? 2840, // United States
    languageCode: opts.languageCode ?? "en",
    estCostUsd: SERP_COST_USD,
  };
}

type CacheRow = { key: string; snapshot: SerpSnapshot; fetchedAt: string };
const cacheKey = (plan: SerpPlan): string => `${plan.locationCode}|${plan.languageCode}|${plan.query.toLowerCase()}`;

/** Parse a DataForSEO organic-live response body into our SerpSnapshot. */
export function parseDataForSeoSerp(query: string, body: unknown, nowIso: string): SerpSnapshot {
  const results: SerpResult[] = [];
  const features = new Set<SerpFeature>();
  const FEATURE_MAP: Record<string, SerpFeature> = {
    ai_overview: "ai_overview",
    featured_snippet: "featured_snippet",
    people_also_ask: "people_also_ask",
    images: "image_pack",
    video: "video",
    knowledge_graph: "knowledge_panel",
  };
  try {
    const items = (body as { tasks?: Array<{ result?: Array<{ items?: Array<Record<string, unknown>> }> }> })
      ?.tasks?.[0]?.result?.[0]?.items ?? [];
    let rank = 0;
    for (const it of items) {
      const type = String(it.type ?? "");
      if (FEATURE_MAP[type]) features.add(FEATURE_MAP[type]);
      if (type === "organic" && typeof it.url === "string") {
        rank += 1;
        results.push({
          rank,
          url: it.url,
          title: String(it.title ?? ""),
          domain: rootDomain(it.url),
        });
      }
    }
  } catch {
    /* malformed body → empty results (honest, never throws) */
  }
  return { query, results, features: [...features], source: "dataforseo", fetchedAt: nowIso };
}

export type SerpRunDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  tenantId: () => Promise<string>;
  spentThisMonthUsd: (tenantId: string, now: Date) => Promise<number | null>;
  recordSpend: (tenantId: string, costUsd: number) => Promise<void>;
  readCache: () => Promise<CacheRow[]>;
  writeCache: (rows: CacheRow[]) => Promise<void>;
  fetchImpl: typeof fetch;
};

const defaultDeps: SerpRunDeps = {
  env: process.env,
  now: () => new Date(),
  tenantId: currentTenantId,
  spentThisMonthUsd: (t, now) => getTenantSpentThisMonthUsd(t, now, "dataforseo-serp"),
  recordSpend: (tenantId, costUsd) => recordSpendSupabase({ tenantId, platform: "dataforseo-serp", costUsd }),
  readCache: () => readStore<CacheRow>(SERP_CACHE_STORE, []),
  writeCache: (rows) => writeStore(SERP_CACHE_STORE, rows),
  fetchImpl: fetch,
};

/**
 * Run ONE Google-organic SERP query through the full safety gauntlet. Never
 * throws. Returns the status + (when available) the snapshot. Spends real money
 * ONLY on status "ok" (configured + not dry-run + under cap + cache miss).
 */
export async function runSerpQuery(
  query: string,
  opts: { locationCode?: number; languageCode?: string; depth?: number } = {},
  depsOverride: Partial<SerpRunDeps> = {},
): Promise<SerpRunResult> {
  const deps = { ...defaultDeps, ...depsOverride };
  const plan = planSerpCall(query, opts);
  const q = plan.query;
  if (!q) return { status: "error", plan, snapshot: null, costUsd: 0, detail: "empty query" };

  if (!isDataForSeoConfigured(deps.env)) {
    return { status: "disabled", plan, snapshot: null, costUsd: 0, detail: "DataForSEO not configured" };
  }

  const now = deps.now();
  const nowMs = now.getTime();

  // (2) cache — serve a fresh result without spending.
  try {
    const rows = await deps.readCache();
    const hit = rows.find((r) => r.key === cacheKey(plan));
    if (hit && nowMs - Date.parse(hit.fetchedAt) < SERP_CACHE_TTL_MS) {
      log.info("[dataforseo-serp] cache hit", { query: q, fetchedAt: hit.fetchedAt });
      return { status: "cache_hit", plan, snapshot: hit.snapshot, costUsd: 0, detail: "served from 14d cache" };
    }
  } catch {
    /* cache read failure is non-fatal — fall through */
  }

  // (3) DRY-RUN (default) — return the PLAN, spend nothing.
  if (isDryRun(deps.env)) {
    log.info("[dataforseo-serp] DRY-RUN (no spend)", { query: q, estCostUsd: plan.estCostUsd, endpoint: plan.endpoint });
    return { status: "dry_run", plan, snapshot: null, costUsd: 0, detail: `dry-run — would spend ~$${plan.estCostUsd}` };
  }

  // (4) hard monthly cap — FAIL-CLOSED (over cap or unknown spend = no call).
  const tenantId = await deps.tenantId();
  const cap = monthlyCapUsd(deps.env);
  const spent = await deps.spentThisMonthUsd(tenantId, now).catch(() => null);
  if (spent === null) {
    log.warn("[dataforseo-serp] spend unknown — failing closed (no call)", { tenantId });
    return { status: "capped", plan, snapshot: null, costUsd: 0, detail: "monthly spend unknown — failing closed" };
  }
  if (spent + plan.estCostUsd > cap) {
    log.warn("[dataforseo-serp] monthly cap reached — no call", { tenantId, spent, cap });
    return { status: "capped", plan, snapshot: null, costUsd: 0, detail: `cap reached (${spent.toFixed(3)}/${cap} USD this month)` };
  }

  // (5) the paid call.
  try {
    const auth = resolveAuthB64(deps.env) ?? "";
    const res = await deps.fetchImpl(plan.endpoint, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify([
        { keyword: q, location_code: plan.locationCode, language_code: plan.languageCode, depth: opts.depth ?? 10 },
      ]),
    });
    if (!res.ok) {
      log.warn("[dataforseo-serp] non-2xx", { query: q, status: res.status });
      return { status: "error", plan, snapshot: null, costUsd: 0, detail: `http ${res.status}` };
    }
    const body = await res.json();
    const snapshot = parseDataForSeoSerp(q, body, now.toISOString());

    // record spend (durable) + cache + structured ledger line.
    await deps.recordSpend(tenantId, plan.estCostUsd).catch((err) =>
      log.warn("[dataforseo-serp] durable spend write failed (non-fatal)", { error: String(err) }),
    );
    try {
      const rows = (await deps.readCache()).filter((r) => r.key !== cacheKey(plan));
      rows.push({ key: cacheKey(plan), snapshot, fetchedAt: now.toISOString() });
      await deps.writeCache(rows);
    } catch {
      /* cache write failure is non-fatal */
    }
    log.info("[dataforseo-serp] LEDGER", {
      tenantId,
      query: q,
      endpoint: plan.endpoint,
      estCostUsd: plan.estCostUsd,
      results: snapshot.results.length,
      features: snapshot.features.join(","),
      cache: "miss",
    });
    return { status: "ok", plan, snapshot, costUsd: plan.estCostUsd, detail: `${snapshot.results.length} results` };
  } catch (err) {
    log.warn("[dataforseo-serp] fetch threw (non-fatal)", { query: q, error: err instanceof Error ? err.message : String(err) });
    return { status: "error", plan, snapshot: null, costUsd: 0, detail: "fetch failed" };
  }
}
