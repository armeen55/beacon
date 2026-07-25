/**
 * Slice 6 canonical evidence cache + atomic money path. Every seam is injected:
 * no network, no Supabase, no spend. Proves reserve -> network -> reconcile
 * order, single-flight, tenant-independent identity, and durable task resumption.
 */
import { describe, it, expect, vi } from "vitest";

import { cachedDataForSeoCall, collectDataForSeoTask, type CachedCallDeps } from "@/domains/evidence/dataforseo/cached-call";
import type { CachedCallSpec } from "@/domains/evidence/dataforseo/funnel-boundary";

const ENV = { BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc", DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-07-25T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 86_400_000).toISOString();

function spec(over: Partial<CachedCallSpec> = {}): CachedCallSpec {
  return {
    endpoint: "serp/google/organic/live/advanced", payload: [{ keyword: "koobideh" }],
    publicInput: { keyword: "koobideh", depth: 10 }, locationCode: 2840, languageCode: "en",
    ttlMs: 60_000, estCostUsd: 0.01, mode: "live", tenantId: "tenant-a", unitKey: "unit-1", ...over,
  };
}
const claimReady = (payload: unknown) => async () => ({ outcome: "ready" as const, payload, providerTaskId: null, modelServed: null, readyAt: NOW.toISOString(), costUsd: 0 });
const liveOk = (cost: number, result: unknown = [{ rank: 1 }]) => ({ status_code: 20000, cost, tasks: [{ status_code: 20000, id: "t1", result }] });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const taskRow = (endpoint: string, taskId: string) => ({ cache_key: "k", endpoint, status: "pending" as const, provider_task_id: taskId, payload: null, model_served: null, cost_usd: 0.006, expires_at: FUTURE });

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

describe("cachedDataForSeoCall — the atomic money path", () => {
  it("a miss makes exactly one network call, one reservation, one reconcile to provider cost", async () => {
    const { deps, calls } = makeDeps();
    const res = await cachedDataForSeoCall(spec(), deps);
    expect(res.state).toBe("ok");
    if (res.state === "ok") expect(res.costUsd).toBe(0.0021);
    expect(calls.fetch).toHaveLength(1);
    expect(calls.reserve).toEqual([0.01]);
    expect(calls.adjust).toEqual([0.0021 - 0.01]); // reconcile est -> actual
  });

  it("an identical repeat is a zero-network, zero-cost hit", async () => {
    const { deps, calls } = makeDeps({ claimEvidenceFetch: claimReady([{ rank: 1 }]) });
    const res = await cachedDataForSeoCall(spec(), deps);
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
    const [r1, r2] = await Promise.all([cachedDataForSeoCall(spec(), deps), cachedDataForSeoCall(spec(), deps)]);
    expect([r1.state, r2.state].sort()).toEqual(["ok", "waiting"]);
    expect(calls.fetch).toHaveLength(1);
  });

  it("a reservation refusal (cap) makes zero network calls", async () => {
    const { deps, calls } = makeDeps({ reserveProviderSpend: async () => false });
    expect((await cachedDataForSeoCall(spec(), deps)).state).toBe("capped");
    expect(calls.fetch).toHaveLength(0);
  });

  it("a reservation write failure makes zero network calls and reports error", async () => {
    const { deps, calls } = makeDeps({ reserveProviderSpend: async () => { throw new Error("db down"); } });
    expect((await cachedDataForSeoCall(spec(), deps)).state).toBe("error");
    expect(calls.fetch).toHaveLength(0);
  });

  it("the global breaker refusal makes zero network, zero reservation", async () => {
    const { deps, calls } = makeDeps({ breaker: async () => ({ tripped: true, reason: "ceiling reached" }) });
    expect((await cachedDataForSeoCall(spec(), deps)).state).toBe("capped");
    expect(calls.fetch).toHaveLength(0);
    expect(calls.reserve).toHaveLength(0);
  });

  it("dry-run (default) makes zero network and zero reservation", async () => {
    const { deps, calls } = makeDeps({ env: { ...ENV, DATAFORSEO_DRY_RUN: "true" } as unknown as NodeJS.ProcessEnv });
    expect((await cachedDataForSeoCall(spec(), deps)).state).toBe("dry_run");
    expect(calls.fetch).toHaveLength(0);
    expect(calls.reserve).toHaveLength(0);
  });

  it("not_configured makes zero network, zero reservation, and never claims", async () => {
    const claim = vi.fn();
    const { deps, calls } = makeDeps({ env: { DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv, claimEvidenceFetch: claim as never });
    expect((await cachedDataForSeoCall(spec(), deps)).state).toBe("not_configured");
    expect(calls.fetch).toHaveLength(0);
    expect(calls.reserve).toHaveLength(0);
    expect(claim).not.toHaveBeenCalled();
  });

  it("an HTTP-200 non-success envelope with no reported cost keeps the reservation", async () => {
    const { deps, calls } = makeDeps({
      fetchImpl: vi.fn(async (u: string) => { calls.fetch.push(u); return json({ status_code: 40400, tasks: [] }); }) as unknown as typeof fetch,
    });
    expect((await cachedDataForSeoCall(spec(), deps)).state).toBe("error");
    expect(calls.reserve).toEqual([0.01]);
    expect(calls.adjust).toHaveLength(0); // unknown cost -> never undercount
  });

  it("cache identity excludes tenantId and splits on location / model", async () => {
    const key = async (s: CachedCallSpec) => (await cachedDataForSeoCall(s, makeDeps({ claimEvidenceFetch: claimReady([]) }).deps)).cacheKey as string;
    const a = await key(spec({ tenantId: "tenant-a" }));
    expect(await key(spec({ tenantId: "tenant-b" }))).toBe(a); // tenant-independent
    expect(await key(spec({ locationCode: 2826 }))).not.toBe(a);
    expect(await key(spec({ modelRequested: "gpt-4o" }))).not.toBe(a);
  });
});

describe("Standard-mode tasks — durable waiting and free resumption", () => {
  const taskSpec = spec({ endpoint: "serp/google/organic/task_post", mode: "task" });

  it("posts once, persists the task id, and returns durable waiting", async () => {
    const { deps, calls } = makeDeps({
      fetchImpl: vi.fn(async (u: string) => { calls.fetch.push(u); return json({ status_code: 20000, cost: 0.006, tasks: [{ status_code: 20100, id: "task-123" }] }); }) as unknown as typeof fetch,
    });
    const res = await cachedDataForSeoCall(taskSpec, deps);
    expect(res.state).toBe("waiting");
    if (res.state === "waiting") expect(res.providerTaskId).toBe("task-123");
    expect(calls.writes.some((w) => w.provider_task_id === "task-123")).toBe(true);
  });

  it("after process death, a pending claim GETs the task and never reposts", async () => {
    const { deps, calls } = makeDeps({
      claimEvidenceFetch: async () => ({ outcome: "pending", payload: null, providerTaskId: "task-123", modelServed: null, readyAt: null, costUsd: 0.006 }),
      cacheRead: async () => taskRow("serp/google/organic/task_post", "task-123"),
      fetchImpl: vi.fn(async (u: string) => { calls.fetch.push(u); return json(liveOk(0)); }) as unknown as typeof fetch, // GET result ready, free
    });
    const res = await cachedDataForSeoCall(taskSpec, deps);
    expect(res.state).toBe("ok");
    if (res.state === "ok") expect(res.costUsd).toBe(0);
    expect(calls.fetch).toEqual([expect.stringContaining("/task_get/advanced/task-123")]);
    expect(calls.fetch[0]).not.toContain("task_post");
  });

  it("a not-ready GET returns retry-able waiting, never error, never repost", async () => {
    const { deps, calls } = makeDeps({
      cacheRead: async () => taskRow("serp/google/organic/task_post", "task-9"),
      fetchImpl: vi.fn(async (u: string) => { calls.fetch.push(u); return json({ status_code: 20000, tasks: [{ status_code: 40602, id: "task-9", result: null }] }); }) as unknown as typeof fetch,
    });
    expect((await collectDataForSeoTask("k", deps)).state).toBe("waiting");
    expect(calls.fetch.every((u) => u.includes("task_get"))).toBe(true);
  });
});
