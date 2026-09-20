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
const DEFAULT_MONTHLY_CAP_USD = 250;

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

/** Free, credential-bound account readiness. This is the provider's own account row, not an inference from a paid
 * request. It is used only to recover a tripped breaker: a positive balance clears it, an exact account refusal keeps
 * it held, and an unreadable response changes nothing. */
type DataForSeoReadiness =
  | { state: "ready"; balanceUsd: number }
  | { state: "held"; code: number | null; reason: "credit_exhausted" | "account_paused" | "cost_limit" | "ip_restricted" | "authorization" | "billing" }
  | { state: "unreadable"; code: number | null };

const providerCode = (body: unknown): number | null => {
  const b = body as { status_code?: unknown; tasks?: Array<{ status_code?: unknown }> } | null;
  const task = b?.tasks?.[0]?.status_code;
  return typeof task === "number" ? task : typeof b?.status_code === "number" ? b.status_code : null;
};
const accountBalance = (body: unknown): number | null => {
  const result = (body as { tasks?: Array<{ result?: unknown }> } | null)?.tasks?.[0]?.result;
  const row = Array.isArray(result) ? result[0] : result;
  const value = (row as { money?: { balance?: unknown }; balance?: unknown } | null)?.money?.balance
    ?? (row as { balance?: unknown } | null)?.balance;
  const n = Number(value); return Number.isFinite(n) ? n : null;
};

async function readDataForSeoReadiness(env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<DataForSeoReadiness> {
  const auth = resolveAuthB64(env); if (!auth) return { state: "held", code: 40100, reason: "authorization" };
  const transport = await runDataForSeoTransport({ url: "https://api.dataforseo.com/v3/appendix/user_data", payload: [], env, fetchImpl, method: "GET", perfDetail: "provider-readiness" });
  const code = providerCode(transport.body); if (!transport.ok) {
    if (transport.status === 401 || code === 40100 || code === 40101) return { state: "held", code, reason: "authorization" };
    if (transport.status === 402) return { state: "held", code, reason: code === 40201 ? "account_paused" : code === 40203 ? "cost_limit" : code === 40207 ? "ip_restricted" : code === 40210 || code === 40200 ? "credit_exhausted" : "billing" };
    return { state: "unreadable", code };
  }
  if (code !== 20000) return code === 40201 ? { state: "held", code, reason: "account_paused" }
    : code === 40203 ? { state: "held", code, reason: "cost_limit" }
    : code === 40207 ? { state: "held", code, reason: "ip_restricted" }
    : code === 40200 || code === 40210 ? { state: "held", code, reason: "credit_exhausted" }
    : { state: "unreadable", code };
  const balanceUsd = accountBalance(transport.body);
  return balanceUsd == null ? { state: "unreadable", code } : balanceUsd > 0 ? { state: "ready", balanceUsd } : { state: "held", code: 40210, reason: "credit_exhausted" };
}

/** Recover a due DataForSEO breaker without risking a paid request. A failed/unreadable preflight never clears it. */
async function recoverDataForSeoReadiness(tenantId: string): Promise<"clear" | "held" | "unreadable"> {
  const { CREDIT_BREAKER } = await import("@/lib/cost/credit-breaker");
  const state = await CREDIT_BREAKER.peek(tenantId, {}, "dataforseo").catch(() => "held" as const);
  if (state === "clear") return "clear"; if (state === "held") return "held";
  const ready = await readDataForSeoReadiness();
  if (ready.state === "ready") { await CREDIT_BREAKER.clear(tenantId, {}, "dataforseo"); return "clear"; }
  if (ready.state === "held") { await CREDIT_BREAKER.trip(tenantId, {}, "dataforseo"); return "held"; }
  return "unreadable";
}
export const DATAFORSEO_READINESS = { read: readDataForSeoReadiness, recover: recoverDataForSeoReadiness } as const;
