import "server-only";
import { createHash } from "node:crypto";
import { isDataForSeoConfigured, isDryRun, monthlyCapUsd, runDataForSeoTransport } from "./client";
import { resolveDeps } from "./default-deps";
import { classifyPaidResponse, classifyTaskStatus } from "./status-contract";
import type { CachedCallResult, FunnelBoundaryDeps, ProviderEnvelope } from "./funnel-boundary";

/**
 * cached-call (Slice 6 / 6E) - the money-safe, single-flight, TENANT-INDEPENDENT
 * DataForSEO cache/transport body behind the frozen funnel-boundary contract.
 * Miss order: cacheKey -> configured? -> claim -> dry-run? -> breaker -> ATOMIC
 * reservation -> pre-call receipt -> network -> reconcile -> cache write.
 * Reservation is the ONLY money path (reserve BEFORE, adjust to actual AFTER; a
 * failed adjust keeps the reservation: overcount, never undercount).
 *
 * CAP HONESTY: the monthly cap is RESERVATION based, not a hard per-dollar ceiling.
 * reserve_provider_spend refuses any call whose ESTIMATE would cross the cap;
 * reconciliation may then move recorded spend UP to the provider's actual, so spend
 * can overshoot by at most (actual minus estimate) on the single last call through.
 * Every registry estCostUsd is therefore set deliberately high.
 *
 * DISPOSITIONS: every error carries a structured FailureDisposition; callers never
 * parse detail strings. ONE durable hold column (quarantined_at) carries BOTH kinds
 * of no-auto-retry state, told apart by error_detail:
 *   "uncertain:" - the provider may have charged for a call we cannot name, so the
 *     reservation is KEPT, indefinitely. A Standard row can still exit for free via
 *     the tasks_ready listing matched on tag = cacheKey; a Live row cannot.
 *   "blocked:" - the provider REFUSED the request and REPORTED zero cost (documented
 *     pre-execution HTTP 401/402/404, or a terminal/unknown in-body code): refunded,
 *     then held so nothing automatic re-runs it. It never lists tasks_ready (no task
 *     exists) and never decays into quarantined or unsupported.
 * The guarantee is never "exactly once": it is that Beacon never automatically
 * retries a paid request after an ambiguous outcome or a refusal.
 */

const API_BASE = "https://api.dataforseo.com/v3";
/** ONE shared DataForSEO monthly cap: every endpoint draws from this platform. */
const PLATFORM = "dataforseo-serp";
const CLAIM_LEASE_SECONDS = 120;
const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** After an UNCERTAIN call (transport throw after reserving) the row is held this
 *  long before any re-claim, underneath the durable quarantine mark. */
const AMBIGUITY_WINDOW_MS = 15 * 60 * 1000;
/** One free tasks_ready listing serves a whole family for this long. Entries are
 *  FREE GETs, so staleness only ever costs one extra free refetch. */
const LISTING_MEMO_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** A fully resolved provider call. The registry (capabilities.ts) produces it with
 *  EXACT paths; `getPath` (free task_get) and `tasksReadyPath` (free finished-task
 *  listing, for quarantine recovery) are its only per-endpoint derivations. */
export type ResolvedCall = {
  cacheKey: string; endpoint: string; endpointVersion: string; postPath: string;
  getPath: ((id: string) => string | null) | null; tasksReadyPath: string | null;
  publicInput: Record<string, unknown>; locationCode: number; languageCode: string;
  device: string | null; modelRequested: string | null;
  payload: unknown[]; ttlMs: number; estCostUsd: number; mode: "live" | "task"; tenantId: string;
};
// ── seams ────────────────────────────────────────────────────────────────────
type EvidenceCacheClaim = {
  outcome: "ready" | "claimed" | "pending"; payload: unknown | null; providerTaskId: string | null;
  modelServed: string | null; readyAt: string | null; costUsd: number;
};

type EvidenceCacheRow = {
  cache_key: string; endpoint: string; status: "pending" | "ready" | "error";
  provider_task_id: string | null; payload: unknown | null; model_served: string | null;
  cost_usd: number; expires_at: string;
  /** Set = a durable hold; nothing automatic clears it or re-runs the request. */
  quarantined_at?: string | null;
  /** The hold's REASON: "blocked:<reason>" = refused and refunded; anything else
   *  (including "uncertain:...") = possibly paid and possibly recoverable. */
  error_detail?: string | null;
};

