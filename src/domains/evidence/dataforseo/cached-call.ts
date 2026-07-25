import "server-only";

import { createHash } from "node:crypto";

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { assertPaidCallAllowed } from "@/lib/cost/cost-breaker";
import { isDataForSeoConfigured, isDryRun, monthlyCapUsd, runDataForSeoTransport } from "./client";
import type { CachedCallResult, FunnelBoundaryDeps, ProviderEnvelope } from "./funnel-boundary";

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
/** After an UNCERTAIN Standard post (network throw/timeout after reserving), the
 *  row is held this long before any re-claim so we never silently repost. */
const AMBIGUITY_WINDOW_MS = 15 * 60 * 1000;

/** A fully resolved provider call. The registry (capabilities.ts) produces this
 *  with EXACT paths + the GET derivation; `getPath` is the only per-endpoint
 *  derivation and it is owned by the registry entry. */
export type ResolvedCall = {
  cacheKey: string; endpoint: string; endpointVersion: string; postPath: string;
  getPath: ((id: string) => string | null) | null; publicInput: Record<string, unknown>;
  locationCode: number; languageCode: string; device: string | null; modelRequested: string | null;
  payload: unknown[]; ttlMs: number; estCostUsd: number; mode: "live" | "task"; tenantId: string;
};

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
  /** Insert-or-update a full row (page-extract reuse has no prior claim row). */
  cacheUpsert: (cacheKey: string, row: Record<string, unknown>) => Promise<void>;
  breaker: (env: NodeJS.ProcessEnv, now: Date, projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};

// ── the cached, money-safe call ──
/** THE money-safe order for a fully resolved call. Miss order: configured ->
 *  claim -> dry-run -> breaker -> reserve -> (task-only pre-post receipt) ->
 *  transport -> reconcile -> write. The ENVELOPE RULE holds throughout: the row
 *  stores and hits return the FULL bounded ProviderEnvelope. */
