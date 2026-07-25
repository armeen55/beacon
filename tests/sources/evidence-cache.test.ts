/**
 * Slice 6/6C/6D canonical evidence cache + atomic money path + task lifecycle.
 * Every seam injected: no network, no Supabase, no spend. Proves reserve ->
 * network -> reconcile, single-flight, tenant-independent identity, the envelope
 * rule, free resumption, the STRUCTURED failure dispositions, QUARANTINE (zero
 * automatic paid reposts) with free tasks_ready recovery, and fail-closed
 * persistence down to an UPDATE that matches zero rows.
 */
import { describe, it, expect, vi } from "vitest";
import { runResolvedCall, collectResolvedTask, identityCacheKey, type CachedCallDeps, type ResolvedCall } from "@/domains/evidence/dataforseo/cached-call";

/** Every UPDATE matches ZERO rows here, so the production write seam must throw. */
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) }),
}));

const ENV = { BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc", DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-07-25T12:00:00.000Z");
const FUTURE = new Date(NOW.getTime() + 86_400_000).toISOString();
const SERP = "serp/google/organic";
const PATHS = { getPath: (_e: string, id: string) => `${SERP}/task_get/advanced/${id}`, tasksReadyPath: () => `${SERP}/tasks_ready`, ttlMsFor: () => 86_400_000 };
function resolved(over: Partial<ResolvedCall> = {}): ResolvedCall {
  const base: ResolvedCall = {
    cacheKey: "", endpoint: `${SERP}/live/advanced`, endpointVersion: "v3", postPath: `${SERP}/live/advanced`, getPath: null,
    tasksReadyPath: null, publicInput: { keyword: "koobideh", depth: 10 }, locationCode: 2840, languageCode: "en", device: null,
    modelRequested: null, payload: [{ keyword: "koobideh" }], ttlMs: 60_000, estCostUsd: 0.01, mode: "live", tenantId: "tenant-a", ...over };
  base.cacheKey = base.cacheKey || identityCacheKey(base);
  return base;
}
const taskCall = () => resolved({ endpoint: `${SERP}/task_post`, postPath: `${SERP}/task_post`, getPath: (id) => `${SERP}/task_get/advanced/${id}`, tasksReadyPath: `${SERP}/tasks_ready`, mode: "task" });
const claim = (outcome: "ready" | "pending" | "claimed", over: Record<string, unknown> = {}) => async () => ({ outcome, payload: null, providerTaskId: null, modelServed: null, readyAt: null, costUsd: 0, ...over });
const liveOk = (cost: number, result: unknown = [{ rank: 1 }]) => ({ status_code: 20000, cost, tasks: [{ status_code: 20000, id: "t1", result }] });
const inBody = (code: number) => ({ status_code: 20000, tasks: [{ status_code: code, id: "task-9", result: null }] });
const listing = (entries: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result: entries }] });
const row = (over: Record<string, unknown> = {}) => async () => ({ cache_key: "k", endpoint: `${SERP}/task_post`, status: "pending" as const, provider_task_id: "task-9", payload: null, model_served: null, cost_usd: 0.006, expires_at: FUTURE, quarantined_at: null, ...over });
const httpFail = (status: number) => vi.fn(async () => new Response("no", { status })) as unknown as typeof fetch;
const fetcher = (calls: { fetch: string[] }, pick: (u: string) => unknown) => vi.fn(async (u: string) => { calls.fetch.push(u); return new Response(JSON.stringify(pick(u)), { status: 200 }); }) as unknown as typeof fetch;
const postAccepted = (calls: { fetch: string[] }) => fetcher(calls, () => ({ status_code: 20000, cost: 0.006, tasks: [{ status_code: 20100, id: "task-123" }] }));
/** The dead-identity clear: the ONLY write that permits a later clean repost. */
const cleared = (writes: Record<string, unknown>[]) => writes.some((w) => w.provider_task_id === null && w.status === "error");
const quarantined = (writes: Record<string, unknown>[]) => writes.some((w) => typeof w.quarantined_at === "string");
function makeDeps(over: Partial<CachedCallDeps> = {}) {
  const calls = { fetch: [] as string[], reserve: [] as number[], adjust: [] as number[], writes: [] as Record<string, unknown>[] };
  const deps: Partial<CachedCallDeps> = {
    env: ENV, now: () => NOW, fetchImpl: fetcher(calls, () => liveOk(0.0021)), claimEvidenceFetch: claim("claimed"),
    reserveProviderSpend: async (_t, _p, amount) => { calls.reserve.push(amount); return true; },
    adjustProviderSpend: async (_t, _p, delta) => { calls.adjust.push(delta); return true; },
    cacheRead: async () => null, cacheWrite: async (_k, patch) => { calls.writes.push(patch); },
    breaker: async () => ({ tripped: false }), ...over };
  return { deps: deps as unknown as Record<string, unknown>, calls };
}
/** A quarantined row on a LATER visit: the claim can only answer pending, and no
 *  branch may POST. `ready` is what the one free tasks_ready GET returns. */