type ClaimArgs = {
  cacheKey: string; endpoint: string; endpointVersion: string; inputHash: string; inputSummary: string;
  locationCode: number; languageCode: string; device: string | null; modelRequested: string | null; claimSeconds: number;
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

/** THE money-safe order for a resolved call: configured -> claim -> dry-run ->
 *  breaker -> reserve -> pre-call receipt (BOTH modes) -> transport -> reconcile ->
 *  write. ENVELOPE RULE throughout: rows store and hits return the FULL envelope. */
export async function runResolvedCall(r: ResolvedCall, deps: FunnelBoundaryDeps = {}): Promise<CachedCallResult> {
  const d = resolveDeps(deps);
  const cacheKey = r.cacheKey;
  const now = d.now();
  const paths = { getPath: (_e: string, id: string) => r.getPath?.(id) ?? null, tasksReadyPath: () => r.tasksReadyPath, ttlMsFor: () => r.ttlMs };

  if (!isDataForSeoConfigured(d.env)) return { state: "not_configured", cacheKey, detail: "DataForSEO not configured" };

  let claim: EvidenceCacheClaim;
  try {
    claim = await d.claimEvidenceFetch({
      cacheKey, endpoint: r.postPath, endpointVersion: r.endpointVersion, locationCode: r.locationCode,
      inputHash: sha256(stableStringify(r.publicInput)).slice(0, 40), inputSummary: boundedSummary(r.publicInput),
      languageCode: r.languageCode, device: r.device, modelRequested: r.modelRequested, claimSeconds: CLAIM_LEASE_SECONDS,
    });
  } catch (err) {
    return { state: "error", cacheKey, disposition: "none", detail: `I could not reserve this fetch (${short(err)}); I will try it again on the next pass.` };
  }

  if (claim.outcome === "ready") return { state: "hit", envelope: (claim.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: claim.modelServed };
  if (claim.outcome === "pending") {
    // Task mode ALWAYS routes into the free collect (task_get resumption + free
    // tasks_ready recovery of a quarantined row): charges nothing, never reposts.
    if (r.mode === "task") return collectResolvedTask(cacheKey, paths, deps);
    // Live pending is honest ONLY when the row carries no durable hold; a held live
    // attempt has no free way back and must say which hold it is. Reads fail closed.
    try {
      const liveRow = await d.cacheRead(cacheKey);
      const refused = blockedReason(liveRow);
      if (refused) return blockedResult(cacheKey, refused);
      if (liveRow?.quarantined_at) return { state: "error", cacheKey, disposition: "quarantined", detail: "I may have paid for this answer once and could not confirm or keep it, and there is no free list for this kind of request. I set it aside for good rather than buy it twice." };
    } catch {
      return { state: "error", cacheKey, disposition: "none", detail: "I could not read my own records; I will not call the provider until I can." };
    }
    return { state: "waiting", cacheKey, providerTaskId: claim.providerTaskId, costUsd: 0, detail: "Another run is already fetching this; I will pick up its result." };
  }

  // A claim must never pair a LIVE task id with permission to post: collect the
  // existing task for free instead of paying for a duplicate.
  if (r.mode === "task" && claim.providerTaskId) return collectResolvedTask(cacheKey, paths, deps);

  if (isDryRun(d.env)) { await releaseClaim(d, cacheKey, now, "dry_run"); return { state: "dry_run", cacheKey, detail: "dry-run: no spend" }; }

  const verdict = await d.breaker(d.env, now, r.estCostUsd).catch(() => ({ tripped: true, reason: "global spend breaker unavailable, failing closed" }));
  if (verdict.tripped) { await releaseClaim(d, cacheKey, now, "capped"); return { state: "capped", cacheKey, detail: verdict.reason ?? "global monthly ceiling reached" }; }

  let reserved: boolean;
  try {
    reserved = await d.reserveProviderSpend(r.tenantId, PLATFORM, r.estCostUsd, monthlyCapUsd(d.env));
  } catch (err) {
    await releaseClaim(d, cacheKey, now, "reserve_error");
    return { state: "error", cacheKey, disposition: "none", detail: `I could not set aside budget for this (${short(err)}); I made no provider call and will try again.` };
  }
  if (!reserved) { await releaseClaim(d, cacheKey, now, "capped"); return { state: "capped", cacheKey, detail: `monthly cap reached for ${PLATFORM}` }; }
  // ONE pre-call receipt for BOTH modes, persisted BEFORE the network, so an
  // uncertain outcome is never re-bought; task payloads carry tag = cacheKey.
  const payload = r.mode === "task" ? tagTaskPayload(r.payload, cacheKey) : r.payload;
  try {
    await d.cacheWrite(cacheKey, { posted_attempt_at: now.toISOString(), fetch_claimed_until: new Date(now.getTime() + AMBIGUITY_WINDOW_MS).toISOString() });
  } catch (err) {
    // Fail closed: the anti-repost receipt did not persist. ZERO network calls
    // (nothing is bought yet); reconcile down and release for a clean re-claim.
    await d.adjustProviderSpend(r.tenantId, PLATFORM, -r.estCostUsd).catch(() => {});
    await releaseClaim(d, cacheKey, now, "precall_receipt_failed");
    return { state: "error", cacheKey, disposition: "none", detail: `I could not save the pre-call receipt (${short(err)}); I made no provider call and will try again.` };
  }

  const transport = await runDataForSeoTransport({ url: `${API_BASE}/${r.postPath}`, payload, estCostUsd: r.estCostUsd, env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence" });
  if (!transport.ok) {
    // Only HTTP 401/402/404 are documented pre-execution rejections (charged
    // nothing): refund, then HOLD the row. Releasing it is what silently re-runs a
    // refused paid request, and a raw 404 must never read as a dead task. A throw,
    // 5xx, or any other status may have run and billed: hold and keep the money.
    if (transport.status === 401 || transport.status === 402 || transport.status === 404) {
      await d.adjustProviderSpend(r.tenantId, PLATFORM, -r.estCostUsd).catch(() => {});
      if (!(await holdBlocked(d, cacheKey, now, `HTTP ${transport.status}`))) return { state: "error", cacheKey, disposition: "none", detail: "The provider refused this request and I could not record the refusal; I am holding it briefly and will note it properly on the next pass." };
      return blockedResult(cacheKey, `HTTP ${transport.status}`);
    }
    return holdUncertain(d, r.mode, cacheKey, now, "I could not confirm whether the provider took and charged this request, so I paused it.");
  }

  const body = transport.body;
  const providerCost = readProviderCost(body);

  if (r.mode === "task") {
    const posted = readTaskPosted(body);
    // A rejection is never automatically retried on cost alone: the STATUS decides.
    if (!posted.accepted || !posted.taskId) return applyPaidRejection(d, r, body, providerCost, now, "The provider did not clearly accept this task and may still have charged for it, so I paused it.");
    const actual = providerCost ?? r.estCostUsd;
    await d.adjustProviderSpend(r.tenantId, PLATFORM, actual - r.estCostUsd).catch(() => {});
    try {
      await d.cacheWrite(cacheKey, {
        status: "pending", provider_task_id: posted.taskId, fetch_claimed_until: null,
        posted_at: now.toISOString(), expires_at: new Date(now.getTime() + TASK_RETENTION_MS).toISOString(), cost_usd: actual,
      });
    } catch {
      // The task WAS accepted and charged but its id did not persist: hold it
      // and keep the reservation (the task exists; overcount, never undercount).
      return holdUncertain(d, r.mode, cacheKey, now, "The provider took this task but I could not save its receipt, so I paused it.");
    }
    // costUsd = the provider-reported actual for THIS accepted POST, contributed once.
    return { state: "waiting", cacheKey, providerTaskId: posted.taskId, costUsd: actual, modelRequested: r.modelRequested, detail: "I posted this task to the provider; I will collect it with a free follow-up." };
  }

  const live = readLiveResult(body);
  // Same policy for a Live rejection: a reported zero cost alone never authorizes a
  // silent paid retry, and a Live 40401/40403 proves nothing about a task we posted.
  if (!live.valid) return applyPaidRejection(d, r, body, providerCost, now, "The provider answered without a usable result and may have charged for it, so I paused it.");
  const actual = providerCost ?? r.estCostUsd;
  await d.adjustProviderSpend(r.tenantId, PLATFORM, actual - r.estCostUsd).catch(() => {});
  const readyAt = now.toISOString();
  // The PAID answer is saved with the free write retried twice more, and the claim
  // is NEVER released here: re-fetching it would buy the same answer a second time.
  const saved = await writeRetried(d, cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    cost_usd: actual, ready_at: readyAt, expires_at: new Date(now.getTime() + r.ttlMs).toISOString(),
    fetch_claimed_until: null, posted_attempt_at: null, content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
    provenance: { provider: "dataforseo", endpoint: r.endpoint, ts: readyAt },
  });
  if (!saved) return holdUncertain(d, r.mode, cacheKey, now, "I paid for this answer but could not save it after three tries, so I paused it instead of buying it again.");
  return { state: "ok", envelope: (live.payload ?? {}) as ProviderEnvelope, costUsd: actual, cacheKey, modelServed: live.modelServed, modelRequested: r.modelRequested };
}

/** Resume a Standard task with a FREE task_get, or recover a QUARANTINED row via
 *  the free listing. Registry-owned paths; never reposts, never charges; not-ready
 *  and transport failures stay durable "waiting"; stores the FULL envelope. */
export async function collectResolvedTask(
  cacheKey: string,
  paths: { getPath: (endpoint: string, id: string) => string | null; tasksReadyPath: (endpoint: string) => string | null; ttlMsFor: (endpoint: string) => number | null },
  deps: FunnelBoundaryDeps = {},
): Promise<CachedCallResult> {
  const d = resolveDeps(deps);
  const now = d.now();
  let row: EvidenceCacheRow | null;
  try { row = await d.cacheRead(cacheKey); } catch {
    // Fail closed: a records outage must never read as "no row", which is exactly
    // how a paid attempt gets bought a second time.
    return { state: "error", cacheKey, disposition: "none", detail: "I could not read my own records; I will not call the provider until I can." };
  }
  if (!row) return { state: "error", cacheKey, disposition: "none", detail: "I have no record of a provider task here, so I will start this one fresh." };
  if (row.status === "ready" && row.payload != null && Date.parse(row.expires_at) > now.getTime()) return { state: "hit", envelope: (row.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: row.model_served };
  // A BLOCKED hold created no task and was already refunded, so there is nothing to
  // list and nothing to collect: say so and spend zero calls, however many visits.
  const refused = blockedReason(row);
  if (refused) return blockedResult(cacheKey, refused);
  let taskId = row.provider_task_id;
  if (!taskId && row.quarantined_at) {
    taskId = await recoverQuarantined(d, cacheKey, paths.tasksReadyPath(row.endpoint), now);
    // INDEFINITE hold, with NO timed release: tasks_ready measures its window from
    // task COMPLETION, so elapsed wall-clock time proves nothing about whether the
    // attempt is still alive. Resolving the row any other way is an operator action.
    if (!taskId) return { state: "error", cacheKey, disposition: "quarantined", detail: "I paused this one because I could not confirm what the provider did with it. I am holding it and will keep checking the provider's free finished-task list; I will not pay for it twice." };
  }
  if (!taskId) return { state: "waiting", cacheKey, providerTaskId: null, costUsd: 0, detail: "Another run is already fetching this; I will pick up its result." };
  const getPath = paths.getPath(row.endpoint, taskId);
  if (!getPath) return { state: "error", cacheKey, disposition: "none", detail: "I do not know how to collect this task, so I will start it fresh." };

  const transport = await runDataForSeoTransport({ url: `${API_BASE}/${getPath}`, payload: [], estCostUsd: 0, env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence-collect", method: "GET" });
  if (!transport.ok) {
    // A raw HTTP 404 is NOT proof of a missing task (only in-body 40401/40403
    // is): fail closed, keep the identity, pause visibly, authorize nothing.
    if (transport.status === 404) return { state: "error", cacheKey, disposition: "blocked", detail: "The provider answered 404 when I tried to collect this. I kept the task on file and will not buy it again; I will keep checking it for free." };
    // Any other transport failure on a FREE GET is a costless retry next visit;
    // the message rides along so it is never a silent eternal wait.
    return { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0, detail: `I could not reach the provider to collect this (${transport.message}); I will try again for free.` };
  }
  // Strict in-body classification onto the frozen dispositions; no strings read.
  const task = firstTask(transport.body);
  const code = typeof task?.status_code === "number" ? task.status_code : null;
  const cls = classifyTaskStatus(code);
  if (cls === "waiting") return { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0, detail: `The provider is still working on this (code ${code ?? "unknown"}); I will collect it for free on the next pass.` };
  if (cls === "missing") {
    await clearDeadTask(d, cacheKey, now, `missing_${code ?? "unknown"}`); // proven gone: clear the dead identity so a clean re-claim reposts ONCE
    return { state: "error", cacheKey, disposition: "repost_once", detail: `The provider no longer has this task (code ${code ?? "unknown"}); I will start it fresh once.` };
  }
  // Account/contract problem, NOT a dead task: keep the id and pause.
  if (cls === "blocked") return { state: "error", cacheKey, disposition: "blocked", detail: `The provider turned this request down (code ${code ?? "unknown"}); I am pausing here until the account is sorted out. The task is still on file, so nothing gets paid for twice.` };
  if (cls === "transient") return { state: "error", cacheKey, disposition: "retry_free", detail: `The provider hit a temporary problem on this task (code ${code ?? "unknown"}); I kept it and will collect it again for free shortly.` };
  const live = readLiveResult(transport.body);
  if (!live.valid) return { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0, detail: "The provider marked this ready but sent no result yet; I will collect it again for free." };
  // FRESHNESS truth: the ready payload expires on the REGISTRY ttl, so a due
  // re-observation re-buys; the 30-day retention covers only UNcollected tasks.
  const saved = await writeRetried(d, cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    ready_at: now.toISOString(), expires_at: new Date(now.getTime() + (paths.ttlMsFor(row.endpoint) ?? DAY_MS)).toISOString(),
    fetch_claimed_until: null, posted_attempt_at: null, content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
  });
  // No quarantine here: the task id stays on the row, so re-collecting costs $0.
  if (!saved) return { state: "error", cacheKey, disposition: "none", detail: "I collected the result but could not save it, so I will collect it again for free rather than lose it." };
  return { state: "ok", envelope: (live.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: live.modelServed };
}

/** An ambiguous outcome on a call we may already have paid for: hold the row, keep
 *  the reservation, never retry it automatically. A Standard row can still come back
 *  for free from tasks_ready; a Live row cannot. Cheaper than paying twice. */
async function holdUncertain(d: CachedCallDeps, mode: "live" | "task", cacheKey: string, now: Date, lead: string): Promise<CachedCallResult> {
  const held = await quarantineRow(d, cacheKey, now);
  const way = mode === "task"
    ? "I will look for it on the provider's free finished-task list rather than pay for it twice."
    : "There is no free list for this kind of request, so its answer may be gone for good. I set it aside rather than buy it twice.";
  return held
    ? { state: "error", cacheKey, disposition: "quarantined", detail: `${lead} ${way}` }
    : { state: "error", cacheKey, disposition: "none", detail: `${lead} I could not record that pause either, so I am holding it for a few minutes before I look again.` };
}

/** THE one application point for the paid-response policy (a Standard POST the
 *  provider did not accept, or a Live answer with no usable result).
 *  classifyPaidResponse owns the decision; this owns the money and the row. */
async function applyPaidRejection(d: CachedCallDeps, r: ResolvedCall, body: unknown, providerCost: number | null, now: Date, lead: string): Promise<CachedCallResult> {
  const taskCode = firstTask(body)?.status_code;
  const code = typeof taskCode === "number" ? taskCode : topStatus(body);
  const action = classifyPaidResponse(topStatus(body), typeof taskCode === "number" ? taskCode : null, providerCost);
  // Not a REPORTED zero: the provider may have charged, so keep the reservation.
  if (action === "uncertain") return holdUncertain(d, r.mode, r.cacheKey, now, lead);
  const shown = `code ${code ?? "unknown"}`;
  await d.adjustProviderSpend(r.tenantId, PLATFORM, -r.estCostUsd).catch(() => {});
  if (action === "retry_free_release") {
    // The ONLY automatic retry after a paid rejection: an exactly documented
    // temporary provider failure that reported no charge. Nothing was created.
    await releaseClaim(d, r.cacheKey, now, `provider_temporary:${code ?? "unknown"}`);
    return { state: "error", cacheKey: r.cacheKey, disposition: "none", detail: `The provider hit a temporary problem on its side (${shown}) and charged nothing, so I asked for the reservation back and will try this again on the next pass.` };
  }
  if (!(await holdBlocked(d, r.cacheKey, now, shown))) return { state: "error", cacheKey: r.cacheKey, disposition: "none", detail: "The provider refused this request and I could not record the refusal; I am holding it briefly and will note it properly on the next pass." };
  return blockedResult(r.cacheKey, shown);
}

/** The DURABLE refusal hold: refused, already refunded, nothing to collect.
 *  False = the mark did not persist; the caller must degrade honestly. */
async function holdBlocked(d: CachedCallDeps, cacheKey: string, now: Date, reason: string): Promise<boolean> {
  return holdRow(d, cacheKey, now, `blocked:${reason}`);
}
/** The refusal reason if this row is a BLOCKED hold, else null (an unmarked or
 *  "uncertain:" hold is possibly paid and keeps its own recovery path). */
function blockedReason(row: { error_detail?: string | null } | null | undefined): string | null {
  const detail = row?.error_detail;
  return typeof detail === "string" && detail.startsWith("blocked:") ? detail.slice(8, 120) : null;
}
function blockedResult(cacheKey: string, reason: string): CachedCallResult {
  return { state: "error", cacheKey, disposition: "blocked", detail: `The provider would not run this request (${reason}) and reported no charge, so I asked for that reservation back. Nothing retries this on its own; it stays set aside for review.` };
}

/** The FREE cache write, retried twice more in the same invocation, for the two
 *  places where losing the write would otherwise cost real money to redo. */
async function writeRetried(d: CachedCallDeps, cacheKey: string, patch: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) try { await d.cacheWrite(cacheKey, patch); return true; } catch { /* free to try again */ }
  return false;
}

/** Mark the row UNCERTAIN: the provider may hold a paid call we cannot name. */
async function quarantineRow(d: CachedCallDeps, cacheKey: string, now: Date): Promise<boolean> {
  return holdRow(d, cacheKey, now, "uncertain:unconfirmed provider call");
}
/** THE one durable hold, one column carrying two meanings. claim_evidence_fetch
 *  answers 'pending' forever for any marked row, so no branch can repost it and no
 *  SQL changes. The ALWAYS EXPLICIT reason marker is what a later visit reads, so a
 *  stale error_detail can never be mistaken for the other kind of hold. A blocked
 *  hold clears the pre-call receipt because the provider created nothing.
 *  False = the mark did not persist, so only the ambiguity lease guards the row. */
async function holdRow(d: CachedCallDeps, cacheKey: string, now: Date, reason: string): Promise<boolean> {
  try {
    await d.cacheWrite(cacheKey, {
      quarantined_at: now.toISOString(), posted_attempt_at: reason.startsWith("blocked:") ? null : now.toISOString(),
      fetch_claimed_until: new Date(now.getTime() + AMBIGUITY_WINDOW_MS).toISOString(),
      error_at: now.toISOString(), error_detail: reason.slice(0, 200),
    });
    return true;
  } catch { return false; }
}

/** The provider's FREE finished-task listing is the only sanctioned way to learn the
 *  id of a task we may already have paid for. Match our tag (= cacheKey), persist the
 *  id, clear the quarantine. Any doubt (no path, unreachable, no match, unsaved id)
 *  fails closed and the row stays paused. */
async function recoverQuarantined(d: CachedCallDeps, cacheKey: string, tasksReadyPath: string | null, now: Date): Promise<string | null> {
  if (!tasksReadyPath) return null;
  const byTag = await memoListing(d, tasksReadyPath, now.getTime());
  const found = byTag.get(cacheKey);
  if (!found) return null;
  // The adopted task is real: give it the full retention window so the claim's
  // expiry-clear branch can never treat it as instantly dead and repost it.
  try { await d.cacheWrite(cacheKey, { status: "pending", provider_task_id: found, quarantined_at: null, error_detail: null, fetch_claimed_until: null, expires_at: new Date(now.getTime() + TASK_RETENTION_MS).toISOString() }); } catch { return null; }
  return found;
}
/** ONE listing GET per family per pass: a process-local 60 second bucket
 *  collapses the N quarantined rows of one family into a single FREE GET, so a
 *  stale or missing entry only ever costs another free GET. */
const listingBuckets = new Map<string, { at: number; byTag: Promise<Map<string, string>> }>();
function memoListing(d: CachedCallDeps, path: string, nowMs: number): Promise<Map<string, string>> {
  const bucket = listingBuckets.get(path);
  if (bucket && nowMs >= bucket.at && nowMs - bucket.at < LISTING_MEMO_MS) return bucket.byTag;
  if (listingBuckets.size >= 8) listingBuckets.clear();
  const byTag = fetchTasksReady(d, path);
  listingBuckets.set(path, { at: nowMs, byTag });
  return byTag;
}
/** tag -> task id for every finished task the provider still lists. Unreachable or
 *  unreadable resolves to an EMPTY map: no id, so the row stays quarantined. */
async function fetchTasksReady(d: CachedCallDeps, path: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const t = await runDataForSeoTransport({ url: `${API_BASE}/${path}`, payload: [], estCostUsd: 0, env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence-recover", method: "GET" });
  if (!t.ok) return out;
  const tasks = (t.body as { tasks?: unknown })?.tasks;
  for (const task of Array.isArray(tasks) ? (tasks as Record<string, unknown>[]) : []) {
    for (const e of Array.isArray(task.result) ? (task.result as Record<string, unknown>[]) : []) {
      if (typeof e.tag === "string" && typeof e.id === "string" && e.id.length > 0) out.set(e.tag, e.id);
    }
  }
  return out;
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
  const raw = [p.endpointVersion ?? "v3", p.endpoint, stableStringify(p.publicInput),
    String(p.locationCode), p.languageCode, p.device ?? "", p.modelRequested ?? ""].join("|");
  return "dfs2_" + sha256(raw).slice(0, 40);
}
/** A terminally dead provider task (in-body 40401/40403 only): clear the stale
 *  identity and mark the row errored so the next claim reposts clean ONE time.
 *  Best-effort: a failed write just means a later pass retries the clear. */
async function clearDeadTask(d: CachedCallDeps, cacheKey: string, now: Date, detail: string): Promise<void> {
  await d.cacheWrite(cacheKey, {
    // a dead task has nothing left to protect, so the quarantine mark clears too
    status: "error", provider_task_id: null, posted_at: null, posted_attempt_at: null, quarantined_at: null,
    fetch_claimed_until: null, error_at: now.toISOString(), error_detail: `dead_task:${detail}`.slice(0, 200),
  }).catch(() => {});
}
/** Mark the row error, which releases the lease honestly: claim_evidence_fetch
 *  treats an errored row as immediately re-claimable. */
async function releaseClaim(d: CachedCallDeps, cacheKey: string, now: Date, detail: string): Promise<void> {
  await d.cacheWrite(cacheKey, { status: "error", error_at: now.toISOString(), error_detail: detail.slice(0, 200), fetch_claimed_until: null, posted_attempt_at: null }).catch(() => {});
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
      id: typeof t.id === "string" ? t.id : undefined, cost: typeof t.cost === "number" ? t.cost : undefined,
      status_code: typeof t.status_code === "number" ? t.status_code : undefined,
      status_message: typeof t.status_message === "string" ? t.status_message : undefined, result: t.result ?? null,
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
  const code = task?.status_code; const id = task?.id;
  const accepted = topStatus(body) === 20000 && task != null && (code === 20000 || code === 20100) && typeof id === "string" && id.length > 0;
  return { accepted, taskId: accepted ? (id as string) : null };
}

function short(err: unknown): string { return (err instanceof Error ? err.message : String(err)).slice(0, 120); }
function boundedSummary(input: Record<string, unknown>): string { return stableStringify(input).slice(0, 200); }
function sha256(s: string): string { return createHash("sha256").update(s).digest("hex"); }
/** Deterministic JSON: object keys sorted recursively. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
