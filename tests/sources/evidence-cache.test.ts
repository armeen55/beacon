/**
 * Slice 6/6C canonical evidence cache + atomic money path. Every seam is injected:
 * no network, no Supabase, no spend. Proves reserve -> network -> reconcile order,
 * single-flight, tenant-independent identity, durable task resumption, strict
 * task-status classification, waiting-cost accounting, and fail-closed persistence.
 * Drives the registry-facing core directly (runResolvedCall / collectResolvedTask).
 */
import { describe, it, expect, vi } from "vitest";

import { runResolvedCall, collectResolvedTask, identityCacheKey, type CachedCallDeps, type ResolvedCall } from "@/domains/evidence/dataforseo/cached-call";
const ENV = { BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc", DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-07-25T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 86_400_000).toISOString();
const SERP_GET = (id: string) => `serp/google/organic/task_get/advanced/${id}`;
function resolved(over: Partial<ResolvedCall> = {}): ResolvedCall {
  const base: ResolvedCall = {
    cacheKey: "", endpoint: "serp/google/organic/live/advanced", endpointVersion: "v3",
    postPath: "serp/google/organic/live/advanced", getPath: null,
    publicInput: { keyword: "koobideh", depth: 10 }, locationCode: 2840, languageCode: "en",
    device: null, modelRequested: null, payload: [{ keyword: "koobideh" }],
    ttlMs: 60_000, estCostUsd: 0.01, mode: "live", tenantId: "tenant-a", ...over,
  };
  base.cacheKey = base.cacheKey || identityCacheKey(base);
  return base;
}
const claimReady = (payload: unknown) => async () => ({ outcome: "ready" as const, payload, providerTaskId: null, modelServed: null, readyAt: NOW.toISOString(), costUsd: 0 });
const liveOk = (cost: number, result: unknown = [{ rank: 1 }]) => ({ status_code: 20000, cost, tasks: [{ status_code: 20000, id: "t1", result }] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const taskRow = (endpoint: string, taskId: string) => ({ cache_key: "k", endpoint, status: "pending" as const, provider_task_id: taskId, payload: null, model_served: null, cost_usd: 0.006, expires_at: FUTURE });
const taskCall = () => resolved({ endpoint: "serp/google/organic/task_post", postPath: "serp/google/organic/task_post", getPath: SERP_GET, mode: "task" });
const postAccepted = (cost: number, calls: { fetch: string[] }) => vi.fn(async (u: string) => { calls.fetch.push(u); return json({ status_code: 20000, cost, tasks: [{ status_code: 20100, id: "task-123" }] }); }) as unknown as typeof fetch;
const collectStatus = (taskStatus: number, calls: { fetch: string[] }) => vi.fn(async (u: string) => { calls.fetch.push(u); return json({ status_code: 20000, tasks: [{ status_code: taskStatus, id: "task-9", result: null }] }); }) as unknown as typeof fetch;
const pendingTaskRow = async () => taskRow("serp/google/organic/task_post", "task-9");
function makeDeps(over: Partial<CachedCallDeps> = {}) {
  const calls = { fetch: [] as string[], reserve: [] as number[], adjust: [] as number[], writes: [] as Record<string, unknown>[] };
  const deps: Partial<CachedCallDeps> = {
    env: ENV, now: () => NOW,
    fetchImpl: vi.fn(async (url: string) => { calls.fetch.push(url); return json(liveOk(0.0021)); }) as unknown as typeof fetch,
    claimEvidenceFetch: async () => ({ outcome: "claimed", payload: null, providerTaskId: null, modelServed: null, readyAt: null, costUsd: 0 }),
    reserveProviderSpend: async (_t, _p, amount) => { calls.reserve.push(amount); return true; },
    adjustProviderSpend: async (_t, _p, delta) => { calls.adjust.push(delta); return true; },
    cacheRead: async () => null,
    cacheWrite: async (_k, patch) => { calls.writes.push(patch); },
    breaker: async () => ({ tripped: false }),
    ...over,
  };
  return { deps: deps as unknown as Record<string, unknown>, calls };
}
describe("runResolvedCall - the atomic money path", () => {
  it("a miss makes exactly one network call, one reservation, one reconcile to provider cost", async () => {
    const { deps, calls } = makeDeps();
    const res = await runResolvedCall(resolved(), deps);
    expect(res.state).toBe("ok");
    if (res.state === "ok") expect(res.costUsd).toBe(0.0021);
    expect(calls.fetch).toHaveLength(1);
    expect(calls.reserve).toEqual([0.01]);
    expect(calls.adjust).toEqual([0.0021 - 0.01]); // reconcile est -> actual
  });
  it("ENVELOPE RULE: ok returns and caches the FULL bounded envelope, not tasks[0].result", async () => {
    const { deps, calls } = makeDeps();
    const res = await runResolvedCall(resolved(), deps);
    if (res.state !== "ok") throw new Error(res.state);
    expect(res.envelope.status_code).toBe(20000); // top-level envelope survived
    expect(res.envelope.tasks?.[0]?.result).toEqual([{ rank: 1 }]); // parser still sees inside
    const written = calls.writes.find((w) => w.status === "ready");
    expect((written?.payload as { status_code?: number }).status_code).toBe(20000);
  });
  it("an identical repeat is a zero-network, zero-cost hit", async () => {
    const { deps, calls } = makeDeps({ claimEvidenceFetch: claimReady([{ rank: 1 }]) });
    const res = await runResolvedCall(resolved(), deps);
    expect(res.state).toBe("hit");
    if (res.state === "hit") expect(res.costUsd).toBe(0);
    expect(calls.fetch).toHaveLength(0);
    expect(calls.reserve).toHaveLength(0);
  });
  it("concurrent identical misses (second claim is pending) pay at most once", async () => {
    let n = 0;
    const { deps, calls } = makeDeps({
      claimEvidenceFetch: async () => (n++ === 0
        ? { outcome: "claimed", payload: null, providerTaskId: null, modelServed: null, readyAt: null, costUsd: 0 }
        : { outcome: "pending", payload: null, providerTaskId: null, modelServed: null, readyAt: null, costUsd: 0 }),
    });
    const [r1, r2] = await Promise.all([runResolvedCall(resolved(), deps), runResolvedCall(resolved(), deps)]);
    expect([r1.state, r2.state].sort()).toEqual(["ok", "waiting"]);
    expect(calls.fetch).toHaveLength(1);
    const pending = [r1, r2].find((r) => r.state === "waiting");
    if (pending?.state === "waiting") expect(pending.costUsd).toBe(0); // a bare pending claim charges nothing
  });
  it("no un-paid path (cap / reserve-throw / breaker / dry-run / not_configured) ever touches the network", async () => {
    const cap = makeDeps({ reserveProviderSpend: async () => false });
    expect((await runResolvedCall(resolved(), cap.deps)).state).toBe("capped");
    const rerr = makeDeps({ reserveProviderSpend: async () => { throw new Error("db down"); } });
    expect((await runResolvedCall(resolved(), rerr.deps)).state).toBe("error");
    const brk = makeDeps({ breaker: async () => ({ tripped: true, reason: "ceiling reached" }) });
    expect((await runResolvedCall(resolved(), brk.deps)).state).toBe("capped");
    const dry = makeDeps({ env: { ...ENV, DATAFORSEO_DRY_RUN: "true" } as unknown as NodeJS.ProcessEnv });
    expect((await runResolvedCall(resolved(), dry.deps)).state).toBe("dry_run");
    const claim = vi.fn();
    const nc = makeDeps({ env: { DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv, claimEvidenceFetch: claim as never });
    expect((await runResolvedCall(resolved(), nc.deps)).state).toBe("not_configured");
    for (const g of [cap, rerr, brk, dry, nc]) expect(g.calls.fetch).toHaveLength(0);
    for (const g of [brk, dry, nc]) expect(g.calls.reserve).toHaveLength(0); // breaker/dry/not-configured never reserve
    expect(claim).not.toHaveBeenCalled(); // not_configured never even claims
  });
  it("an HTTP-200 non-success envelope with no reported cost keeps the reservation", async () => {
    const { deps, calls } = makeDeps({
      fetchImpl: vi.fn(async (u: string) => { calls.fetch.push(u); return json({ status_code: 40400, tasks: [] }); }) as unknown as typeof fetch,
    });
    expect((await runResolvedCall(resolved(), deps)).state).toBe("error");
    expect(calls.reserve).toEqual([0.01]);
    expect(calls.adjust).toHaveLength(0); // unknown cost -> never undercount
  });
  it("cache identity has NO tenant input and splits on location / model", async () => {
    const a = identityCacheKey(resolved());
    expect(identityCacheKey(resolved({ tenantId: "tenant-b" }))).toBe(a); // tenant never enters identity
    expect(identityCacheKey(resolved({ locationCode: 2826 }))).not.toBe(a);
    expect(identityCacheKey(resolved({ modelRequested: "gpt-4o" }))).not.toBe(a);
  });
});
describe("Standard tasks - durable waiting, free resumption, status classification", () => {
  it("posts once, persists the task id, and returns durable waiting with the provider cost exactly once", async () => {
    const { deps, calls } = makeDeps();
    (deps as Record<string, unknown>).fetchImpl = postAccepted(0.006, calls);
    const res = await runResolvedCall(taskCall(), deps);
    expect(res.state).toBe("waiting");
    if (res.state === "waiting") { expect(res.providerTaskId).toBe("task-123"); expect(res.costUsd).toBe(0.006); } // actual, contributed once
    expect(calls.fetch).toHaveLength(1);
    expect(calls.writes.some((w) => w.provider_task_id === "task-123")).toBe(true);
  });
  it("after process death, a pending claim GETs the task free (adds 0) and never reposts", async () => {
    const { deps, calls } = makeDeps({
      claimEvidenceFetch: async () => ({ outcome: "pending", payload: null, providerTaskId: "task-123", modelServed: null, readyAt: null, costUsd: 0.006 }),
      cacheRead: async () => taskRow("serp/google/organic/task_post", "task-123"),
      fetchImpl: vi.fn(async (u: string) => { calls.fetch.push(u); return json(liveOk(0)); }) as unknown as typeof fetch, // GET result ready, free
    });
    const res = await runResolvedCall(taskCall(), deps);
    expect(res.state).toBe("ok");
    if (res.state === "ok") expect(res.costUsd).toBe(0);
    expect(calls.reserve).toHaveLength(0); // no reservation on a free resume
    expect(calls.fetch).toEqual([expect.stringContaining("/task_get/advanced/task-123")]);
    expect(calls.fetch[0]).not.toContain("task_post");
  });
  it("classifies task_get in-body codes: 40601/40602 wait (free, never repost); 40401/40403/40501/50000 error with the code", async () => {
    for (const code of [40601, 40602]) {
      const { deps, calls } = makeDeps({ cacheRead: pendingTaskRow });
      (deps as Record<string, unknown>).fetchImpl = collectStatus(code, calls);
      const res = await collectResolvedTask("k", (_e, id) => SERP_GET(id), deps);
      expect(res.state).toBe("waiting");
      if (res.state === "waiting") expect(res.costUsd).toBe(0);
      expect(calls.fetch.every((u) => u.includes("task_get"))).toBe(true); // never reposts
    }
    for (const code of [40401, 40403, 40501, 50000]) { // not-found / expired / invalid-request / internal: all bounded, never eternal wait
      const { deps, calls } = makeDeps({ cacheRead: pendingTaskRow });
      (deps as Record<string, unknown>).fetchImpl = collectStatus(code, calls);
      const res = await collectResolvedTask("k", (_e, id) => SERP_GET(id), deps);
      expect(res.state).toBe("error");
      if (res.state === "error") expect(res.detail).toContain(String(code));
    }
  });
  it("a transport 5xx on the FREE GET stays waiting with the transport detail, never a silent eternal wait", async () => {
    const { deps } = makeDeps({ cacheRead: pendingTaskRow, fetchImpl: vi.fn(async () => new Response("boom", { status: 503 })) as unknown as typeof fetch });
    const res = await collectResolvedTask("k", (_e, id) => SERP_GET(id), deps);
    expect(res.state).toBe("waiting");
    if (res.state === "waiting") { expect(res.costUsd).toBe(0); expect(res.detail).toContain("503"); }
  });
  it("crash-window: a pre-post receipt is persisted BEFORE the post and an UNCERTAIN post does not repost", async () => {
    const { deps, calls } = makeDeps({
      fetchImpl: vi.fn(async (u: string) => { calls.fetch.push(u); throw new Error("timeout"); }) as unknown as typeof fetch,
    });
    const res = await runResolvedCall(taskCall(), deps);
    expect(res.state).toBe("waiting"); // uncertain, NOT error
    if (res.state === "waiting") expect(res.costUsd).toBe(0); // reservation held, never labeled actual
    expect(calls.fetch).toHaveLength(1); // posted at most once
    expect(calls.reserve).toEqual([0.01]); // reservation kept (overcount, never undercount)
    expect(calls.adjust).toHaveLength(0);
    const receipt = calls.writes.find((w) => w.posted_attempt_at); // receipt written before the throw
    expect(typeof receipt?.fetch_claimed_until).toBe("string"); // row held for the ambiguity window
  });
});
describe("fail-closed cache persistence - never report success on an unsaved row", () => {
  it("a failed pre-post receipt makes ZERO network calls, errors, and reconciles the reservation down", async () => {
    const { deps, calls } = makeDeps({ cacheWrite: async () => { throw new Error("db down"); } });
    const res = await runResolvedCall(taskCall(), deps);
    expect(res.state).toBe("error");
    expect(calls.fetch).toHaveLength(0); // never posted
    expect(calls.reserve).toEqual([0.01]);
    expect(calls.adjust).toEqual([-0.01]); // reservation reconciled back down
  });
  it("a failed task-id persistence errors (never waiting) and KEEPS the reservation", async () => {
    let writes = 0;
    const { deps, calls } = makeDeps({ cacheWrite: async () => { if (++writes >= 2) throw new Error("db down"); } }); // pre-post ok, task-id write fails
    (deps as Record<string, unknown>).fetchImpl = postAccepted(0.006, calls);
    const res = await runResolvedCall(taskCall(), deps);
    expect(res.state).toBe("error"); // NOT waiting: the task exists but its receipt did not save
    expect(calls.adjust).toEqual([0.006 - 0.01]); // reconciled to actual; reservation kept (no refund)
  });
  it("a failed ready-envelope persistence errors (never ok) and keeps the reservation", async () => {
    const { deps, calls } = makeDeps({ cacheWrite: async () => { throw new Error("db down"); } });
    const res = await runResolvedCall(resolved(), deps); // live mode, paid
    expect(res.state).toBe("error"); // NOT ok: a caller must not treat an unsaved result as cached
    expect(calls.fetch).toHaveLength(1); // it did fetch (paid)
    expect(calls.reserve).toEqual([0.01]); // reservation kept
  });
});
