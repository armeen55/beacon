import "server-only";
import { createHash } from "node:crypto";
import { isDataForSeoConfigured, monthlyCapUsd, runDataForSeoTransport } from "./client";
import { resolveDeps } from "./default-deps";
import { classifyPaidResponse, classifyTaskStatus } from "./status-contract";
import { CREDIT_BREAKER } from "@/lib/cost/credit-breaker";
import { globalMonthlyCapUsd } from "@/lib/cost/cost-breaker";
import type spendReservations from "@/lib/cost/spend-reservations";
import type { CachedCallResult, FunnelBoundaryDeps, ProviderEnvelope } from "./funnel-boundary";
const API_BASE = "https://api.dataforseo.com/v3";
const PLATFORM = "dataforseo-serp";
const DAILY_LIMIT_DETAIL = "Today's research spending limit was reached, so research stopped here. Everything already collected is saved, and the next pass resumes from this point tomorrow.";
const CLAIM_LEASE_SECONDS = 120;
const TASK_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const AMBIGUITY_WINDOW_MS = 15 * 60 * 1000;
const LISTING_MEMO_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const FIRST_TASK_POLL_MS = 2 * 60 * 1000, MAX_TASK_POLL_MS = 6 * 60 * 60 * 1000, PROVIDER_TASK_MAX_MS = 72 * 60 * 60 * 1000;
export type ResolvedCall = {
  cacheKey: string; endpoint: string; endpointVersion: string; postPath: string;
  getPath: ((id: string) => string | null) | null; tasksReadyPath: string | null;
  publicInput: Record<string, unknown>; locationCode: number; languageCode: string;
  device: string | null; modelRequested: string | null;
  payload: unknown[]; ttlMs: number; estCostUsd: number; mode: "live" | "task"; tenantId: string;
  purpose: "fact_check" | "bulk"; // the daily gate holds the fact-check reserve against bulk buying
  who?: { unitKey?: string; runId?: string; caseKey?: string; promptId?: string };
};
type EvidenceCacheClaim = { // ── seams ──────────────────────────────────────
  outcome: "ready" | "claimed" | "pending"; payload: unknown | null; providerTaskId: string | null;
  modelServed: string | null; readyAt: string | null; costUsd: number; fetchGeneration?: number;
};
type EvidenceCacheRow = {
  cache_key: string; endpoint: string; status: "pending" | "ready" | "error";
  provider_task_id: string | null; payload: unknown | null; model_served: string | null;
  spend_attempt_id?: string | null;
  cost_usd: number; expires_at: string; posted_at?: string | null;
  quarantined_at?: string | null;
  error_detail?: string | null;
  next_poll_at?: string | null;
  poll_attempts?: number;
};
type ClaimArgs = {
  cacheKey: string; endpoint: string; endpointVersion: string; inputHash: string; inputSummary: string;
  locationCode: number; languageCode: string; device: string | null; modelRequested: string | null; claimSeconds: number;
};
export type CachedCallDeps = {
  env: NodeJS.ProcessEnv;
  now: () => Date;
  fetchImpl: typeof fetch;
  spend: Pick<typeof spendReservations, "reserve" | "read" | "claimTransmission" | "markAmbiguous" | "release" | "reconcile">;
  claimEvidenceFetch: (p: ClaimArgs) => Promise<EvidenceCacheClaim>;
  cacheRead: (cacheKey: string) => Promise<EvidenceCacheRow | null>;
  cacheWrite: (cacheKey: string, patch: Record<string, unknown>) => Promise<void>;
  cacheUpsert: (cacheKey: string, row: Record<string, unknown>) => Promise<void>;
  authorizeRepost: (cacheKey: string, detail: string) => Promise<boolean>;
  breaker: (env: NodeJS.ProcessEnv, now: Date, projectedCostUsd: number) => Promise<{ tripped: boolean; reason?: string }>;
};
async function reconcileRetried(write: () => Promise<boolean>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt += 1) { try { if (await write()) return true; } catch { /* retry the receipt only */ } }
  return false;
}
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
    return { state: "error", cacheKey, disposition: "none", detail: `This fetch could not be reserved (${short(err)}). It is tried again on the next pass.` };
  }
  if (claim.outcome === "ready") return { state: "hit", envelope: (claim.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: claim.modelServed };
  if (claim.outcome === "pending") {
    if (r.mode === "task") return collectResolvedTask(cacheKey, paths, deps);
    try {
      const liveRow = await d.cacheRead(cacheKey);
      if (liveRow?.spend_attempt_id) {
        const receipt = await d.spend.read(liveRow.spend_attempt_id).catch(() => null);
        if (receipt?.state === "reconciled" && receipt.resultPayload != null) {
          return projectStoredLiveResult(d, r, cacheKey, receipt.resultPayload,
            receipt.accountedUsd ?? liveRow.cost_usd, now);
        }
      }
      const refused = blockedReason(liveRow);
      if (refused) return blockedResult(cacheKey, refused);
      if (liveRow?.quarantined_at) return { state: "error", cacheKey, disposition: "quarantined", detail: "This answer may have been paid for once without being confirmed or kept, and there is no free list for this kind of request. It is set aside for good rather than bought twice." };
    } catch {
      return { state: "error", cacheKey, disposition: "none", detail: "The fetch records could not be read, so the provider is not called until they can be." };
    }
    return { state: "waiting", cacheKey, providerTaskId: claim.providerTaskId, costUsd: 0, detail: "Another run is already fetching this. Its result is picked up when it lands." };
  }
  if (r.mode === "task" && claim.providerTaskId) return collectResolvedTask(cacheKey, paths, deps);
  const verdict = await d.breaker(d.env, now, r.estCostUsd).catch(() => ({ tripped: true, reason: "global spend breaker unavailable, failing closed" }));
  if (verdict.tripped) { await releaseClaim(d, cacheKey, now, "capped"); return { state: "capped", cacheKey, detail: verdict.reason ?? "global monthly ceiling reached" }; }
  let reservation: Awaited<ReturnType<CachedCallDeps["spend"]["reserve"]>> | null;
  const generation = Number.isInteger(claim.fetchGeneration) && Number(claim.fetchGeneration) > 0 ? Number(claim.fetchGeneration) : 1;
  try {
    reservation = await d.spend.reserve({ tenantId: r.tenantId, platform: PLATFORM, purpose: r.purpose,
      logicalKey: `dataforseo:${cacheKey}:g${generation}`, requestFingerprint: `${cacheKey}:g${generation}`,
      recoveryKind: r.mode === "task" ? "provider_task_listing" : "provider_exact_required",
      estimatedUsd: r.estCostUsd, monthlyCapUsd: monthlyCapUsd(d.env),
      globalMonthlyCapUsd: globalMonthlyCapUsd(d.env) });
  } catch (err) {
    await releaseClaim(d, cacheKey, now, "reserve_error");
    return { state: "error", cacheKey, disposition: "none", detail: `Budget for this could not be set aside (${short(err)}). No provider call was made, and it is tried again.` };
  }
  if (!reservation.attemptId || !["reserved", "resumed", "replayed"].includes(reservation.outcome)) { await releaseClaim(d, cacheKey, now, "capped"); return { state: "capped", cacheKey, detail: `the spending cap refused this call for ${PLATFORM}: ${reservation.outcome}` }; }
  const attemptId = reservation.attemptId;
  if (reservation.outcome === "replayed") {
    if (r.mode !== "live" || reservation.resultPayload == null) return holdUncertain(d, r.mode, cacheKey, now, attemptId,
      "A paid result is on file, but it is incomplete and cannot be bought again.");
    return projectStoredLiveResult(d, r, cacheKey, reservation.resultPayload,
      reservation.accountedUsd ?? reservation.estimatedUsd, now);
  }
  const payload = r.mode === "task" ? tagTaskPayload(r.payload, attemptId) : r.payload;
  try {
    await d.cacheWrite(cacheKey, { spend_attempt_id: attemptId, posted_attempt_at: now.toISOString(), fetch_claimed_until: new Date(now.getTime() + AMBIGUITY_WINDOW_MS).toISOString() });
  } catch (err) {
    await d.spend.release(attemptId).catch(() => false);
    await releaseClaim(d, cacheKey, now, "precall_receipt_failed");
    return { state: "error", cacheKey, disposition: "none", detail: `The pre-call receipt could not be saved (${short(err)}). No provider call was made, and it is tried again.` };
  }
  const transmission = reservation.state === "reserved"
    ? await d.spend.claimTransmission(attemptId).catch(() => "unavailable" as const)
    : "already_started" as const;
  if (transmission === "cap_refused" || transmission === "stale_day" || transmission === "work_retired" || transmission === "run_inactive") {
    await releaseClaim(d, cacheKey, now, "capped_before_transport");
    return { state: "capped", cacheKey, detail: transmission === "work_retired" ? "The operator retired this exact work before the provider call. No provider call was made." : transmission === "run_inactive" ? "The research run no longer owns its lease. No provider call was made." : transmission === "stale_day" ? "The reporting day changed before the provider call. No provider call was made, and a fresh reservation is used next time." : "The spending door closed before this request reached the provider. No provider call was made." };
  }
  if (transmission !== "claimed") return holdUncertain(d, r.mode, cacheKey, now, attemptId, "This paid request already started and remains unresolved, so it was not sent again.");
  if (!(await CREDIT_BREAKER.claimProbe(r.tenantId, {}, "dataforseo").catch(() => false))) { if (await d.spend.release(attemptId, true).catch(() => false)) await releaseClaim(d, cacheKey, now, "credit_held"); else await holdUncertain(d, r.mode, cacheKey, now, attemptId, "The recovery probe was not sent, but its reservation could not be released safely."); return { state: "capped", cacheKey, detail: CREDIT_BREAKER.sentence("dataforseo") }; } // Claim only after every local transmission gate: a cap/run refusal must never consume the one recovery probe.
  const transport = await runDataForSeoTransport({ url: `${API_BASE}/${r.postPath}`, payload, env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence" });
  if (!transport.ok) {
    const cost = readProviderCost(transport.body);
    if (transport.status === 402 && cost === 0 && isPaymentRefusal(transport.body)) { await CREDIT_BREAKER.trip(r.tenantId, {}, "dataforseo").catch(() => {}); if (await d.spend.release(attemptId, true).catch(() => false)) await releaseClaim(d, cacheKey, now, "credit_held"); else await holdUncertain(d, r.mode, cacheKey, now, attemptId, "The provider reported no charge, but the reservation could not be released safely."); return { state: "capped", cacheKey, detail: CREDIT_BREAKER.sentence("dataforseo") }; }
    if (cost === 0) return applyPaidRejection(d, r, transport.body, cost, now, attemptId, `The provider refused this request over HTTP ${transport.status ?? "unknown"} and reported no charge.`);
    const held = await holdUncertain(d, r.mode, cacheKey, now, attemptId, "Whether the provider took and charged this request could not be confirmed, so it is paused.");
    return held;
  }
  const body = transport.body;
  const providerCost = readProviderCost(body);
  if (isPaymentRefusal(body)) {
    await CREDIT_BREAKER.trip(r.tenantId, {}, "dataforseo").catch(() => {});
    if (providerCost === 0 && await d.spend.release(attemptId, true).catch(() => false)) await releaseClaim(d, cacheKey, now, "credit_held");
    else await holdUncertain(d, r.mode, cacheKey, now, attemptId, "The provider reported an empty balance without proving this request cost nothing.");
    return { state: "capped", cacheKey, detail: CREDIT_BREAKER.sentence("dataforseo") };
  }
  if (r.mode === "task") {
    const posted = readTaskPosted(body);
    if (!posted.accepted || !posted.taskId) return applyPaidRejection(d, r, body, providerCost, now, attemptId, "The provider did not clearly accept this task and may still have charged for it, so the task was paused.");
    await CREDIT_BREAKER.clear(r.tenantId, {}, "dataforseo").catch(() => {});
    const actual = providerCost ?? 0;
    const accounted = providerCost == null
      ? await d.spend.markAmbiguous(attemptId, posted.taskId).catch(() => false)
      : await reconcileRetried(() => d.spend.reconcile(attemptId, providerCost, posted.taskId, "provider_advance"));
    if (!accounted) return holdUncertain(d, r.mode, cacheKey, now, attemptId, "The provider accepted this task, but its exact spend receipt could not be filed.", posted.taskId);
    try {
      await d.cacheWrite(cacheKey, {
        status: "pending", provider_task_id: posted.taskId, fetch_claimed_until: null,
        posted_at: now.toISOString(), expires_at: new Date(now.getTime() + TASK_RETENTION_MS).toISOString(), cost_usd: actual,
        next_poll_at: new Date(now.getTime() + FIRST_TASK_POLL_MS).toISOString(), poll_attempts: 0,
      });
    } catch {
      return holdUncertain(d, r.mode, cacheKey, now, attemptId, "The provider took this task but its receipt could not be saved, so it is paused.", posted.taskId);
    }
    if (providerCost == null) return holdUncertain(d, r.mode, cacheKey, now, attemptId, "The provider accepted this task but did not report its exact charge, so it remains paused for reconciliation.", posted.taskId);
    return { state: "waiting", cacheKey, providerTaskId: posted.taskId, costUsd: actual, modelRequested: r.modelRequested, detail: "The task is posted to the provider and collected with a free follow-up." };
  }

  const live = readLiveResult(body);
  if (!live.valid) return applyPaidRejection(d, r, body, providerCost, now, attemptId, "The provider answered without a usable result and may have charged for it, so the request was paused.");
  await CREDIT_BREAKER.clear(r.tenantId, {}, "dataforseo").catch(() => {});
  if (providerCost == null) {
    await d.spend.markAmbiguous(attemptId, null, body).catch(() => false);
    return holdUncertain(d, r.mode, cacheKey, now, attemptId,
      "The provider returned a usable live answer without an exact charge. Its raw answer is held, and the lane stops rather than understating the budget.");
  }
  const actual = providerCost;
  const accounted = await reconcileRetried(() => d.spend.reconcile(attemptId, actual, null,
    "provider_reported", body));
  if (!accounted) return holdUncertain(d, r.mode, cacheKey, now, attemptId, "The provider answered, but its exact spend receipt could not be filed.");
  const readyAt = now.toISOString();
  const saved = await writeRetried(d, cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    cost_usd: actual, ready_at: readyAt, expires_at: new Date(now.getTime() + r.ttlMs).toISOString(),
    fetch_claimed_until: null, posted_attempt_at: null, content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
    provenance: { provider: "dataforseo", endpoint: r.endpoint, ts: readyAt, purpose: r.purpose, tenantId: r.tenantId, ...(r.who ?? {}) },
  });
  if (!saved) return holdUncertain(d, r.mode, cacheKey, now, attemptId, "This paid answer could not be saved after three tries, so it was paused instead of purchased again.");
  return { state: "ok", envelope: (live.payload ?? {}) as ProviderEnvelope, costUsd: actual, cacheKey, modelServed: live.modelServed, modelRequested: r.modelRequested };
}

async function projectStoredLiveResult(
  d: CachedCallDeps,
  r: ResolvedCall,
  cacheKey: string,
  body: unknown,
  accountedUsd: number,
  now: Date,
): Promise<CachedCallResult> {
  const live = readLiveResult(body);
  if (!live.valid) return { state: "error", cacheKey, disposition: "quarantined",
    detail: "A paid provider envelope is on file, but it is not usable. It remains held and is not bought again." };
  const readyAt = now.toISOString();
  const saved = await writeRetried(d, cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    cost_usd: accountedUsd, ready_at: readyAt, expires_at: new Date(now.getTime() + r.ttlMs).toISOString(),
    fetch_claimed_until: null, posted_attempt_at: null, quarantined_at: null, error_detail: null,
    content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
    provenance: { provider: "dataforseo", endpoint: r.endpoint, ts: readyAt, purpose: r.purpose,
      tenantId: r.tenantId, recoveredFromSpendReceipt: true, ...(r.who ?? {}) },
  });
  if (!saved) return { state: "error", cacheKey, disposition: "quarantined",
    detail: "The paid answer is safely stored, but its cache copy could not be rebuilt. It will be retried without another provider call." };
  return { state: "hit", envelope: (live.payload ?? {}) as ProviderEnvelope, costUsd: 0,
    cacheKey, modelServed: live.modelServed };
}