async function secondVisit(ready: unknown) {
  const g = makeDeps({ claimEvidenceFetch: claim("pending"), cacheRead: row({ provider_task_id: null, quarantined_at: NOW.toISOString() }) });
  g.deps.fetchImpl = fetcher(g.calls, (u) => (u.includes("tasks_ready") ? ready : liveOk(0)));
  return { res: await runResolvedCall(taskCall(), g.deps), calls: g.calls };
}
describe("runResolvedCall - the atomic money path", () => {
  it("a miss makes one network call, one reservation, one reconcile, and caches the FULL envelope", async () => {
    const { deps, calls } = makeDeps();
    const res = await runResolvedCall(resolved(), deps);
    if (res.state !== "ok") throw new Error(res.state);
    expect([res.costUsd, calls.fetch.length]).toEqual([0.0021, 1]);
    expect(calls.reserve).toEqual([0.01]);
    expect(calls.adjust).toEqual([0.0021 - 0.01]); // reconcile est -> actual
    expect([res.envelope.status_code, res.envelope.tasks?.[0]?.result]).toEqual([20000, [{ rank: 1 }]]); // ENVELOPE RULE: top level kept, parsers still see inside
    expect((calls.writes.find((w) => w.status === "ready")?.payload as { status_code?: number }).status_code).toBe(20000);
  });
  it("an identical repeat is a zero-network, zero-cost hit", async () => {
    const { deps, calls } = makeDeps({ claimEvidenceFetch: claim("ready", { payload: [{ rank: 1 }] }) });
    const res = await runResolvedCall(resolved(), deps);
    if (res.state !== "hit") throw new Error(res.state);
    expect([res.costUsd, calls.fetch.length, calls.reserve.length]).toEqual([0, 0, 0]);
  });
  it("concurrent identical misses (second claim is pending) pay at most once", async () => {
    let n = 0;
    const { deps, calls } = makeDeps({ claimEvidenceFetch: async () => claim(n++ === 0 ? "claimed" : "pending")() });
    const [r1, r2] = await Promise.all([runResolvedCall(resolved(), deps), runResolvedCall(resolved(), deps)]);
    expect([r1.state, r2.state].sort()).toEqual(["ok", "waiting"]);
    expect(calls.fetch).toHaveLength(1);
    const pending = [r1, r2].find((r) => r.state === "waiting");
    if (pending?.state === "waiting") expect(pending.costUsd).toBe(0); // a bare pending claim charges nothing
  });
  it("no un-paid path (cap / reserve-throw / breaker / dry-run / not_configured) ever touches the network", async () => {
    const spy = vi.fn();
    const cap = makeDeps({ reserveProviderSpend: async () => false });
    const rerr = makeDeps({ reserveProviderSpend: async () => { throw new Error("db down"); } });
    const brk = makeDeps({ breaker: async () => ({ tripped: true, reason: "ceiling reached" }) });
    const dry = makeDeps({ env: { ...ENV, DATAFORSEO_DRY_RUN: "true" } as unknown as NodeJS.ProcessEnv });
    const nc = makeDeps({ env: { DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv, claimEvidenceFetch: spy as never });
    const states = [];
    for (const g of [cap, rerr, brk, dry, nc]) states.push((await runResolvedCall(resolved(), g.deps)).state);
    expect(states).toEqual(["capped", "error", "capped", "dry_run", "not_configured"]);
    for (const g of [cap, rerr, brk, dry, nc]) expect(g.calls.fetch).toHaveLength(0);
    for (const g of [brk, dry, nc]) expect(g.calls.reserve).toHaveLength(0); // breaker/dry/not-configured never reserve
    expect(spy).not.toHaveBeenCalled(); // not_configured never even claims
  });
  it("an HTTP-200 non-success envelope with no reported cost keeps the reservation", async () => {
    const { deps, calls } = makeDeps();
    deps.fetchImpl = fetcher(calls, () => ({ status_code: 40400, tasks: [] }));
    expect((await runResolvedCall(resolved(), deps)).state).toBe("error");
    expect(calls.reserve).toEqual([0.01]);
    expect(calls.adjust).toHaveLength(0); // unknown cost -> never undercount
  });
  it("cache identity has NO tenant input and splits on location / model", async () => {
    const a = identityCacheKey(resolved());
    expect(identityCacheKey(resolved({ tenantId: "tenant-b" }))).toBe(a); // tenant never enters identity
    expect([identityCacheKey(resolved({ locationCode: 2826 })), identityCacheKey(resolved({ modelRequested: "gpt-4o" }))]).not.toContain(a);
  });
});
describe("Standard tasks - free resumption and the STRUCTURED dispositions", () => {
  it("posts once, persists the task id, and returns durable waiting with the provider cost exactly once", async () => {
    const { deps, calls } = makeDeps();
    deps.fetchImpl = postAccepted(calls);
    const res = await runResolvedCall(taskCall(), deps);
    if (res.state !== "waiting") throw new Error(res.state);
    expect([res.providerTaskId, res.costUsd, calls.fetch.length]).toEqual(["task-123", 0.006, 1]); // actual, once
    expect(calls.writes.some((w) => w.provider_task_id === "task-123")).toBe(true);
  });
  it("after process death, a pending claim GETs the task free (adds 0) and never reposts", async () => {
    const { deps, calls } = makeDeps({ claimEvidenceFetch: claim("pending", { providerTaskId: "task-123" }), cacheRead: row({ provider_task_id: "task-123" }) });
    deps.fetchImpl = fetcher(calls, () => liveOk(0));
    const res = await runResolvedCall(taskCall(), deps);
    if (res.state !== "ok") throw new Error(res.state);
    expect([res.costUsd, calls.reserve.length]).toEqual([0, 0]); // no reservation on a free resume
    expect(calls.fetch).toEqual([expect.stringContaining("/task_get/advanced/task-123")]);
    // FRESHNESS truth: the collected row expires on the REGISTRY ttl (60s fixture),
    // never the 30-day task retention, so a due re-observation re-buys.
    expect(Date.parse(calls.writes.find((w) => w.status === "ready")!.expires_at as string) - NOW.getTime()).toBe(60_000);
  });
  it("maps every in-body task code onto the frozen disposition and clears ONLY a proven dead identity", async () => {
    const cases: [number, string, boolean][] = [
      [40601, "waiting", false], [40602, "waiting", false], // genuine queue: free GET, zero reposts
      [50000, "retry_free", false], [50100, "retry_free", false], // transient: the SAME id is kept
      [40100, "blocked", false], [40200, "blocked", false], [40501, "blocked", false], // account/contract: pause, keep the id
      [40401, "repost_once", true], [40403, "repost_once", true], // proven gone: clear, then ONE clean repost
    ];
    for (const [code, want, clears] of cases) {
      const { deps, calls } = makeDeps({ cacheRead: row() });
      deps.fetchImpl = fetcher(calls, () => inBody(code));
      const res = await collectResolvedTask("k", PATHS, deps);
      expect(res.state === "error" ? res.disposition : res.state).toBe(want);
      if (res.state === "error") expect(res.detail).toContain(String(code));
      expect(cleared(calls.writes)).toBe(clears);
      expect(calls.fetch.every((u) => u.includes("task_get"))).toBe(true); // never a repost
    }
  });
  it("repeated visits on a queued (40602) and on a transient (50000) task stay GET-only on the SAME id", async () => {
    for (const code of [40602, 50000]) {
      const { deps, calls } = makeDeps({ cacheRead: row() });
      deps.fetchImpl = fetcher(calls, () => inBody(code));
      await collectResolvedTask("k", PATHS, deps);
      await collectResolvedTask("k", PATHS, deps);
      expect(calls.fetch.filter((u) => u.includes("task_get/advanced/task-9"))).toHaveLength(2);
      expect(cleared(calls.writes)).toBe(false); // the id is PRESERVED across both visits
    }
  });
  it("on the FREE GET a 404 is repost_once with the identity cleared; any other transport failure keeps the task", async () => {
    const dead = makeDeps({ cacheRead: row(), fetchImpl: httpFail(404) });
    const d1 = await collectResolvedTask("k", PATHS, dead.deps);
    expect(d1.state === "error" && d1.disposition).toBe("repost_once");
    expect(cleared(dead.calls.writes)).toBe(true);
    const blip = makeDeps({ cacheRead: row(), fetchImpl: httpFail(503) });
    const b1 = await collectResolvedTask("k", PATHS, blip.deps);
    if (b1.state !== "waiting") throw new Error(b1.state);
    expect([b1.costUsd, b1.providerTaskId]).toEqual([0, "task-9"]);
    expect(b1.detail).toContain("503");
    expect(cleared(blip.calls.writes)).toBe(false);
  });
});
describe("quarantine - zero automatic paid reposts, free recovery only", () => {
  it("a quarantine past the provider's listing window releases for ONE clean repost, never eternal stall", async () => {
    const old = new Date(NOW.getTime() - 5 * 86_400_000).toISOString(); // past the 4-day bound
    const { deps, calls } = makeDeps({ cacheRead: row({ provider_task_id: null, quarantined_at: old }) });
    deps.fetchImpl = fetcher(calls, () => ({ status_code: 20000, tasks: [{ status_code: 20000, result: [] }] })); // listing finds nothing
    const res = await collectResolvedTask("k", PATHS, deps);
    expect(res.state === "error" && res.disposition).toBe("repost_once");
    expect(calls.writes.some((w) => w.quarantined_at === null && w.provider_task_id === null)).toBe(true); // released clean
    expect(calls.fetch.every((u) => u.includes("tasks_ready"))).toBe(true); // zero posts here
  });
  it("an UNCERTAIN post quarantines the row, and the next visit never posts again", async () => {
    const { deps, calls } = makeDeps({ fetchImpl: vi.fn(async () => { throw new Error("timeout"); }) as unknown as typeof fetch });
    const res = await runResolvedCall(taskCall(), deps);
    if (res.state !== "error") throw new Error(res.state);
    expect(res.disposition).toBe("quarantined"); // a visible pause, never silent waiting
    expect(calls.reserve).toEqual([0.01]); // reservation kept: overcount, never undercount
    expect([calls.adjust.length, quarantined(calls.writes)]).toEqual([0, true]);
    const next = await secondVisit(listing([]));
    if (next.res.state !== "error") throw new Error(next.res.state);
    expect(next.res.disposition).toBe("quarantined");
    expect(next.calls.fetch).toEqual([expect.stringContaining("/tasks_ready")]); // ONE free listing, zero posts
    expect(next.calls.reserve).toHaveLength(0);
  });
  it("an accepted post whose id could not be saved is quarantined, and later visits never post", async () => {
    const g = makeDeps();
    let n = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (++n === 2) throw new Error("db down"); };
    g.deps.fetchImpl = postAccepted(g.calls);
    const res = await runResolvedCall(taskCall(), g.deps);
    if (res.state !== "error") throw new Error(res.state);
    expect(res.disposition).toBe("quarantined");
    expect(g.calls.adjust).toEqual([0.006 - 0.01]); // reconciled to actual; reservation kept
    expect(quarantined(g.calls.writes)).toBe(true);
    const next = await secondVisit(listing([]));
    expect(next.calls.fetch.some((u) => u.includes("task_post"))).toBe(false);
  });
  it("recovers the id for FREE from tasks_ready by our own tag, then collects it", async () => {
    const g = makeDeps({ cacheRead: row({ provider_task_id: null, quarantined_at: NOW.toISOString() }) });
    g.deps.fetchImpl = fetcher(g.calls, (u) => (u.includes("tasks_ready") ? listing([{ id: "someone-else", tag: "other-key" }, { id: "task-77", tag: "k" }]) : liveOk(0)));
    const res = await collectResolvedTask("k", PATHS, g.deps);
    if (res.state !== "ok") throw new Error(res.state);
    expect(res.costUsd).toBe(0);
    expect(g.calls.writes.some((w) => w.provider_task_id === "task-77" && w.quarantined_at === null)).toBe(true);
    expect(g.calls.fetch[0]).toContain(`${SERP}/tasks_ready`);
    expect(g.calls.fetch[1]).toContain("/task_get/advanced/task-77");
    expect(g.calls.fetch.some((u) => u.includes("task_post"))).toBe(false);
  });
});
describe("fail-closed cache persistence - never report success on an unsaved row", () => {
  it("a failed pre-post receipt makes ZERO network calls, errors, and reconciles the reservation down", async () => {
    const { deps, calls } = makeDeps({ cacheWrite: async () => { throw new Error("db down"); } });
    const res = await runResolvedCall(taskCall(), deps);
    if (res.state !== "error") throw new Error(res.state);
    expect([res.disposition, calls.fetch.length]).toEqual(["none", 0]); // never posted
    expect(calls.adjust).toEqual([-0.01]); // reservation reconciled back down
  });
  it("a failed ready-envelope persistence errors (never ok) and keeps the reservation", async () => {
    const { deps, calls } = makeDeps({ cacheWrite: async () => { throw new Error("db down"); } });
    const res = await runResolvedCall(resolved(), deps); // live mode, paid
    expect(res.state).toBe("error"); // a caller must not treat an unsaved result as cached
    expect(calls.fetch).toHaveLength(1); // it did fetch (paid)
    expect(calls.reserve).toEqual([0.01]); // reservation kept
  });
  it("the production write seam treats an UPDATE matching ZERO rows as a failure, so the caller errors", async () => {
    const { deps, calls } = makeDeps();
    delete deps.cacheWrite; // fall through to the real seam against the zero-row mock
    const res = await runResolvedCall(resolved(), deps);
    if (res.state !== "error") throw new Error(res.state); // never "ok" on a row that saved nothing
    expect([res.disposition, calls.fetch.length]).toEqual(["none", 1]);
  });
});
