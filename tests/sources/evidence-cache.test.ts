/**
 * Slice 6/6C/6D/6E canonical evidence cache + atomic money path + task lifecycle.
 * Every seam injected: no network, no Supabase, no spend. Proves reserve -> network
 * -> reconcile, single-flight, tenant-independent identity, the envelope rule, free
 * resumption, the STRUCTURED dispositions, INDEFINITE quarantine for BOTH Standard
 * and Live (zero automatic paid retries after an ambiguous outcome), the one-GET
 * listing memo, and fail-closed reads and writes. No paid call is ever repeated.
 */
import { describe, it, expect, vi } from "vitest";
import { runResolvedCall, collectResolvedTask, identityCacheKey, type CachedCallDeps, type ResolvedCall } from "@/domains/evidence/dataforseo/cached-call";
/** Every UPDATE matches ZERO rows here, so the production write seam must throw. */
vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({ from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) }),
}));
const ENV = { BEACON_SERP_PROVIDER: "dataforseo", DATAFORSEO_AUTH_B64: "abc", DATAFORSEO_DRY_RUN: "false" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-07-25T12:00:00.000Z"); const FUTURE = new Date(NOW.getTime() + 86_400_000).toISOString();
const SERP = "serp/google/organic";
const PATHS = { getPath: (_e: string, id: string) => `${SERP}/task_get/advanced/${id}`, tasksReadyPath: () => `${SERP}/tasks_ready`, ttlMsFor: () => 86_400_000 };
function resolved(over: Partial<ResolvedCall> = {}): ResolvedCall {
  const base: ResolvedCall = {
    cacheKey: "", endpoint: `${SERP}/live/advanced`, endpointVersion: "v3", postPath: `${SERP}/live/advanced`, getPath: null, tasksReadyPath: null, device: null,
    publicInput: { keyword: "koobideh", depth: 10 }, locationCode: 2840, languageCode: "en", modelRequested: null, payload: [{ keyword: "koobideh" }], ttlMs: 60_000, estCostUsd: 0.01, mode: "live", tenantId: "tenant-a", ...over };
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
/** UNCERTAIN: the transport throws, so the provider may have taken and charged it. */
const throwing = () => vi.fn(async () => { throw new Error("timeout"); }) as unknown as typeof fetch;
const fetcher = (calls: { fetch: string[] }, pick: (u: string) => unknown) => vi.fn(async (u: string) => { calls.fetch.push(u); return new Response(JSON.stringify(pick(u)), { status: 200 }); }) as unknown as typeof fetch;
const postAccepted = (calls: { fetch: string[] }) => fetcher(calls, () => ({ status_code: 20000, cost: 0.006, tasks: [{ status_code: 20100, id: "task-123" }] }));
/** cleared = the dead-identity write, the ONLY one that permits a later clean repost. released = handing the lease back, which is what lets a later visit pay again. */
const cleared = (writes: Record<string, unknown>[]) => writes.some((w) => w.provider_task_id === null && w.status === "error");
const quarantined = (writes: Record<string, unknown>[]) => writes.some((w) => typeof w.quarantined_at === "string");
const released = (writes: Record<string, unknown>[]) => writes.some((w) => w.status === "error" && w.fetch_claimed_until === null);
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
/** A quarantined row on a LATER visit: the claim can only answer pending and no branch may POST. `ready` = what the one free tasks_ready GET returns. */
async function secondVisit(ready: unknown, at: Date = NOW) {
  const g = makeDeps({ now: () => at, claimEvidenceFetch: claim("pending"), cacheRead: row({ provider_task_id: null, quarantined_at: NOW.toISOString() }) });
  g.deps.fetchImpl = fetcher(g.calls, (u) => (u.includes("tasks_ready") ? ready : liveOk(0)));
  return { res: await runResolvedCall(taskCall(), g.deps), calls: g.calls };
}
describe("runResolvedCall - the atomic money path", () => {
  it("a miss takes a pre-call receipt, one network call, one reservation, one reconcile, and caches the FULL envelope", async () => {
    const { deps, calls } = makeDeps();
    const res = await runResolvedCall(resolved(), deps);
    expect([res.state, res.state === "ok" && res.costUsd, calls.fetch.length, calls.reserve, calls.adjust]).toEqual(["ok", 0.0021, 1, [0.01], [0.0021 - 0.01]]); // reserve first, reconcile est -> actual
    expect([res.state === "ok" && res.envelope.status_code, res.state === "ok" && res.envelope.tasks?.[0]?.result]).toEqual([20000, [{ rank: 1 }]]); // ENVELOPE RULE: top kept, parsers still see inside
    const ready = calls.writes.find((w) => w.status === "ready")!;
    expect([typeof calls.writes[0].posted_attempt_at, (ready.payload as { status_code?: number }).status_code, ready.posted_attempt_at]).toEqual(["string", 20000, null]); // receipt BEFORE the network, cleared by the finished call
  });
  it("an identical repeat is a zero-network, zero-cost hit", async () => {
    const { deps, calls } = makeDeps({ claimEvidenceFetch: claim("ready", { payload: [{ rank: 1 }] }) });
    expect([(await runResolvedCall(resolved(), deps)).state, calls.fetch.length, calls.reserve.length]).toEqual(["hit", 0, 0]); // a hit is typed costUsd: 0
  });
  it("concurrent identical misses (second claim is pending) pay at most once", async () => {
    let n = 0;
    const { deps, calls } = makeDeps({ claimEvidenceFetch: async () => claim(n++ === 0 ? "claimed" : "pending")() });
    const [r1, r2] = await Promise.all([runResolvedCall(resolved(), deps), runResolvedCall(resolved(), deps)]);
    expect([[r1.state, r2.state].sort(), calls.fetch.length]).toEqual([["ok", "waiting"], 1]);
    const pending = [r1, r2].find((r) => r.state === "waiting");
    expect(pending?.state === "waiting" && pending.costUsd).toBe(0); // a bare pending claim charges nothing
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
  it("an HTTP-200 unusable envelope with UNKNOWN cost quarantines (may be charged); a REPORTED zero cost releases", async () => {
    const { deps, calls } = makeDeps();
    deps.fetchImpl = fetcher(calls, () => ({ status_code: 40400, tasks: [] }));
    const res = await runResolvedCall(resolved(), deps);
    expect([res.state === "error" && res.disposition, calls.reserve, calls.adjust.length, quarantined(calls.writes)]).toEqual(["quarantined", [0.01], 0, true]); // never undercount, never re-buy
    const zero = makeDeps(); zero.deps.fetchImpl = fetcher(zero.calls, () => ({ status_code: 40400, cost: 0, tasks: [] }));
    const rz = await runResolvedCall(resolved(), zero.deps);
    expect([rz.state === "error" && rz.disposition, zero.calls.adjust, quarantined(zero.calls.writes)]).toEqual(["none", [-0.01], false]); // proven unpaid: safe to retry later
  });
  it("HTTP 401/402/404 are proven pre-execution rejections (release); a 5xx is UNCERTAIN and quarantines", async () => {
    const rej = makeDeps({ fetchImpl: httpFail(402) }); const r1 = await runResolvedCall(resolved(), rej.deps);
    expect([r1.state === "error" && r1.disposition, rej.calls.adjust, released(rej.calls.writes)]).toEqual(["none", [-0.01], true]); // charged nothing, safe retry
    const five = makeDeps({ fetchImpl: httpFail(500) }); const r2 = await runResolvedCall(resolved(), five.deps);
    expect([r2.state === "error" && r2.disposition, five.calls.adjust.length, quarantined(five.calls.writes), released(five.calls.writes)]).toEqual(["quarantined", 0, true, false]); // may have run and billed: hold the money
  });
  it("cache identity has NO tenant input and splits on location / model", async () => {
    const a = identityCacheKey(resolved());
    const others = [identityCacheKey(resolved({ locationCode: 2826 })), identityCacheKey(resolved({ modelRequested: "gpt-4o" }))];
    expect([identityCacheKey(resolved({ tenantId: "tenant-b" })), others.includes(a)]).toEqual([a, false]); // tenant never enters identity; location and model always split it
  });
});
describe("Standard tasks - free resumption and the STRUCTURED dispositions", () => {
  it("posts once, persists the task id, and returns durable waiting with the provider cost exactly once", async () => {
    const { deps, calls } = makeDeps();
    deps.fetchImpl = postAccepted(calls);
    const res = await runResolvedCall(taskCall(), deps);
    expect([res.state, res.state === "waiting" && res.providerTaskId, res.state === "waiting" && res.costUsd, calls.fetch.length, calls.writes.some((w) => w.provider_task_id === "task-123")]).toEqual(["waiting", "task-123", 0.006, 1, true]); // the actual cost, once, with the id persisted
  });
  it("after process death, a pending claim GETs the task free (adds 0) and never reposts", async () => {
    const { deps, calls } = makeDeps({ claimEvidenceFetch: claim("pending", { providerTaskId: "task-123" }), cacheRead: row({ provider_task_id: "task-123" }) });
    deps.fetchImpl = fetcher(calls, () => liveOk(0));
    const res = await runResolvedCall(taskCall(), deps);
    expect([res.state, res.state === "ok" && res.costUsd, calls.reserve.length]).toEqual(["ok", 0, 0]); // no reservation on a free resume
    expect(calls.fetch).toEqual([expect.stringContaining("/task_get/advanced/task-123")]);
    // FRESHNESS truth: a collected row expires on the REGISTRY ttl (60s fixture), never the 30-day task retention, so a due re-observation re-buys.
    expect(Date.parse(calls.writes.find((w) => w.status === "ready")!.expires_at as string) - NOW.getTime()).toBe(60_000);
  });
  it("maps every in-body task code onto the frozen disposition and clears ONLY a proven dead identity", async () => {
    const cases: [number, string, boolean][] = [
      [40601, "waiting", false], [40602, "waiting", false], // genuine queue: free GET, zero reposts
      [50000, "retry_free", false], [50301, "retry_free", false], // transient: the SAME id is kept
      [40100, "blocked", false], [40200, "blocked", false], [40501, "blocked", false], // account/contract: pause, keep the id
      [40401, "repost_once", true], [40403, "repost_once", true]]; // proven gone: clear, then ONE clean repost
    for (const [code, want, clears] of cases) {
      const { deps, calls } = makeDeps({ cacheRead: row() });
      deps.fetchImpl = fetcher(calls, () => inBody(code));
      const res = await collectResolvedTask("k", PATHS, deps);
      expect(res.state === "error" ? res.disposition : res.state).toBe(want);
      if (res.state === "error") expect(res.detail).toContain(String(code));
      expect([cleared(calls.writes), calls.fetch.every((u) => u.includes("task_get"))]).toEqual([clears, true]); // never a repost
    }
  });
  it("on the FREE GET a raw 404 fails closed (identity kept, no repost); any other transport failure keeps the task", async () => {
    const dead = makeDeps({ cacheRead: row(), fetchImpl: httpFail(404) });
    const d1 = await collectResolvedTask("k", PATHS, dead.deps);
    expect([d1.state === "error" && d1.disposition, cleared(dead.calls.writes)]).toEqual(["blocked", false]); // only in-body 40401/40403 ever authorize the repost
    const blip = makeDeps({ cacheRead: row(), fetchImpl: httpFail(503) }); const b1 = await collectResolvedTask("k", PATHS, blip.deps);
    expect([b1.state, b1.state === "waiting" && b1.costUsd, b1.state === "waiting" && b1.providerTaskId, cleared(blip.calls.writes)]).toEqual(["waiting", 0, "task-9", false]);
    expect(b1.state === "waiting" && b1.detail).toContain("503");
  });
});
describe("quarantine - indefinite, both modes, zero automatic paid retries", () => {
  it("an UNCERTAIN Standard post stays quarantined FOREVER: 30 days on it is still one free listing GET and zero posts", async () => {
    const { deps, calls } = makeDeps({ fetchImpl: throwing() });
    const res = await runResolvedCall(taskCall(), deps);
    expect(res.state === "error" && res.disposition).toBe("quarantined"); // a visible pause, never silent waiting
    expect([calls.reserve, calls.adjust.length, quarantined(calls.writes)]).toEqual([[0.01], 0, true]); // reservation kept: overcount, never undercount
    const next = await secondVisit(listing([]), new Date(NOW.getTime() + 30 * 86_400_000));
    expect(next.res.state === "error" && next.res.disposition).toBe("quarantined"); // never repost_once, however long it has been
    expect(next.calls.fetch).toEqual([expect.stringContaining("/tasks_ready")]); // ONE free listing, zero posts
    expect([next.calls.reserve.length, cleared(next.calls.writes)]).toEqual([0, false]);
  });
  it("an uncertain LIVE call keeps the reservation, quarantines, and the next visit buys nothing", async () => {
    const { deps, calls } = makeDeps({ fetchImpl: throwing() });
    const res = await runResolvedCall(resolved(), deps);
    expect(res.state === "error" && res.disposition).toBe("quarantined");
    expect(res.state === "error" && res.detail).toContain("set it aside"); // a live call has no free finished list
    expect([calls.reserve, calls.adjust.length]).toEqual([[0.01], 0]); // never reconciled down: the provider may have charged it
    expect([quarantined(calls.writes), released(calls.writes)]).toEqual([true, false]);
    const g = makeDeps({ claimEvidenceFetch: claim("pending"), cacheRead: row({ provider_task_id: null, quarantined_at: NOW.toISOString() }) });
    const later = await runResolvedCall(resolved(), g.deps); // a LATER visit reads the quarantined row and says so
    expect([later.state === "error" && later.disposition, g.calls.fetch.length, g.calls.reserve.length]).toEqual(["quarantined", 0, 0]);
  });
  it("an accepted post whose id could not be saved is quarantined, and later visits never post", async () => {
    const g = makeDeps();
    let n = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (++n === 2) throw new Error("db down"); };
    g.deps.fetchImpl = postAccepted(g.calls);
    const res = await runResolvedCall(taskCall(), g.deps);
    expect(res.state === "error" && res.disposition).toBe("quarantined");
    expect([g.calls.adjust, quarantined(g.calls.writes)]).toEqual([[0.006 - 0.01], true]); // reconciled to actual; reservation kept
    expect((await secondVisit(listing([]))).calls.fetch.some((u) => u.includes("task_post"))).toBe(false);
  });
  it("recovers the id for FREE from tasks_ready by our own tag, then collects it", async () => {
    const g = makeDeps({ cacheRead: row({ provider_task_id: null, quarantined_at: NOW.toISOString() }) });
    g.deps.fetchImpl = fetcher(g.calls, (u) => (u.includes("tasks_ready") ? listing([{ id: "someone-else", tag: "other-key" }, { id: "task-77", tag: "k" }]) : liveOk(0)));
    const paths = { ...PATHS, tasksReadyPath: () => "ai_optimization/claude/llm_responses/tasks_ready" }; // a family no other test's bucket touches
    const res = await collectResolvedTask("k", paths, g.deps);
    expect([res.state, res.state === "ok" && res.costUsd]).toEqual(["ok", 0]);
    expect(g.calls.writes.some((w) => w.provider_task_id === "task-77" && w.quarantined_at === null)).toBe(true);
    expect(g.calls.fetch).toEqual([expect.stringContaining("/llm_responses/tasks_ready"), expect.stringContaining("/task_get/advanced/task-77")]); // free listing, free collect, never a post
  });
  it("several quarantined rows in one family cost ONE free listing GET per bucket window, then a fresh free GET", async () => {
    const g = makeDeps({ cacheRead: row({ provider_task_id: null, quarantined_at: NOW.toISOString() }) });
    g.deps.fetchImpl = fetcher(g.calls, () => listing([])); const paths = { ...PATHS, tasksReadyPath: () => "serp/google/ai_mode/tasks_ready" }; // family untouched by other tests
    await collectResolvedTask("k1", paths, g.deps);
    g.deps.now = () => new Date(NOW.getTime() + 30_000); // still inside the 60s bucket
    await collectResolvedTask("k2", paths, g.deps);
    expect(g.calls.fetch).toHaveLength(1); // one FREE listing served both rows
    g.deps.now = () => new Date(NOW.getTime() + 90_000); // past the bucket window
    await collectResolvedTask("k3", paths, g.deps); expect(g.calls.fetch).toHaveLength(2); // expiry refetches, still free
  });
});
describe("fail-closed persistence - never report success, never re-buy, on an unsaved row", () => {
  it("a failed pre-call receipt makes ZERO network calls in BOTH modes, through the real zero-row write seam", async () => {
    for (const call of [taskCall(), resolved()]) {
      const { deps, calls } = makeDeps();
      delete deps.cacheWrite; // fall through to the production seam, whose UPDATE matches no row
      const res = await runResolvedCall(call, deps);
      expect([res.state === "error" && res.disposition, calls.fetch.length, calls.adjust]).toEqual(["none", 0, [-0.01]]); // never called, never charged, reservation handed back
    }
  });
  it("a paid LIVE answer that will not save is retried free, then quarantined: never released, never re-fetched", async () => {
    const g = makeDeps();
    let tries = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (p.status === "ready") { tries++; throw new Error("db down"); } };
    const res = await runResolvedCall(resolved(), g.deps);
    expect([res.state === "error" && res.disposition, tries, g.calls.fetch.length]).toEqual(["quarantined", 3, 1]); // three FREE write tries, one paid fetch
    expect([g.calls.reserve, released(g.calls.writes), quarantined(g.calls.writes)]).toEqual([[0.01], false, true]); // releasing is what would buy it twice
  });
  it("a ready write that fails once then succeeds is a plain ok with exactly one paid fetch", async () => {
    const g = makeDeps();
    let n = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (p.status === "ready" && n++ === 0) throw new Error("blip"); };
    expect([(await runResolvedCall(resolved(), g.deps)).state, g.calls.fetch.length]).toEqual(["ok", 1]);
  });
  it("a records read that throws never becomes a cache miss: collect errors and calls nothing", async () => {
    const { deps, calls } = makeDeps({ cacheRead: async () => { throw new Error("db down"); } });
    const res = await collectResolvedTask("k", PATHS, deps);
    expect([res.state === "error" && res.disposition, calls.fetch.length]).toEqual(["none", 0]);
    expect(res.state === "error" && res.detail).toContain("could not read my own records");
  });
  it("a collected result that will not save is retried free and stays free to collect again", async () => {
    const g = makeDeps({ cacheRead: row() });
    let tries = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (p.status === "ready") { tries++; throw new Error("db down"); } };
    g.deps.fetchImpl = fetcher(g.calls, () => liveOk(0));
    const res = await collectResolvedTask("k", PATHS, g.deps);
    expect([res.state === "error" && res.disposition, tries, cleared(g.calls.writes)]).toEqual(["none", 3, false]); // the id stays, so re-collecting costs nothing
  });
});