export async function collectResolvedTask(
  cacheKey: string,
  paths: { getPath: (endpoint: string, id: string) => string | null; tasksReadyPath: (endpoint: string) => string | null; ttlMsFor: (endpoint: string) => number | null },
  deps: FunnelBoundaryDeps = {},
): Promise<CachedCallResult> {
  const d = resolveDeps(deps);
  const now = d.now();
  let row: EvidenceCacheRow | null;
  try { row = await d.cacheRead(cacheKey); } catch {
    return { state: "error", cacheKey, disposition: "none", detail: "The fetch records could not be read, so the provider is not called until they can be." };
  }
  if (!row) return { state: "error", cacheKey, disposition: "none", detail: "No provider task is on record here, so this one starts fresh." };
  if (row.status === "ready" && row.payload != null && Date.parse(row.expires_at) > now.getTime()) return { state: "hit", envelope: (row.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: row.model_served };
  const refused = blockedReason(row);
  if (refused) return blockedResult(cacheKey, refused);
  if (row.error_detail?.startsWith("unavailable:")) return unavailableResult(cacheKey);
  const spendReceipt = row.spend_attempt_id ? await d.spend.read(row.spend_attempt_id).catch(() => null) : null;
  if (spendReceipt?.state === "reconciled" && spendReceipt.resultPayload != null) {
    const stored = readLiveResult(spendReceipt.resultPayload);
    if (!stored.valid) return { state: "error", cacheKey, disposition: "quarantined", detail: "A paid provider envelope is on file, but it is not usable. It remains held and is not bought again." };
    const saved = await writeRetried(d, cacheKey, {
      status: "ready", payload: stored.payload as Record<string, unknown>, model_served: stored.modelServed,
      cost_usd: spendReceipt.accountedUsd ?? row.cost_usd, ready_at: now.toISOString(),
      expires_at: new Date(now.getTime() + (paths.ttlMsFor(row.endpoint) ?? DAY_MS)).toISOString(),
      fetch_claimed_until: null, posted_attempt_at: null, quarantined_at: null, error_detail: null,
      next_poll_at: null, poll_attempts: 0,
      content_hash: sha256(stableStringify(stored.payload)).slice(0, 40),
    });
    return saved
      ? { state: "hit", envelope: (stored.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: stored.modelServed }
      : { state: "error", cacheKey, disposition: "quarantined", detail: "The paid answer is safely stored, but its cache copy could not be rebuilt. It will be retried without another provider call." };
  }
  let taskId = row.provider_task_id;
  if (!taskId && row.spend_attempt_id) {
    taskId = spendReceipt?.providerTaskId ?? null;
    if (taskId) await d.cacheWrite(cacheKey, { provider_task_id: taskId, next_poll_at: row.next_poll_at ?? now.toISOString() }).catch(() => {});
  }
  if (!taskId && row.quarantined_at) {
    taskId = await recoverQuarantined(d, cacheKey, row.spend_attempt_id ?? cacheKey, paths.tasksReadyPath(row.endpoint), now);
    if (!taskId) return { state: "error", cacheKey, disposition: "quarantined", detail: "This one is paused because what the provider did with it could not be confirmed. It is held and checked against the provider's free finished-task list, and never paid for twice." };
  }
  if (!taskId) return { state: "waiting", cacheKey, providerTaskId: null, costUsd: 0, detail: "Another run is already fetching this. Its result is picked up when it lands." };
  const recordedAt = Date.parse(row.posted_at ?? ""), postedAt = Number.isFinite(recordedAt) ? recordedAt : now.getTime();
  if (!Number.isFinite(recordedAt)) await d.cacheWrite(cacheKey, { posted_at: now.toISOString() }).catch(() => {});
  const deadlineDue = now.getTime() - postedAt >= PROVIDER_TASK_MAX_MS;
  if (!deadlineDue && row.next_poll_at && Date.parse(row.next_poll_at) > now.getTime()) return { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0, detail: "The provider task is waiting for its stored collection time." };
  const getPath = paths.getPath(row.endpoint, taskId);
  if (!getPath) return { state: "error", cacheKey, disposition: "none", detail: "There is no way to collect this task, so it starts fresh." };
  const transport = await runDataForSeoTransport({ url: `${API_BASE}/${getPath}`, payload: [], env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence-collect", method: "GET" });
  const pollAttempts = Math.max(0, Number(row.poll_attempts) || 0) + 1;
  await d.cacheWrite(cacheKey, { updated_at: now.toISOString(), poll_attempts: pollAttempts,
    next_poll_at: new Date(now.getTime() + Math.min(MAX_TASK_POLL_MS, FIRST_TASK_POLL_MS * 2 ** Math.min(pollAttempts - 1, 12))).toISOString() }).catch(() => {});
  if (!transport.ok) {
    if (transport.status === 402) { const code = firstTask(transport.body)?.status_code ?? topStatus(transport.body); return code === 40200 || code === 40210 ? { state: "capped", cacheKey, detail: CREDIT_BREAKER.sentence("dataforseo") } : code === 40203 ? { state: "error", cacheKey, disposition: "daily_limit", detail: DAILY_LIMIT_DETAIL } : blockedResult(cacheKey, `code ${code ?? "unknown"}`); }
    if (transport.status != null && [401, 403, 404].includes(transport.status)) return { state: "error", cacheKey, disposition: "blocked", detail: `The provider answered ${transport.status} on collection. The task stays on file, is never bought again, and is checked for free after the account is corrected.` };
    if (deadlineDue) return terminalUnavailable(d, cacheKey, now, "transport_after_72h");
    return { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0, detail: `The provider could not be reached to collect this (${transport.message}). It is tried again for free.` };
  }
  const collectedCost = readProviderCost(transport.body), task = firstTask(transport.body);
  const code = typeof task?.status_code === "number" ? task.status_code : null;
  const top = topStatus(transport.body), topCls = top === 20000 ? "ready" : classifyTaskStatus(top);
  const statusCode = topCls === "ready" ? code : top, cls = classifyTaskStatus(statusCode);
  if (cls === "waiting") {
    if (deadlineDue) {
      const allowed = await d.authorizeRepost(cacheKey, `expired_after_72h_${statusCode ?? "unknown"}`).catch(() => false);
      return allowed ? { state: "error", cacheKey, disposition: "repost_once", detail: `The provider exceeded its documented 72-hour task limit (code ${statusCode ?? "unknown"}). Its refunded task starts fresh once.` }
        : settleDeniedRepost(d, cacheKey);
    }
    return { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0, detail: `The provider is still working on this (code ${statusCode ?? "unknown"}). It is collected for free on the next pass.` };
  }
  if (cls === "limited") return { state: "error", cacheKey, disposition: "daily_limit", detail: DAILY_LIMIT_DETAIL };
  if (cls === "missing") {
    const allowed = await d.authorizeRepost(cacheKey, `missing_${statusCode ?? "unknown"}`).catch(() => false);
    return allowed ? { state: "error", cacheKey, disposition: "repost_once", detail: `The provider no longer has this task (code ${statusCode ?? "unknown"}). It starts fresh once.` }
      : settleDeniedRepost(d, cacheKey);
  }
  if (cls === "blocked") return { state: "error", cacheKey, disposition: "blocked", detail: `The provider turned this request down (code ${statusCode ?? "unknown"}). It is paused until the account is sorted out. The task is still on file, so nothing gets paid for twice.` };
  if (cls === "transient") return deadlineDue ? terminalUnavailable(d, cacheKey, now, "transient_after_72h") : { state: "error", cacheKey, disposition: "retry_free", detail: `The provider hit a temporary problem on this task (code ${statusCode ?? "unknown"}). It is kept and collected again for free shortly.` };
  const live = readLiveResult(transport.body);
  if (!live.valid) return deadlineDue ? terminalUnavailable(d, cacheKey, now, "empty_result_after_72h") : { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0, detail: "The provider marked this ready but sent no result yet. It is collected again for free." };
  if (collectedCost == null) return deadlineDue ? terminalUnavailable(d, cacheKey, now, "missing_charge_after_72h") : { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0,
    detail: "The provider returned the ready result without its final charge. The task id is preserved and collected again for free; an advance or estimate never authorizes the result." };
  if (row.spend_attempt_id) {
    if (!(await reconcileRetried(() => d.spend.reconcile(row.spend_attempt_id!, collectedCost, taskId, "provider_reported", transport.body))))
      return { state: "waiting", cacheKey, providerTaskId: taskId, costUsd: 0,
        detail: "The ready result is kept on its free task id, but its spend receipt still needs reconciliation before it can be shown." };
  }
  const saved = await writeRetried(d, cacheKey, {
    status: "ready", payload: live.payload as Record<string, unknown>, model_served: live.modelServed,
    ready_at: now.toISOString(), expires_at: new Date(now.getTime() + (paths.ttlMsFor(row.endpoint) ?? DAY_MS)).toISOString(),
    fetch_claimed_until: null, posted_attempt_at: null, provider_repost_count: 0, next_poll_at: null, poll_attempts: 0, content_hash: sha256(stableStringify(live.payload)).slice(0, 40),
  });
  if (!saved) return { state: "error", cacheKey, disposition: "none", detail: "The result was collected but could not be saved, so it is collected again for free rather than lost." };
  return { state: "ok", envelope: (live.payload ?? {}) as ProviderEnvelope, costUsd: 0, cacheKey, modelServed: live.modelServed };
}

async function holdUncertain(d: CachedCallDeps, mode: "live" | "task", cacheKey: string, now: Date, attemptId: string, lead: string, providerTaskId?: string): Promise<CachedCallResult> {
  await d.spend.markAmbiguous(attemptId, providerTaskId).catch(() => false);
  const held = await quarantineRow(d, cacheKey, now);
  const way = mode === "task"
    ? "The provider's free finished-task list will be checked instead of paying for it twice."
    : "There is no free list for this kind of request, so its answer may be gone for good. It was set aside instead of purchased twice.";
  return held
    ? { state: "error", cacheKey, disposition: "quarantined", detail: `${lead} ${way}` }
    : { state: "error", cacheKey, disposition: "none", detail: `${lead} That pause could not be recorded either, so it is held for a few minutes before the next look.` };
}

async function applyPaidRejection(d: CachedCallDeps, r: ResolvedCall, body: unknown, providerCost: number | null, now: Date, attemptId: string, lead: string): Promise<CachedCallResult> {
  const taskCode = firstTask(body)?.status_code;
  const code = typeof taskCode === "number" ? taskCode : topStatus(body);
  const action = classifyPaidResponse(topStatus(body), typeof taskCode === "number" ? taskCode : null, providerCost);
  if (action === "uncertain") return holdUncertain(d, r.mode, r.cacheKey, now, attemptId, lead);
  const shown = `code ${code ?? "unknown"}`;
  if (!(await d.spend.release(attemptId, true).catch(() => false))) return holdUncertain(d, r.mode, r.cacheKey, now, attemptId, "The provider reported no charge, but the reservation could not be released safely.");
  if (action === "retry_free_release") {
    await releaseClaim(d, r.cacheKey, now, `provider_temporary:${code ?? "unknown"}`);
    return { state: "error", cacheKey: r.cacheKey, disposition: "none", detail: `The provider hit a temporary problem on its side (${shown}) and charged nothing, so the reservation is returned and this is tried again on the next pass.` };
  }
  if (action === "daily_limit_release") {
    await releaseClaim(d, r.cacheKey, now, "daily_cost_limit");
    return { state: "error", cacheKey: r.cacheKey, disposition: "daily_limit", detail: DAILY_LIMIT_DETAIL };
  }
  if (!(await holdBlocked(d, r.cacheKey, now, shown))) return { state: "error", cacheKey: r.cacheKey, disposition: "none", detail: "The provider refused this request and the refusal could not be recorded. It is held briefly and noted properly on the next pass." };
  return blockedResult(r.cacheKey, shown);
}

async function holdBlocked(d: CachedCallDeps, cacheKey: string, now: Date, reason: string): Promise<boolean> {
  return holdRow(d, cacheKey, now, `blocked:${reason}`);
}
function blockedReason(row: { error_detail?: string | null } | null | undefined): string | null {
  const detail = row?.error_detail;
  return typeof detail === "string" && detail.startsWith("blocked:") ? detail.slice(8, 120) : null;
}
function blockedResult(cacheKey: string, reason: string): CachedCallResult {
  if (reason === "repost_limit") return unavailableResult(cacheKey);
  return { state: "error", cacheKey, disposition: "blocked", detail: `The search provider would not run this request (${reason}) and charged nothing. It stays set aside until the account is looked at.` };
}
const unavailableResult = (cacheKey: string): CachedCallResult => ({ state: "error", cacheKey, disposition: "quarantined", detail: "This evidence request stayed unavailable after its one safe recovery. It is set aside, and the rest of the work continues." });
async function terminalUnavailable(d: CachedCallDeps, cacheKey: string, now: Date, reason: string): Promise<CachedCallResult> {
  if (!(await writeRetried(d, cacheKey, { quarantined_at: now.toISOString(), error_at: now.toISOString(), error_detail: `unavailable:${reason}`, fetch_claimed_until: null, next_poll_at: null }))) return { state: "error", cacheKey, disposition: "retry_free", detail: "This task reached its deadline, but that state could not be saved. It remains on its free task id." };
  return unavailableResult(cacheKey);
}
async function settleDeniedRepost(d: CachedCallDeps, cacheKey: string): Promise<CachedCallResult> {
  let latest: EvidenceCacheRow | null; try { latest = await d.cacheRead(cacheKey); } catch { latest = null; }
  const reason = blockedReason(latest); if (reason) return blockedResult(cacheKey, reason);
  if (!latest?.provider_task_id && latest?.error_detail?.startsWith("dead_task:")) return { state: "error", cacheKey, disposition: "repost_once", detail: "Another collector already authorized the one clean retry." };
  return { state: "error", cacheKey, disposition: "retry_free", detail: "The task could not be settled safely. Its identity stays on file and is checked again for free." };
}

async function writeRetried(d: CachedCallDeps, cacheKey: string, patch: Record<string, unknown>): Promise<boolean> {
  for (let attempt = 0; attempt < 3; attempt++) try { await d.cacheWrite(cacheKey, patch); return true; } catch { /* free to try again */ }
  return false;
}

async function quarantineRow(d: CachedCallDeps, cacheKey: string, now: Date): Promise<boolean> {
  return holdRow(d, cacheKey, now, "uncertain:unconfirmed provider call");
}
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

async function recoverQuarantined(d: CachedCallDeps, cacheKey: string, attemptTag: string, tasksReadyPath: string | null, now: Date): Promise<string | null> {
  if (!tasksReadyPath) return null;
  const byTag = await memoListing(d, tasksReadyPath, now.getTime());
  const found = byTag.get(attemptTag);
  if (!found) return null;
  try { await d.cacheWrite(cacheKey, { status: "pending", provider_task_id: found, quarantined_at: null, error_detail: null, fetch_claimed_until: null, expires_at: new Date(now.getTime() + TASK_RETENTION_MS).toISOString(), next_poll_at: now.toISOString(), poll_attempts: 0 }); } catch { return null; }
  return found;
}
const listingBuckets = new Map<string, { at: number; byTag: Promise<Map<string, string>> }>();
function memoListing(d: CachedCallDeps, path: string, nowMs: number): Promise<Map<string, string>> {
  const bucket = listingBuckets.get(path);
  if (bucket && nowMs >= bucket.at && nowMs - bucket.at < LISTING_MEMO_MS) return bucket.byTag;
  if (listingBuckets.size >= 8) listingBuckets.clear();
  const byTag = fetchTasksReady(d, path);
  listingBuckets.set(path, { at: nowMs, byTag });
  return byTag;
}
async function fetchTasksReady(d: CachedCallDeps, path: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const t = await runDataForSeoTransport({ url: `${API_BASE}/${path}`, payload: [], env: d.env, fetchImpl: d.fetchImpl, perfDetail: "evidence-recover", method: "GET" });
  if (!t.ok) return out;
  const tasks = (t.body as { tasks?: unknown })?.tasks;
  for (const task of Array.isArray(tasks) ? (tasks as Record<string, unknown>[]) : []) {
    for (const e of Array.isArray(task.result) ? (task.result as Record<string, unknown>[]) : []) {
      if (typeof e.tag === "string" && typeof e.id === "string" && e.id.length > 0) out.set(e.tag, e.id);
    }
  }
  return out;
}
function tagTaskPayload(payload: unknown[], tag: string): unknown[] {
  if (payload.length === 0) return [{ tag }];
  const [first, ...rest] = payload;
  return [{ ...(first as Record<string, unknown>), tag }, ...rest];
}
export function identityCacheKey(p: {
  endpointVersion?: string; endpoint: string; publicInput: unknown;
  locationCode: number; languageCode: string; device?: string | null; modelRequested?: string | null;
}): string {
  const raw = [p.endpointVersion ?? "v3", p.endpoint, stableStringify(p.publicInput),
    String(p.locationCode), p.languageCode, p.device ?? "", p.modelRequested ?? ""].join("|");
  return "dfs2_" + sha256(raw).slice(0, 40);
}
async function releaseClaim(d: CachedCallDeps, cacheKey: string, now: Date, detail: string): Promise<void> {
  await d.cacheWrite(cacheKey, { status: "error", error_at: now.toISOString(), error_detail: detail.slice(0, 200), fetch_claimed_until: null, posted_attempt_at: null, next_poll_at: null, poll_attempts: 0 }).catch(() => {});
}

function firstTask(body: unknown): Record<string, unknown> | null {
  const tasks = (body as { tasks?: unknown })?.tasks;
  return Array.isArray(tasks) && tasks.length > 0 ? (tasks[0] as Record<string, unknown>) : null;
}
function topStatus(body: unknown): number | null {
  const s = (body as { status_code?: unknown })?.status_code;
  return typeof s === "number" ? s : null;
}
function isPaymentRefusal(body: unknown): boolean {
  const task = firstTask(body)?.status_code;
  return [40200, 40210].includes(topStatus(body) ?? -1) || [40200, 40210].includes(typeof task === "number" ? task : -1);
}
function readProviderCost(body: unknown): number | null {
  const top = (body as { cost?: unknown })?.cost, task = firstTask(body)?.cost;
  const reported = [top, task].filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0);
  return reported.length > 0 ? Math.max(...reported) : null;
}
function readModelServed(task: Record<string, unknown> | null): string | null {
  if (!task) return null;
  const r = (Array.isArray(task.result) ? task.result[0] : task.result) as Record<string, unknown> | undefined;
  const m = (r?.model_name ?? r?.model ?? task.model) as unknown;
  return typeof m === "string" && m.length > 0 ? m : null;
}
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
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  const obj = value as Record<string, unknown>;
  return "{" + Object.keys(obj).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k])).join(",") + "}";
}
