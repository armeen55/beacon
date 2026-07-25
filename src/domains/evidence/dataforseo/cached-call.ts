import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { assertPaidCallAllowed } from "@/lib/cost/cost-breaker";
import { isDataForSeoConfigured, isDryRun, monthlyCapUsd, runDataForSeoTransport } from "./client";
import type { CachedCallResult, CachedCallSpec, FunnelBoundaryDeps } from "./funnel-boundary";

/**
 * cached-call (Slice 6) — the money-safe, single-flight, TENANT-INDEPENDENT
 * DataForSEO cache/transport body behind the frozen funnel-boundary contract.
 * Miss order: cacheKey -> configured? -> claim -> dry-run? -> breaker -> ATOMIC
 * reservation -> network -> reconcile to provider cost -> cache write.
 * Reservation is the ONLY money path (reserve BEFORE, adjust to actual AFTER; a
 * failed adjust keeps the reservation: overcount, never undercount). All seams
 * injectable.
 */

const API_BASE = "https://api.dataforseo.com/v3";
/** ONE shared DataForSEO monthly cap: every endpoint draws from this platform. */
const PLATFORM = "dataforseo-serp";
const CLAIM_LEASE_SECONDS = 120;
const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

// ── seams ────────────────────────────────────────────────────────────────────

type EvidenceCacheClaim = {
  outcome: "ready" | "claimed" | "pending";
  payload: unknown | null; providerTaskId: string | null; modelServed: string | null;
  readyAt: string | null; costUsd: number;
};

type EvidenceCacheRow = {
  cache_key: string; endpoint: string; status: "pending" | "ready" | "error";
  provider_task_id: string | null; payload: unknown | null; model_served: string | null;
  cost_usd: number; expires_at: string;
};

type ClaimArgs = {
  cacheKey: string; endpoint: string; endpointVersion: string; inputHash: string;
  inputSummary: string; locationCode: number; languageCode: string; device: string | null;
  modelRequested: string | null; claimSeconds: number;
};

/** Every I/O seam, all injectable so a test never spends and never touches
 *  Supabase. Production defaults use getSupabaseAdmin().rpc + .from("evidence_cache"). */
export type CachedCallDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  fetchImpl: typeof fetch;
  claimEvidenceFetch: (p: ClaimArgs) => Promise<EvidenceCacheClaim>;
  reserveProviderSpend: (tenantId: string, platform: string, amount: number, monthlyCap: number) => Promise<boolean>;
  adjustProviderSpend: (tenantId: string, platform: string, delta: number) => Promise<boolean>;
  cacheRead: (cacheKey: string) => Promise<EvidenceCacheRow | null>;
  cacheWrite: (cacheKey: string, patch: Record<string, unknown>) => Promise<void>;
  breaker: (env: NodeJS.ProcessEnv, now: Date, projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};

// ── the cached, money-safe call ──────────────────────────────────────────────