export async function runResolvedCall(r: ResolvedCall, deps: FunnelBoundaryDeps = {}): Promise<CachedCallResult> {
  const d = resolveDeps(deps);
  const cacheKey = r.cacheKey;
  const now = d.now();

  if (!isDataForSeoConfigured(d.env)) return { state: "not_configured", cacheKey, detail: "DataForSEO not configured" };

  let claim: EvidenceCacheClaim;
  try {
    claim = await d.claimEvidenceFetch({
      cacheKey, endpoint: r.postPath, endpointVersion: r.endpointVersion,
      inputHash: sha256(stableStringify(r.publicInput)).slice(0, 40),
      inputSummary: boundedSummary(r.publicInput), locationCode: r.locationCode,
      languageCode: r.languageCode, device: r.device, modelRequested: r.modelRequested,
      claimSeconds: CLAIM_LEASE_SECONDS,
    });
  } catch (err) {
    return { state: "error", cacheKey, detail: `cache claim failed: ${short(err)}` };
  }

  if (claim.outcome === "ready") {
    return { state: "hit", envelope: (claim.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: claim.modelServed };
  }
  if (claim.outcome === "pending") {
    if (r.mode === "task" && claim.providerTaskId) return collectResolvedTask(cacheKey, (_e, id) => r.getPath?.(id) ?? null, deps);
    return { state: "waiting", cacheKey, providerTaskId: claim.providerTaskId, detail: claim.providerTaskId ? "provider task in flight" : "another invocation is fetching" };
  }

  if (isDryRun(d.env)) {
    await releaseClaim(d, cacheKey, now, "dry_run");
    return { state: "dry_run", cacheKey, detail: "dry-run: no spend" };
  }

  const verdict = await d.breaker(d.env, now, r.estCostUsd).catch(() => ({ tripped: true, reason: "global spend breaker unavailable, failing closed" }));
  if (verdict.tripped) {
    await releaseClaim(d, cacheKey, now, "capped");
    return { state: "capped", cacheKey, detail: verdict.reason ?? "global monthly ceiling reached" };
  }

  let reserved: boolean;
  try {
    reserved = await d.reserveProviderSpend(r.tenantId, PLATFORM, r.estCostUsd, monthlyCapUsd(d.env));
  } catch (err) {
    await releaseClaim(d, cacheKey, now, "reserve_error");
    return { state: "error", cacheKey, detail: `reservation failed: ${short(err)}` };
  }
  if (!reserved) {
    await releaseClaim(d, cacheKey, now, "capped");
    return { state: "capped", cacheKey, detail: `monthly cap reached for ${PLATFORM}` };
  }

  // (task) DETERMINISTIC tag = cacheKey, and a pre-post receipt persisted BEFORE
  // the network post so an uncertain outcome is never silently reposted.
  let payload = r.payload;
  if (r.mode === "task") {
    payload = tagTaskPayload(r.payload, cacheKey);
    await d.cacheWrite(cacheKey, {
      posted_attempt_at: now.toISOString(),
      fetch_claimed_until: new Date(now.getTime() + AMBIGUITY_WINDOW_MS).toISOString(),
    }).catch(() => {});
  }

  const transport = await runDataForSeoTransport({
    url: `${API_BASE}/${r.postPath}`, payload, estCostUsd: r.estCostUsd,
    env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence",
  });
  if (!transport.ok) {
    // A THROW (status null) after a task reservation is an UNCERTAIN post: the
    // provider MAY have created the task. Do NOT release (the pre-post receipt
    // holds the row for AMBIGUITY_WINDOW_MS); keep the reservation (overcount,
    // never undercount). A definite HTTP error or any live failure created no
    // task -> reconcile down and release for re-claim. (Residual: after the
    // window a genuinely-created task is orphaned and the row reposts once.)
    if (r.mode === "task" && transport.status === null) {
      return { state: "waiting", cacheKey, providerTaskId: null, detail: "post outcome uncertain; holding before any retry" };
    }
    await d.adjustProviderSpend(r.tenantId, PLATFORM, -r.estCostUsd).catch(() => {});
    await releaseClaim(d, cacheKey, now, `http_error:${transport.status ?? "throw"}`);
    return { state: "error", cacheKey, detail: transport.message };
  }

  const body = transport.body;
  const providerCost = readProviderCost(body);

  if (r.mode === "task") {
    const posted = readTaskPosted(body);
    if (!posted.accepted || !posted.taskId) {
      await reconcileFailure(d, r.tenantId, r.estCostUsd, providerCost);
      await releaseClaim(d, cacheKey, now, "task_post_rejected");
      return { state: "error", cacheKey, detail: "provider did not accept the task" };
    }
    const actual = providerCost ?? r.estCostUsd;
    await d.adjustProviderSpend(r.tenantId, PLATFORM, actual - r.estCostUsd).catch(() => {});
    await d.cacheWrite(cacheKey, {
      status: "pending", provider_task_id: posted.taskId, fetch_claimed_until: null,
      posted_at: now.toISOString(), expires_at: new Date(now.getTime() + TASK_RETENTION_MS).toISOString(), cost_usd: actual,
    });
    return { state: "waiting", cacheKey, providerTaskId: posted.taskId, detail: "task posted; resume with a free GET" };
  }

  const live = readLiveResult(body);
  if (!live.valid) {
    await reconcileFailure(d, r.tenantId, r.estCostUsd, providerCost);
    await releaseClaim(d, cacheKey, now, "envelope_invalid");
    return { state: "error", cacheKey, detail: "provider envelope was not a success" };
  }
  const actual = providerCost ?? r.estCostUsd;
  await d.adjustProviderSpend(r.tenantId, PLATFORM, actual - r.estCostUsd).catch(() => {});
  const readyAt = now.toISOString();
  await d.cacheWrite(cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    cost_usd: actual, ready_at: readyAt, expires_at: new Date(now.getTime() + r.ttlMs).toISOString(),
    fetch_claimed_until: null, content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
    provenance: { provider: "dataforseo", endpoint: r.endpoint, ts: readyAt },
  });
  return { state: "ok", envelope: (live.payload ?? {}) as ProviderEnvelope, costUsd: actual, cacheKey, modelServed: live.modelServed };
}

/** Resume a Standard-mode task with a FREE task_get. The task_get path is derived
 *  by `getPathFor` (the registry entry for the capability). Never reposts, never
 *  charges; a not-ready or transient failure is durable "waiting", not error.
 *  Stores the FULL bounded envelope. */
