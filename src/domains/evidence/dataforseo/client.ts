import "server-only";

import { perfCountExternal } from "@/lib/obs/perf-log";
import type { DataForSeoEnv } from "./types";

/**
 * dataforseo/client — env/config truth + the ONE shared HTTP transport core for
 * every DataForSEO call. Policy (configured / dry-run / breaker / atomic
 * reservation / cache) lives in cached-call.ts behind the frozen
 * funnel-boundary contract; this module owns only what every call shares:
 * credentials resolution, the dry-run default, the monthly cap, and the
 * fetch + HTTP-status + provider-cost extraction. The legacy per-reader money
 * gauntlet (dataForSeoRequest) was deleted with its readers in Slice 6 — the
 * reservation path is the ONLY way money moves.
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

// ─── Actual-cost extraction ──────────────────────────────────────────────────

/** DataForSEO responses carry a top-level `cost` (USD) for the call. Read it as
 *  the ACTUAL charge; fall back to the conservative estimate when the response
 *  omits it (so behavior is unchanged for bodies without a cost field). Pure. */
function extractActualCostUsd(body: unknown, fallbackUsd: number): number {
  const c = (body as { cost?: unknown } | null | undefined)?.cost;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : fallbackUsd;
}

// ─── The core ────────────────────────────────────────────────────────────────

/**
 * The ONE shared HTTP transport core: send the request, check the HTTP status,
 * extract the provider-reported cost. NO money (reservation / record) and NO
 * configured / dry-run policy — callers own those. `dataForSeoRequest` wraps it
 * with the legacy money gauntlet; `cachedDataForSeoCall` wraps it with the
 * atomic Slice 6 reservation. Never throws; returns a discriminated result.
 */
export async function runDataForSeoTransport(args: {
  /** Full request URL (scheme + host + path). */
  url: string;
  payload: unknown;
  estCostUsd: number;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  perfDetail?: string;
  /** Defaults to POST; task_get resumption uses GET (no body). */
  method?: "GET" | "POST";
}): Promise<
  | { ok: true; body: unknown; costUsd: number }
  | { ok: false; status: number | null; message: string }
> {
  try {
    perfCountExternal("dataforseo", args.perfDetail);
    const auth = resolveAuthB64(args.env) ?? "";
    const method = args.method ?? "POST";
    const init: RequestInit = {
      method,
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    };
    if (method === "POST") init.body = JSON.stringify(args.payload);
    const res = await args.fetchImpl(args.url, init);
    if (!res.ok) return { ok: false, status: res.status, message: `http ${res.status}` };
    const body = await res.json();
    return { ok: true, body, costUsd: extractActualCostUsd(body, args.estCostUsd) };
  } catch (err) {
    return { ok: false, status: null, message: err instanceof Error ? err.message : String(err) };
  }
}
