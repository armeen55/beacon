import "server-only";

import { createHash } from "node:crypto";

import { log } from "@/lib/logger";
import { perfCountExternal } from "@/lib/obs/perf-log";
import { recordSpendSupabase, getTenantSpentThisMonthUsd } from "@/lib/cost/budget-ledger-supabase";
import { assertPaidCallAllowed } from "@/lib/cost/cost-breaker";
import type {
  DataForSeoEnv,
  DataForSeoResult,
  DataForSeoRequestArgs,
  DataForSeoClientDeps,
  DataForSeoRequestShape,
  DataForSeoProvenance,
} from "./types";

/**
 * dataforseo/client — the ONE canonical boundary every DataForSEO call flows
 * through. Product Truth: DataForSEO is Beacon's single external SEO and
 * AI-observation backbone. This module owns the money gauntlet so no endpoint
 * caller can bypass it:
 *
 *   1. not_configured — credentials absent, fail closed, ZERO network.
 *   2. dry_run        — DATAFORSEO_DRY_RUN is the DEFAULT; echoes the exact
 *                       request it WOULD send, ZERO network.
 *   3. capped         — global cross-lane breaker OR the per-platform monthly
 *                       cap is reached; checked BEFORE any network call.
 *   4. ok             — payload + the ACTUAL cost the provider reported, spend
 *                       recorded to the ledger, provenance stamped.
 *   5. error          — non-2xx or a thrown fetch, as a typed value (never a
 *                       throw into a render path).
 *
 * Cache-first is the CALLER's job (each reader owns its own cache); a cache hit
 * returns before ever reaching this boundary, so it costs zero. Every I/O
 * dependency is injectable so tests never spend and never touch Supabase.
 */

// ─── Env contract (canonical home; the readers re-export for stability) ──────

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

/** The default shared per-platform monthly ceiling when the env is unset. */
export const DEFAULT_MONTHLY_CAP_USD = 50;

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

/** The shared per-platform monthly ceiling. A missing / NaN / non-positive env
 *  resolves to the SAFE default, never to "unlimited". */
export function monthlyCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(readEnv(env).monthlyCapUsd);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_CAP_USD;
}

// ─── Idempotency ─────────────────────────────────────────────────────────────

/** Deterministic per-logical-task key: endpoint + payload + tenant + UTC day.
 *  A retried call for the same task on the same day produces the same key, so a
 *  downstream store can dedupe. Pure. */
export function dataForSeoIdempotencyKey(args: {
  endpoint: string;
  payload: unknown;
  tenantId: string;
  now: Date;
}): string {
  const day = args.now.toISOString().slice(0, 10);
  const canonical = JSON.stringify({ e: args.endpoint, p: args.payload, t: args.tenantId, d: day });
  return `dfs_${createHash("sha256").update(canonical).digest("hex").slice(0, 32)}`;
}

// ─── Actual-cost extraction ──────────────────────────────────────────────────

/** DataForSEO responses carry a top-level `cost` (USD) for the call. Read it as
 *  the ACTUAL charge; fall back to the conservative estimate when the response
 *  omits it (so behavior is unchanged for bodies without a cost field). Pure. */
function extractActualCostUsd(body: unknown, fallbackUsd: number): number {
  const c = (body as { cost?: unknown } | null | undefined)?.cost;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : fallbackUsd;
}

// ─── Default I/O ─────────────────────────────────────────────────────────────

function underVitest(): boolean {
  return process.env.VITEST === "true";
}

const defaultClientDeps: DataForSeoClientDeps = {
  env: process.env,
  // SHARED DataForSEO budget: cap + spend both ride the "dataforseo-serp"
  // platform so EVERY DataForSEO endpoint draws from ONE monthly cap.
  spentThisMonthUsd: (t, now) => getTenantSpentThisMonthUsd(t, now, "dataforseo-serp"),
  recordSpend: (tenantId, costUsd) => recordSpendSupabase({ tenantId, platform: "dataforseo-serp", costUsd }).then(() => {}),
  fetchImpl: fetch,
  globalBreaker: async (env, now, projectedCostUsd) => {
    // Hermetic under vitest: never read the real cross-lane ledger from a test.
    if (underVitest()) return { tripped: false };
    return assertPaidCallAllowed({ projectedCostUsd }, { env, now: () => now });
  },
};

