import "server-only";

import { perfCountExternal } from "@/lib/obs/perf-log";
import type { DataForSeoEnv } from "./types";

/** dataforseo/client: env truth and the ONE shared HTTP transport for every DataForSEO call. Policy (configured, breaker,
 *  atomic reservation, cache) lives in cached-call.ts behind the funnel-boundary contract; this module owns only what every
 *  call shares: credentials, the monthly cap, and fetch plus HTTP status plus provider cost. The reservation path is the
 *  only way money moves. */

function readEnv(env: NodeJS.ProcessEnv = process.env): DataForSeoEnv {
  return {
    login: env.DATAFORSEO_LOGIN,
    password: env.DATAFORSEO_PASSWORD,
    authB64: (env.DATAFORSEO_AUTH_B64 ?? "").trim().replace(/^Basic\s+/i, "") || undefined,
    monthlyCapUsd: env.DATAFORSEO_MONTHLY_CAP_USD,
  };
}

/** The default shared per-ACCOUNT, per-platform monthly ceiling when the env is unset. Raised from $50 to
 *  $250 on operator authority (2026-07-31): a single account's research now runs case-scoped acquisition
 *  and daily hot searches, and $50 stopped a month of real work part way through. The provider's own
 *  $25/day ceiling still sits outside this and is untouched. Nothing else changes: spend is still reserved
 *  BEFORE the network, still reconciled to actual, and an unreadable ledger still fails closed. */
export const DEFAULT_MONTHLY_CAP_USD = 250;

/** The Basic-auth value to send: the dashboard base64 string if provided, else
 *  base64(login:password). Returns null when nothing usable is set. */
export function resolveAuthB64(env: NodeJS.ProcessEnv = process.env): string | null {
  const e = readEnv(env);
  if (e.authB64) return e.authB64;
  if (e.login && e.password) return Buffer.from(`${e.login}:${e.password}`).toString("base64");
  return null;
}

/** DataForSEO is the canonical provider: usable auth is the complete configuration. */
export function isDataForSeoConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return resolveAuthB64(env) !== null;
}

/** The shared per-platform monthly ceiling. A missing / NaN / non-positive env
 *  resolves to the SAFE default, never to "unlimited". */
export function monthlyCapUsd(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(readEnv(env).monthlyCapUsd);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MONTHLY_CAP_USD;
}

// ─── The core ────────────────────────────────────────────────────────────────

/** The ONE shared HTTP transport: send the request, check the HTTP status, extract the provider-reported cost. No money
 *  (reservation, record) and no configured policy; `cachedDataForSeoCall` wraps it with the atomic reservation. Never throws. */
export async function runDataForSeoTransport(args: {
  /** Full request URL (scheme + host + path). */
  url: string;
  payload: unknown;
  env: NodeJS.ProcessEnv;
  fetchImpl: typeof fetch;
  perfDetail?: string;
  /** Defaults to POST; task_get resumption uses GET (no body). */
  method?: "GET" | "POST";
}): Promise<
  | { ok: true; body: unknown }
  | { ok: false; status: number | null; message: string; body?: unknown }
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
    let body: unknown, parsed = false;
    try { body = await res.json(); parsed = true; } catch { /* an HTTP status without a cost envelope proves no refund */ }
    if (!res.ok) return { ok: false, status: res.status, message: `http ${res.status}`, ...(parsed ? { body } : {}) };
    if (!parsed) throw new Error("invalid provider envelope");
    return { ok: true, body };
  } catch (err) {
    return { ok: false, status: null, message: err instanceof Error ? err.message : String(err) };
  }
}