export async function cachedDataForSeoCall(spec: CachedCallSpec, deps: FunnelBoundaryDeps = {}): Promise<CachedCallResult> {
  const d = resolveDeps(deps);
  const cacheKey = computeCacheKey(spec);
  const now = d.now();

  // (2) configured? fail closed — no cache row, no network, no reservation.
  if (!isDataForSeoConfigured(d.env)) {
    return { state: "not_configured", cacheKey, detail: "DataForSEO not configured" };
  }

  // (3) single-flight claim (serialized per cache key in Postgres).
  let claim: EvidenceCacheClaim;
  try {
    claim = await d.claimEvidenceFetch({
      cacheKey, endpoint: spec.endpoint, endpointVersion: spec.endpointVersion ?? "v3",
      inputHash: sha256(stableStringify(spec.publicInput)).slice(0, 40),
      inputSummary: boundedSummary(spec.publicInput), locationCode: spec.locationCode,
      languageCode: spec.languageCode, device: spec.device ?? null,
      modelRequested: spec.modelRequested ?? null, claimSeconds: CLAIM_LEASE_SECONDS,
    });
  } catch (err) {
    return { state: "error", cacheKey, detail: `cache claim failed: ${short(err)}` };
  }

  if (claim.outcome === "ready") {
    // Fresh public result already exists: reserve NOTHING, record NOTHING.
    return { state: "hit", payload: claim.payload, costUsd: 0, cacheKey, modelServed: claim.modelServed };
  }
  if (claim.outcome === "pending") {
    // Standard task in flight -> one free GET; else another invocation owns it.
    if (spec.mode === "task" && claim.providerTaskId) return collectDataForSeoTask(cacheKey, deps);
    return {
      state: "waiting",
      cacheKey,
      providerTaskId: claim.providerTaskId,
      detail: claim.providerTaskId ? "provider task in flight" : "another invocation is fetching",
    };
  }
  // claim.outcome === "claimed" -> we own the paid path.

  // (4) dry-run (DEFAULT ON) -> release the claim honestly, NO reservation.
  if (isDryRun(d.env)) {
    await releaseClaim(d, cacheKey, now, "dry_run");
    return { state: "dry_run", cacheKey, detail: "dry-run: no spend" };
  }

  // (5) global cross-lane breaker -> release the claim, NO reservation.
  const verdict = await d
    .breaker(d.env, now, spec.estCostUsd)
    .catch(() => ({ tripped: true, reason: "global spend breaker unavailable, failing closed" }));
  if (verdict.tripped) {
    await releaseClaim(d, cacheKey, now, "capped");
    return { state: "capped", cacheKey, detail: verdict.reason ?? "global monthly ceiling reached" };
  }

  // (6) ATOMIC reservation BEFORE the network call.
  let reserved: boolean;
  try {
    reserved = await d.reserveProviderSpend(spec.tenantId, PLATFORM, spec.estCostUsd, monthlyCapUsd(d.env));
  } catch (err) {
    await releaseClaim(d, cacheKey, now, "reserve_error");
    return { state: "error", cacheKey, detail: `reservation failed: ${short(err)}` };
  }
  if (!reserved) {
    await releaseClaim(d, cacheKey, now, "capped");
    return { state: "capped", cacheKey, detail: `monthly cap reached for ${PLATFORM}` };
  }

  // (7) network via the ONE shared transport core.
  const transport = await runDataForSeoTransport({
    url: `${API_BASE}/${spec.endpoint}`, payload: spec.payload, estCostUsd: spec.estCostUsd,
    env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence",
  });
  // (8) transport failure AFTER reservation: no successful call means no charge,
  // so reconcile DOWN best-effort; a failed adjust keeps the reservation.
  if (!transport.ok) {
    await d.adjustProviderSpend(spec.tenantId, PLATFORM, -spec.estCostUsd).catch(() => {});
    await releaseClaim(d, cacheKey, now, `http_error:${transport.status ?? "throw"}`);
    return { state: "error", cacheKey, detail: transport.message };
  }

  const body = transport.body;
  const providerCost = readProviderCost(body); // number | null (null = unreported)

  if (spec.mode === "task") {
    const posted = readTaskPosted(body);
    if (!posted.accepted || !posted.taskId) {
      await reconcileFailure(d, spec.tenantId, spec.estCostUsd, providerCost);
      await releaseClaim(d, cacheKey, now, "task_post_rejected");
      return { state: "error", cacheKey, detail: "provider did not accept the task" };
    }
    const actual = providerCost ?? spec.estCostUsd;
    await d.adjustProviderSpend(spec.tenantId, PLATFORM, actual - spec.estCostUsd).catch(() => {});
    // expires_at = 30-day retention window (also the task result's freshness window).
    await d.cacheWrite(cacheKey, {
      status: "pending", provider_task_id: posted.taskId, fetch_claimed_until: null,
      posted_at: now.toISOString(), expires_at: new Date(now.getTime() + TASK_RETENTION_MS).toISOString(), cost_usd: actual,
    });
    return { state: "waiting", cacheKey, providerTaskId: posted.taskId, detail: "task posted; resume with a free GET" };
  }

  // mode "live": one resolved result.
  const live = readLiveResult(body);
  if (!live.valid) {
    await reconcileFailure(d, spec.tenantId, spec.estCostUsd, providerCost);
    await releaseClaim(d, cacheKey, now, "envelope_invalid");
    return { state: "error", cacheKey, detail: "provider envelope was not a success" };
  }
  const actual = providerCost ?? spec.estCostUsd;
  await d.adjustProviderSpend(spec.tenantId, PLATFORM, actual - spec.estCostUsd).catch(() => {});
  const readyAt = now.toISOString();
  await d.cacheWrite(cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    cost_usd: actual, ready_at: readyAt, expires_at: new Date(now.getTime() + spec.ttlMs).toISOString(),
    fetch_claimed_until: null, content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
    provenance: { provider: "dataforseo", endpoint: spec.endpoint, ts: readyAt },
  });
  return { state: "ok", payload: live.payload, costUsd: actual, cacheKey, modelServed: live.modelServed };
}

/** Resume a Standard-mode task with a FREE task_get. Never reposts, never
 *  charges; a not-ready or transient failure is durable "waiting", not error. */