// ─── The core ────────────────────────────────────────────────────────────────

/**
 * Run ONE DataForSEO task through the full money gauntlet. Never throws. Spends
 * real money ONLY on state "ok" (configured + not dry-run + under both ceilings).
 * The caller is responsible for cache-first (a hit returns before this is called)
 * and for parsing `body` on ok.
 */
export async function dataForSeoRequest(
  args: DataForSeoRequestArgs,
  depsOverride: Partial<DataForSeoClientDeps> = {},
): Promise<DataForSeoResult> {
  const deps = { ...defaultClientDeps, ...depsOverride };
  const now = args.now ?? new Date();
  const idempotencyKey = dataForSeoIdempotencyKey({
    endpoint: args.endpoint,
    payload: args.payload,
    tenantId: args.tenantId,
    now,
  });

  // (1) not_configured — fail closed, ZERO network.
  if (!isDataForSeoConfigured(deps.env)) {
    return { state: "not_configured", idempotencyKey, detail: "DataForSEO not configured" };
  }

  // (2) dry_run (DEFAULT) — echo the exact request shape, ZERO network.
  if (isDryRun(deps.env)) {
    const request: DataForSeoRequestShape = {
      endpoint: args.endpoint,
      method: "POST",
      location: args.location,
      language: args.language,
      payload: args.payload,
    };
    return {
      state: "dry_run",
      request,
      estCostUsd: args.estCostUsd,
      idempotencyKey,
      detail: `dry-run: would spend about $${args.estCostUsd}`,
    };
  }

  // (3) global cross-lane breaker (OUTER guard) — fail closed. Reached only on
  // the paid path (dry-run already returned above), so it never blocks free work.
  const breaker = await deps
    .globalBreaker(deps.env, now, args.estCostUsd)
    .catch(() => ({ tripped: true, reason: "global spend breaker unavailable, failing closed" }));
  if (breaker.tripped) {
    return { state: "capped", idempotencyKey, detail: breaker.reason ?? "global monthly ceiling reached" };
  }

  // (4) per-platform monthly cap — fail closed (over cap OR unknown spend).
  const cap = monthlyCapUsd(deps.env);
  const spent = await deps.spentThisMonthUsd(args.tenantId, now).catch(() => null);
  if (spent === null) {
    return { state: "capped", idempotencyKey, detail: "monthly spend unknown, failing closed" };
  }
  if (spent + args.estCostUsd > cap) {
    return { state: "capped", idempotencyKey, detail: `cap reached (${spent.toFixed(3)}/${cap} USD this month)` };
  }

  // (5) the paid call.
  try {
    perfCountExternal("dataforseo", args.perfDetail);
    const auth = resolveAuthB64(deps.env) ?? "";
    const res = await deps.fetchImpl(args.endpoint, {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify(args.payload),
    });
    if (!res.ok) {
      return { state: "error", status: res.status, message: `http ${res.status}`, idempotencyKey, detail: `http ${res.status}` };
    }
    const body = await res.json();
    const costUsd = extractActualCostUsd(body, args.estCostUsd);

    // Record the ACTUAL cost, attributed to the account. Never blocks the return.
    await deps
      .recordSpend(args.tenantId, costUsd)
      .catch((err) => log.warn("[dataforseo] durable spend write failed (non-fatal)", { error: String(err) }));

    const provenance: DataForSeoProvenance = {
      provider: "dataforseo",
      endpoint: args.endpoint,
      payloadSummary: args.payloadSummary,
      location: args.location,
      language: args.language,
      timestamp: now.toISOString(),
      costUsd,
      idempotencyKey,
    };
    log.info("[dataforseo] LEDGER", {
      tenantId: args.tenantId,
      endpoint: args.endpoint,
      estCostUsd: args.estCostUsd,
      costUsd,
      idempotencyKey,
    });
    return { state: "ok", body, costUsd, provenance, idempotencyKey, detail: "ok" };
  } catch (err) {
    return {
      state: "error",
      status: null,
      message: err instanceof Error ? err.message : String(err),
      idempotencyKey,
      detail: "fetch failed",
    };
  }
}