export async function collectResolvedTask(
  cacheKey: string,
  getPathFor: (endpoint: string, id: string) => string | null,
  deps: FunnelBoundaryDeps = {},
): Promise<CachedCallResult> {
  const d = resolveDeps(deps);
  const now = d.now();
  const row = await d.cacheRead(cacheKey).catch(() => null);
  if (!row || !row.provider_task_id) return { state: "error", cacheKey, detail: "no posted provider task to collect" };
  if (row.status === "ready" && row.payload != null && Date.parse(row.expires_at) > now.getTime()) {
    return { state: "hit", envelope: (row.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: row.model_served };
  }
  const getPath = getPathFor(row.endpoint, row.provider_task_id);
  if (!getPath) return { state: "error", cacheKey, detail: "unknown task_get path for endpoint" };

  const transport = await runDataForSeoTransport({
    url: `${API_BASE}/${getPath}`, payload: [], estCostUsd: 0,
    env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence-collect", method: "GET",
  });
  // A 404 is a wrong or expired retrieval path, never "not ready" (not-ready is
  // HTTP 200 with an in-body task code): report an honest error, do not wait forever.
  if (!transport.ok && transport.status === 404) {
    return { state: "error", cacheKey, detail: "provider task retrieval path returned 404" };
  }
  const live = transport.ok ? readLiveResult(transport.body) : { valid: false, payload: null, modelServed: null };
  if (!live.valid) {
    return { state: "waiting", cacheKey, providerTaskId: row.provider_task_id, detail: "provider task not ready yet" };
  }
  await d.cacheWrite(cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    ready_at: now.toISOString(), fetch_claimed_until: null, content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
  });
  return { state: "ok", envelope: (live.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: live.modelServed };
}

/** Inject the deterministic cacheKey as the provider `tag` on the first task
 *  object (crash-safe idempotency handle), preserving all other fields. */
function tagTaskPayload(payload: unknown[], tag: string): unknown[] {
  if (payload.length === 0) return [{ tag }];
  const [first, ...rest] = payload;
  return [{ ...(first as Record<string, unknown>), tag }, ...rest];
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** TENANT-INDEPENDENT public identity: version|endpoint|input|location|language|
 *  device|model. Never a tenant id. The registry is the only producer. */
export function identityCacheKey(p: {
  endpointVersion?: string; endpoint: string; publicInput: unknown;
  locationCode: number; languageCode: string; device?: string | null; modelRequested?: string | null;
}): string {
  const raw = [
    p.endpointVersion ?? "v3", p.endpoint, stableStringify(p.publicInput),
    String(p.locationCode), p.languageCode, p.device ?? "", p.modelRequested ?? "",
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
/** ENVELOPE RULE: project the body to the FULL bounded ProviderEnvelope (drop
 *  version/time/path/data noise, KEEP status + cost + tasks[].result). Registry
 *  parsers read inside this; hits and fresh results normalize identically. */
function boundEnvelope(body: unknown): ProviderEnvelope {
  const b = (body ?? {}) as Record<string, unknown>;
  const tasks = Array.isArray(b.tasks) ? (b.tasks as Record<string, unknown>[]) : [];
  return {
    status_code: typeof b.status_code === "number" ? b.status_code : undefined,
    status_message: typeof b.status_message === "string" ? b.status_message : undefined,
    cost: typeof b.cost === "number" ? b.cost : undefined,
    tasks: tasks.map((t) => ({
      id: typeof t.id === "string" ? t.id : undefined,
      status_code: typeof t.status_code === "number" ? t.status_code : undefined,
      status_message: typeof t.status_message === "string" ? t.status_message : undefined,
      cost: typeof t.cost === "number" ? t.cost : undefined,
      result: t.result ?? null,
    })),
  };
}
function readLiveResult(body: unknown): { valid: boolean; payload: ProviderEnvelope | null; modelServed: string | null } {
  const task = firstTask(body);
  const valid = topStatus(body) === 20000 && task != null && task.status_code === 20000;
  return { valid, payload: valid ? boundEnvelope(body) : null, modelServed: readModelServed(task) };
}
function readTaskPosted(body: unknown): { accepted: boolean; taskId: string | null } {
  const task = firstTask(body);
  const code = task?.status_code;
  const id = task?.id;
  const accepted = topStatus(body) === 20000 && task != null && (code === 20000 || code === 20100) && typeof id === "string" && id.length > 0;
  return { accepted, taskId: accepted ? (id as string) : null };
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

export function resolveDeps(deps: FunnelBoundaryDeps): CachedCallDeps {
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
    cacheUpsert: async (cacheKey, row) => {
      await getSupabaseAdmin().from("evidence_cache").upsert({ cache_key: cacheKey, ...row, updated_at: new Date().toISOString() }, { onConflict: "cache_key" });
    },
    breaker: async (e, now, projected) => {
      if (underVitest()) return { tripped: false };
      return assertPaidCallAllowed({ projectedCostUsd: projected }, { env: e, now: () => now });
    },
  };
}