export async function collectDataForSeoTask(cacheKey: string, deps: FunnelBoundaryDeps = {}): Promise<CachedCallResult> {
  const d = resolveDeps(deps);
  const now = d.now();
  const row = await d.cacheRead(cacheKey).catch(() => null);
  if (!row || !row.provider_task_id) return { state: "error", cacheKey, detail: "no posted provider task to collect" };
  if (row.status === "ready" && row.payload != null && Date.parse(row.expires_at) > now.getTime()) {
    return { state: "hit", payload: row.payload, costUsd: 0, cacheKey, modelServed: row.model_served };
  }
  const getPath = deriveTaskGetPath(row.endpoint, row.provider_task_id);
  if (!getPath) return { state: "error", cacheKey, detail: "unknown task_get path for endpoint" };

  const transport = await runDataForSeoTransport({
    url: `${API_BASE}/${getPath}`,
    payload: [],
    estCostUsd: 0,
    env: d.env,
    fetchImpl: d.fetchImpl,
    perfDetail: "evidence-collect",
    method: "GET",
  });
  // A transient GET failure OR a not-ready envelope is resumable waiting.
  const live = transport.ok ? readLiveResult(transport.body) : { valid: false, payload: null, modelServed: null };
  if (!live.valid) {
    return { state: "waiting", cacheKey, providerTaskId: row.provider_task_id, detail: "provider task not ready yet" };
  }
  await d.cacheWrite(cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    ready_at: now.toISOString(), fetch_claimed_until: null, content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
  });
  // The GET itself is free; the POST already reconciled the cost onto the row.
  return { state: "ok", payload: live.payload, costUsd: 0, cacheKey, modelServed: live.modelServed };
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** TENANT-INDEPENDENT public identity: version|endpoint|input|location|language|
 *  device|model. Never a tenant id. */
function computeCacheKey(spec: CachedCallSpec): string {
  const raw = [
    spec.endpointVersion ?? "v3", spec.endpoint, stableStringify(spec.publicInput),
    String(spec.locationCode), spec.languageCode, spec.device ?? "", spec.modelRequested ?? "",
  ].join("|");
  return "dfs2_" + sha256(raw).slice(0, 40);
}

/** Mark the row error, which releases the lease honestly: claim_evidence_fetch
 *  treats an errored row as immediately re-claimable. */
async function releaseClaim(d: CachedCallDeps, cacheKey: string, now: Date, detail: string): Promise<void> {
  await d
    .cacheWrite(cacheKey, { status: "error", error_at: now.toISOString(), error_detail: detail.slice(0, 200), fetch_claimed_until: null })
    .catch(() => {});
}

/** Reconcile after an HTTP-200-but-not-success envelope. Reconcile DOWN only
 *  when the provider genuinely did not charge; unknown cost keeps the reservation. */
async function reconcileFailure(d: CachedCallDeps, tenantId: string, estCostUsd: number, providerCost: number | null): Promise<void> {
  if (providerCost === null) return; // unknown -> keep reservation (overcount, never undercount)
  const delta = providerCost <= 0 ? -estCostUsd : providerCost - estCostUsd;
  await d.adjustProviderSpend(tenantId, PLATFORM, delta).catch(() => {});
}

function firstTask(body: unknown): Record<string, unknown> | null {
  const tasks = (body as { tasks?: unknown })?.tasks;
  return Array.isArray(tasks) && tasks.length > 0 ? (tasks[0] as Record<string, unknown>) : null;
}
function topStatus(body: unknown): number | null {
  const s = (body as { status_code?: unknown })?.status_code;
  return typeof s === "number" ? s : null;
}
function readProviderCost(body: unknown): number | null {
  const c = (body as { cost?: unknown })?.cost;
  return typeof c === "number" && Number.isFinite(c) && c >= 0 ? c : null;
}
function readModelServed(task: Record<string, unknown> | null): string | null {
  if (!task) return null;
  const r = (Array.isArray(task.result) ? task.result[0] : task.result) as Record<string, unknown> | undefined;
  const m = (r?.model_name ?? r?.model ?? task.model) as unknown;
  return typeof m === "string" && m.length > 0 ? m : null;
}
function readLiveResult(body: unknown): { valid: boolean; payload: unknown; modelServed: string | null } {
  const task = firstTask(body);
  const valid = topStatus(body) === 20000 && task != null && task.status_code === 20000;
  return { valid, payload: task && task.result != null ? task.result : body, modelServed: readModelServed(task) };
}
function readTaskPosted(body: unknown): { accepted: boolean; taskId: string | null } {
  const task = firstTask(body);
  const code = task?.status_code;
  const id = task?.id;
  const accepted = topStatus(body) === 20000 && task != null && (code === 20000 || code === 20100) && typeof id === "string" && id.length > 0;
  return { accepted, taskId: accepted ? (id as string) : null };
}

/** Fail-closed map from a task_post endpoint to its free task_get path. */
function deriveTaskGetPath(endpoint: string, taskId: string): string | null {
  const e = endpoint.replace(/^\/+|\/+$/g, "");
  if (!e.endsWith("/task_post")) return null;
  const base = e.slice(0, -"/task_post".length);
  if (base.startsWith("serp/")) return `${base}/task_get/advanced/${taskId}`;
  if (base.endsWith("/llm_responses") || base.endsWith("/llm_scraper")) return `${base}/task_get/${taskId}`;
  return null;
}

function pickModelId(payload: unknown): string | null {
  const p = payload as { items?: unknown } | unknown[];
  const arr = Array.isArray(p) ? (Array.isArray(p[0]) ? p[0] : p) : (p as { items?: unknown }).items;
  if (Array.isArray(arr)) {
    for (const it of arr) {
      const id = typeof it === "string" ? it : ((it as Record<string, unknown>)?.model_name ?? (it as Record<string, unknown>)?.model ?? (it as Record<string, unknown>)?.id);
      if (typeof id === "string" && id.length > 0) return id;
    }
  }
  return null;
}

function short(err: unknown): string {
  return (err instanceof Error ? err.message : String(err)).slice(0, 120);
}
function boundedSummary(input: Record<string, unknown>): string {
  return stableStringify(input).slice(0, 200);
}
function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}
/** Deterministic JSON: object keys sorted recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}

// ── production default seams (lazy; never touched by an injecting test) ──────

function underVitest(): boolean {
  return process.env.VITEST === "true";
}

function resolveDeps(deps: FunnelBoundaryDeps): CachedCallDeps {
  return { ...buildDefaultDeps(process.env), ...(deps as unknown as Partial<CachedCallDeps>) };
}

function buildDefaultDeps(env: NodeJS.ProcessEnv): CachedCallDeps {
  const rpc = (fn: string, params: Record<string, unknown>) => getSupabaseAdmin().rpc(fn, params);
  return {
    env,
    now: () => new Date(),
    fetchImpl: fetch,
    claimEvidenceFetch: async (p) => {
      const { data, error } = await rpc("claim_evidence_fetch", {
        p_cache_key: p.cacheKey, p_endpoint: p.endpoint, p_endpoint_version: p.endpointVersion,
        p_input_hash: p.inputHash, p_input_summary: p.inputSummary, p_location_code: p.locationCode,
        p_language_code: p.languageCode, p_device: p.device, p_model_requested: p.modelRequested,
        p_claim_seconds: p.claimSeconds,
      });
      if (error) throw new Error(error.message);
      const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
      return {
        outcome: ((row?.outcome as string) ?? "claimed") as EvidenceCacheClaim["outcome"],
        payload: row?.payload ?? null,
        providerTaskId: (row?.provider_task_id as string) ?? null,
        modelServed: (row?.model_served as string) ?? null,
        readyAt: (row?.ready_at as string) ?? null,
        costUsd: Number(row?.cost_usd ?? 0),
      };
    },
    reserveProviderSpend: async (tenantId, platform, amount, monthlyCap) => {
      const { data, error } = await rpc("reserve_provider_spend", { p_tenant_id: tenantId, p_platform: platform, p_amount: amount, p_monthly_cap: monthlyCap });
      if (error) throw new Error(error.message);
      return data === true;
    },
    adjustProviderSpend: async (tenantId, platform, delta) => {
      const { data, error } = await rpc("adjust_provider_spend", { p_tenant_id: tenantId, p_platform: platform, p_delta: delta });
      return error ? false : data === true;
    },
    cacheRead: async (cacheKey) => {
      const { data } = await getSupabaseAdmin().from("evidence_cache").select("*").eq("cache_key", cacheKey).maybeSingle();
      return (data as EvidenceCacheRow | null) ?? null;
    },
    cacheWrite: async (cacheKey, patch) => {
      await getSupabaseAdmin().from("evidence_cache").update({ ...patch, updated_at: new Date().toISOString() }).eq("cache_key", cacheKey);
    },
    breaker: async (e, now, projected) => {
      if (underVitest()) return { tripped: false };
      return assertPaidCallAllowed({ projectedCostUsd: projected }, { env: e, now: () => now });
    },
  };
}
