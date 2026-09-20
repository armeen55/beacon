/** Slice 6/6C/6D/6E/6F canonical evidence cache + atomic money path + task lifecycle. Every seam injected: no network, no Supabase, no spend. Proves reserve -> network -> reconcile, single-flight, tenant-independent identity, the envelope rule, free resumption, the STRUCTURED dispositions, the PAID-RESPONSE status policy (a reported zero cost never authorizes a silent paid retry), the DURABLE blocked hold beside the INDEFINITE uncertain quarantine, the one-GET listing memo, fail-closed reads and writes. No paid call is ever repeated. */
import { describe, it, expect, vi } from "vitest";
import { runResolvedCall, collectResolvedTask, identityCacheKey, type CachedCallDeps, type ResolvedCall } from "@/domains/evidence/dataforseo/cached-call";
/** Every UPDATE matches ZERO rows here, so the production write seam must throw. */
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ from: () => ({ update: () => ({ eq: () => ({ select: async () => ({ data: [], error: null }) }) }) }) }) }));
const ENV = { DATAFORSEO_AUTH_B64: "abc" } as unknown as NodeJS.ProcessEnv;
const NOW = new Date("2026-07-25T12:00:00.000Z"); const FUTURE = new Date(NOW.getTime() + 86_400_000).toISOString(); const SERP = "serp/google/organic";
const PATHS = { getPath: (_e: string, id: string) => `${SERP}/task_get/advanced/${id}`, tasksReadyPath: () => `${SERP}/tasks_ready`, ttlMsFor: () => 86_400_000 };
function resolved(over: Partial<ResolvedCall> = {}): ResolvedCall {
  const base: ResolvedCall = { cacheKey: "", endpoint: `${SERP}/live/advanced`, endpointVersion: "v3", postPath: `${SERP}/live/advanced`, getPath: null, tasksReadyPath: null, device: null,
    publicInput: { keyword: "koobideh", depth: 10 }, locationCode: 2840, languageCode: "en", modelRequested: null, payload: [{ keyword: "koobideh" }], ttlMs: 60_000, estCostUsd: 0.01, mode: "live", tenantId: "tenant-a", purpose: "bulk", ...over };
  base.cacheKey = base.cacheKey || identityCacheKey(base); return base;}
const taskCall = () => resolved({ endpoint: `${SERP}/task_post`, postPath: `${SERP}/task_post`, getPath: (id) => `${SERP}/task_get/advanced/${id}`, tasksReadyPath: `${SERP}/tasks_ready`, mode: "task" });
const claim = (outcome: "ready" | "pending" | "claimed", over: Record<string, unknown> = {}) => async () => ({ outcome, payload: null, providerTaskId: null, modelServed: null, readyAt: null, costUsd: 0, ...over });
const liveOk = (cost: number, result: unknown = [{ rank: 1 }]) => ({ status_code: 20000, cost, tasks: [{ status_code: 20000, id: "t1", result }] });
const inBody = (code: number, cost?: number) => ({ status_code: 20000, cost, tasks: [{ status_code: code, id: "task-9", result: null }] });
const listing = (entries: unknown[]) => ({ status_code: 20000, tasks: [{ status_code: 20000, result: entries }] });
const row = (over: Record<string, unknown> = {}) => async () => ({ cache_key: "k", endpoint: `${SERP}/task_post`, status: "pending" as const, provider_task_id: "task-9", payload: null, model_served: null, cost_usd: 0.006, expires_at: FUTURE, posted_at: NOW.toISOString(), quarantined_at: null, ...over });
const blockedRow = (code = 50100) => row({ provider_task_id: null, quarantined_at: NOW.toISOString(), error_detail: `blocked:code ${code}` });
const uncertainRow = () => row({ provider_task_id: null, quarantined_at: NOW.toISOString(), error_detail: "uncertain:unconfirmed provider call" });
const httpFail = (status: number) => vi.fn(async () => new Response("no", { status })) as unknown as typeof fetch;
const throwing = () => vi.fn(async () => { throw new Error("timeout"); }) as unknown as typeof fetch; // UNCERTAIN: the provider may have taken and charged it
const fetcher = (calls: { fetch: string[] }, pick: (u: string) => unknown) => vi.fn(async (u: string) => { calls.fetch.push(u); return new Response(JSON.stringify(pick(u)), { status: 200 }); }) as unknown as typeof fetch;
const postAccepted = (calls: { fetch: string[] }) => fetcher(calls, () => ({ status_code: 20000, tasks: [{ status_code: 20100, id: "task-123", cost: 0.006 }] }));
const cleared = (writes: Record<string, unknown>[]) => writes.some((w) => w.provider_task_id === null && w.status === "error");
const quarantined = (writes: Record<string, unknown>[]) => writes.some((w) => typeof w.quarantined_at === "string");
const blockedHold = (writes: Record<string, unknown>[]) => writes.some((w) => typeof w.quarantined_at === "string" && String(w.error_detail ?? "").startsWith("blocked:"));
const released = (writes: Record<string, unknown>[]) => writes.some((w) => w.status === "error" && w.fetch_claimed_until === null);
function makeDeps(over: Partial<CachedCallDeps> = {}, reserveMode: "allow" | "refuse" | "throw" = "allow") {
  const calls = { fetch: [] as string[], reserve: [] as number[], adjust: [] as number[], life: [] as unknown[][], writes: [] as Record<string, unknown>[] };
  const deps: Partial<CachedCallDeps> = { env: ENV, now: () => NOW, fetchImpl: fetcher(calls, () => liveOk(0.0021)), claimEvidenceFetch: claim("claimed"),
    spend: { reserve: async (i) => { if (reserveMode === "throw") throw new Error("db down"); calls.reserve.push(i.estimatedUsd); calls.life.push(["reserve", i.logicalKey]); return reserveMode === "refuse" ? { outcome: "refused_daily", attemptId: null, attemptOrdinal: null, state: null, reportingDay: "2026-07-25", estimatedUsd: i.estimatedUsd, actualUsd: null, providerTaskId: null } : { outcome: "reserved", attemptId: "a1", attemptOrdinal: 1, state: "reserved", reportingDay: "2026-07-25", estimatedUsd: i.estimatedUsd, actualUsd: null, providerTaskId: null }; },
      read: async () => null,
      claimTransmission: async () => (calls.life.push(["claim"]), "claimed"), markAmbiguous: async (_id, task) => (calls.life.push(["ambiguous", task]), true),
      release: async (_id, zero) => (calls.adjust.push(-0.01), calls.life.push(["release", zero]), true), reconcile: async (_id, actual, task) => (calls.adjust.push(actual - 0.01), calls.life.push(["reconcile", actual, task]), true) },
    cacheRead: async () => null, cacheWrite: async (_k, patch) => { calls.writes.push(patch); }, authorizeRepost: async () => (calls.writes.push({ status: "error", provider_task_id: null }), true), breaker: async () => ({ tripped: false }), ...over };
  return { deps: deps as unknown as Record<string, unknown>, calls };}
/** A quarantined row on a LATER visit: the claim can only answer pending and no branch may POST. `ready` = what the one free tasks_ready GET returns. */
async function secondVisit(ready: unknown, at: Date = NOW) {
  const g = makeDeps({ now: () => at, claimEvidenceFetch: claim("pending"), cacheRead: uncertainRow() });
  g.deps.fetchImpl = fetcher(g.calls, (u) => (u.includes("tasks_ready") ? ready : liveOk(0)));
  return { res: await runResolvedCall(taskCall(), g.deps), calls: g.calls };}
describe("runResolvedCall - the atomic money path, and the paid-response policy (the STATUS decides, never the reported cost alone)", () => {
  it("a miss takes a pre-call receipt, one network call, one reservation, one reconcile, and caches the FULL envelope", async () => {
    const { deps, calls } = makeDeps(); const res = await runResolvedCall(resolved(), deps);
    expect([res.state, res.state === "ok" && res.costUsd, calls.fetch.length, calls.reserve, calls.adjust]).toEqual(["ok", 0.0021, 1, [0.01], [0.0021 - 0.01]]); // reserve first, reconcile est -> actual
    expect(calls.life).toEqual([["reserve", expect.stringMatching(/^dataforseo:dfs2_/)], ["claim"], ["reconcile", 0.0021, null]]);
    expect([res.state === "ok" && res.envelope.status_code, res.state === "ok" && res.envelope.tasks?.[0]?.result]).toEqual([20000, [{ rank: 1 }]]); // ENVELOPE RULE: top kept, parsers still see inside
    const ready = calls.writes.find((w) => w.status === "ready")!;
    expect([typeof calls.writes[0].posted_attempt_at, (ready.payload as { status_code?: number }).status_code, ready.posted_attempt_at]).toEqual(["string", 20000, null]); // receipt BEFORE the network, cleared by the finished call
  });
  it("uses the larger single-task charge when top-level and task receipts disagree", async () => {
    const g = makeDeps({ fetchImpl: fetcher({ fetch: [] }, () => ({ status_code: 20000, cost: 0,
      tasks: [{ status_code: 20000, id: "t1", cost: 0.004, result: [{ rank: 1 }] }] })) });
    const out = await runResolvedCall(resolved(), g.deps);
    expect([out.state, out.state === "ok" && out.costUsd, g.calls.life.at(-1)])
      .toEqual(["ok", 0.004, ["reconcile", 0.004, null]]);
  });
  it("an identical repeat is a zero-network, zero-cost hit", async () => {
    const { deps, calls } = makeDeps({ claimEvidenceFetch: claim("ready", { payload: [{ rank: 1 }] }) });
    expect([(await runResolvedCall(resolved(), deps)).state, calls.fetch.length, calls.reserve.length]).toEqual(["hit", 0, 0]); // a hit is typed costUsd: 0
  });
  it("stores the full paid LIVE envelope in the spend receipt before projecting it to cache", async () => {
    const g = makeDeps();
    const reconcile = vi.fn(async () => true);
    (g.deps.spend as CachedCallDeps["spend"]).reconcile = reconcile;
    const out = await runResolvedCall(resolved(), g.deps);
    expect(out.state).toBe("ok");
    expect(reconcile).toHaveBeenCalledWith("a1", 0.0021, null, "provider_reported", liveOk(0.0021));
  });
  it("rebuilds a LIVE cache row from a replayed paid envelope without another provider call", async () => {
    const body = liveOk(0.0021, [{ rank: 3 }]);
    const g = makeDeps();
    (g.deps.spend as CachedCallDeps["spend"]).reserve = async () => ({ outcome: "replayed", attemptId: "a1",
      attemptOrdinal: 1, state: "reconciled", reportingDay: "2026-07-25", estimatedUsd: 0.01,
      accountedUsd: 0.0021, providerTaskId: null, accountingBasis: "provider_reported", resultPayload: body });
    const out = await runResolvedCall(resolved(), g.deps);
    expect([out.state, out.state === "hit" && out.costUsd, g.calls.fetch.length, g.calls.writes.some((w) => w.status === "ready")]).toEqual(["hit", 0, 0, true]);
    expect(out.state === "hit" && out.envelope.tasks?.[0]?.result).toEqual([{ rank: 3 }]);
  });
  it("repairs a quarantined LIVE cache projection from its reconciled spend receipt at zero cost", async () => {
    const body = liveOk(0.0021, [{ rank: 4 }]);
    const g = makeDeps({ claimEvidenceFetch: claim("pending"), cacheRead: row({ endpoint: `${SERP}/live/advanced`,
      provider_task_id: null, spend_attempt_id: "a1", quarantined_at: NOW.toISOString(), error_detail: "uncertain:cache write failed" }) });
    (g.deps.spend as CachedCallDeps["spend"]).read = async () => ({ state: "reconciled", providerTaskId: null,
      accountedUsd: 0.0021, accountingBasis: "provider_reported", resultPayload: body });
    const out = await runResolvedCall(resolved(), g.deps);
    expect([out.state, out.state === "hit" && out.costUsd, g.calls.fetch.length, g.calls.reserve.length]).toEqual(["hit", 0, 0, 0]);
    expect(out.state === "hit" && out.envelope.tasks?.[0]?.result).toEqual([{ rank: 4 }]);
  });
  it("concurrent identical misses (second claim is pending) pay at most once", async () => {
    let n = 0; const { deps, calls } = makeDeps({ claimEvidenceFetch: async () => claim(n++ === 0 ? "claimed" : "pending")() }); const [r1, r2] = await Promise.all([runResolvedCall(resolved(), deps), runResolvedCall(resolved(), deps)]);
    const pending = [r1, r2].find((r) => r.state === "waiting");
    expect([[r1.state, r2.state].sort(), calls.fetch.length, pending?.state === "waiting" && pending.costUsd]).toEqual([["ok", "waiting"], 1, 0]); // a bare pending claim charges nothing
  });
  it("no un-paid path (cap / reserve-throw / breaker / not_configured) ever touches the network", async () => {
    const spy = vi.fn(), states = []; const cap = makeDeps({}, "refuse"), rerr = makeDeps({}, "throw");
    const brk = makeDeps({ breaker: async () => ({ tripped: true, reason: "ceiling reached" }) }), nc = makeDeps({ env: {} as NodeJS.ProcessEnv, claimEvidenceFetch: spy as never });
    for (const g of [cap, rerr, brk, nc]) { states.push((await runResolvedCall(resolved(), g.deps)).state); expect(g.calls.fetch).toHaveLength(0); }
    expect(states).toEqual(["capped", "error", "capped", "not_configured"]);
    for (const g of [brk, nc]) expect(g.calls.reserve).toHaveLength(0); // breaker/not-configured never reserve
    expect(spy).not.toHaveBeenCalled(); // not_configured never even claims
  });
  it("cache identity has NO tenant input and splits on location / model", async () => {
    const a = identityCacheKey(resolved()), others = [identityCacheKey(resolved({ locationCode: 2826 })), identityCacheKey(resolved({ modelRequested: "gpt-4o" }))];
    expect([identityCacheKey(resolved({ tenantId: "tenant-b" })), others.includes(a)]).toEqual([a, false]); // tenant never enters identity; location and model always split it
  });
  it("a REPORTED zero cost is refunded and BLOCKED durably unless the exact code is a documented temporary failure; an unknown cost quarantines", async () => { // 50100 terminal, 50401/50402 live timeouts (any retry is a NEW paid call), 61234 undocumented, 40401 collection-only (a fresh POST proves nothing) -> blocked. 50301/50000 -> the ONE retry path.
    const cases: [number, number | undefined, "blocked" | "none" | "quarantined"][] = [
      [50100, 0, "blocked"], [50401, 0, "blocked"], [50402, 0, "blocked"], [61234, 0, "blocked"], [40401, 0, "blocked"],
      [50301, 0, "none"], [50000, 0, "none"], [50100, undefined, "quarantined"], [50301, undefined, "quarantined"]]; // no cost field = it may have been charged
    for (const [code, cost, want] of cases) for (const call of [resolved(), taskCall()]) {
      const g = makeDeps(); g.deps.fetchImpl = fetcher(g.calls, () => inBody(code, cost)); const res = await runResolvedCall(call, g.deps);
      expect([res.state === "error" && res.disposition, g.calls.adjust, g.calls.fetch.length]).toEqual([want, want === "quarantined" ? [] : [-0.01], 1]); // refunded unless it may have been charged
      expect([blockedHold(g.calls.writes), released(g.calls.writes), cleared(g.calls.writes), quarantined(g.calls.writes)]).toEqual([want === "blocked", want === "none", false, want !== "none"]); // never repost_once, never a dead-identity clear
      if (want === "none") expect(g.calls.writes.some((w) => w.status === "error" && w.posted_attempt_at === null)).toBe(true); // the release also clears the anti-repost receipt
      if (want !== "quarantined") expect(res.state === "error" && res.detail).toContain(String(code));
    } });
  it("a raw HTTP failure never proves zero cost, so 401/402/404/5xx all keep the atomic hold", async () => {
    for (const status of [401, 404, 500]) { const g = makeDeps({ fetchImpl: httpFail(status) }), res = await runResolvedCall(resolved(), g.deps);
      expect([res.state === "error" && res.disposition, g.calls.adjust, quarantined(g.calls.writes), released(g.calls.writes)]).toEqual(["quarantined", [], true, false]); }
    const empty = makeDeps({ fetchImpl: httpFail(402) }), paid = await runResolvedCall(resolved(), empty.deps);
    expect([paid.state === "error" && paid.disposition, empty.calls.adjust, quarantined(empty.calls.writes), paid.state === "error" && paid.detail.includes("could not be confirmed")]).toEqual(["quarantined", [], true, true]);
    const proved = makeDeps({ fetchImpl: (async () => new Response(JSON.stringify({ cost: 0, tasks: [{ status_code: 40210 }] }), { status: 402 })) as typeof fetch }), stopped = await runResolvedCall(resolved(), proved.deps);
    expect([stopped.state, proved.calls.adjust, released(proved.calls.writes)]).toEqual(["capped", [-0.01], true]); // only the provider's own zero-cost envelope releases the atomic hold
  });
  it("a BLOCKED row answers blocked on every later visit: zero fetches, zero reservations, no listing, never quarantined", async () => {
    for (const call of [resolved(), taskCall()]) {
      const g = makeDeps({ claimEvidenceFetch: claim("pending"), cacheRead: blockedRow(), now: () => new Date(NOW.getTime() + 30 * 86_400_000) }); const res = await runResolvedCall(call, g.deps);
      expect([res.state === "error" && res.disposition, g.calls.fetch, g.calls.reserve, g.calls.writes, res.state === "error" && res.detail.includes("50100")]).toEqual(["blocked", [], [], [], true]); // refunded already: nothing to collect, nothing to buy
    } });});
describe("Standard tasks - free resumption and the STRUCTURED dispositions", () => {
  it("posts once, persists the task id, and returns durable waiting with the provider cost exactly once", async () => {
    const { deps, calls } = makeDeps(); deps.fetchImpl = postAccepted(calls); const res = await runResolvedCall(taskCall(), deps);
    expect([res.state, res.state === "waiting" && res.providerTaskId, res.state === "waiting" && res.costUsd, calls.fetch.length, calls.writes.some((w) => w.provider_task_id === "task-123" && typeof w.next_poll_at === "string")]).toEqual(["waiting", "task-123", 0.006, 1, true]); // the actual cost, once, with the id and first poll time persisted
  });
  it("does not poll before next_poll_at and exponentially advances the durable clock after a wait", async () => {
    const early = makeDeps({ cacheRead: row({ posted_at: null, next_poll_at: new Date(NOW.getTime() + 60_000).toISOString(), poll_attempts: 2 }) });
    expect((await collectResolvedTask("k", PATHS, early.deps)).state).toBe("waiting"); expect([early.calls.fetch.length, typeof early.calls.writes[0]?.posted_at]).toEqual([0, "string"]);
    const due = makeDeps({ cacheRead: row({ next_poll_at: NOW.toISOString(), poll_attempts: 2 }) }); due.deps.fetchImpl = fetcher(due.calls, () => inBody(40601));
    expect((await collectResolvedTask("k", PATHS, due.deps)).state).toBe("waiting"); const wake = due.calls.writes.find((w) => w.poll_attempts === 3)!;
    expect([due.calls.fetch.length, wake.poll_attempts, Date.parse(String(wake.next_poll_at)) > NOW.getTime()]).toEqual([1, 3, true]);
  });
  it("records a Standard POST charge as an advance, not the final task price", async () => {
    const g = makeDeps(); g.deps.fetchImpl = postAccepted(g.calls); const reconcile = vi.fn(async () => true);
    (g.deps.spend as CachedCallDeps["spend"]).reconcile = reconcile;
    expect((await runResolvedCall(taskCall(), g.deps)).state).toBe("waiting");
    expect(reconcile).toHaveBeenCalledWith("a1", 0.006, "task-123", "provider_advance");
  });
  it.each([0.003, 0.02])("adjusts a Standard advance to the final task receipt, including refund/overage %s", async (finalCost) => {
    const body = liveOk(finalCost), g = makeDeps({ cacheRead: row({ spend_attempt_id: "a1", cost_usd: 0.006, posted_at: new Date(NOW.getTime() - 72 * 3_600_000).toISOString(), next_poll_at: FUTURE }) });
    (g.deps.spend as CachedCallDeps["spend"]).read = async () => ({ state: "reconciled", providerTaskId: "task-9", accountedUsd: 0.006, accountingBasis: "provider_advance" });
    const reconcile = vi.fn(async () => true); (g.deps.spend as CachedCallDeps["spend"]).reconcile = reconcile;
    g.deps.fetchImpl = fetcher(g.calls, () => body);
    expect((await collectResolvedTask("k", PATHS, g.deps)).state).toBe("ok");
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledWith("a1", finalCost, "task-9", "provider_reported", body);
  });
  it("rebuilds a Standard cache row from the reconciled full envelope before another GET", async () => {
    const body = liveOk(0.007, [{ rank: 7 }]), g = makeDeps({ cacheRead: row({ spend_attempt_id: "a1", quarantined_at: NOW.toISOString() }) });
    (g.deps.spend as CachedCallDeps["spend"]).read = async () => ({ state: "reconciled", providerTaskId: "task-9",
      accountedUsd: 0.007, accountingBasis: "provider_reported", resultPayload: body });
    const out = await collectResolvedTask("k", PATHS, g.deps);
    expect([out.state, out.state === "hit" && out.costUsd, g.calls.fetch.length, g.calls.writes.some((w) => w.status === "ready")]).toEqual(["hit", 0, 0, true]);
    expect(out.state === "hit" && out.envelope.tasks?.[0]?.result).toEqual([{ rank: 7 }]);
  });
  it("holds an accepted task whose exact cost is absent, with its id attached and no replay", async () => { const g = makeDeps({ fetchImpl: fetcher({ fetch: [] }, () => ({ status_code: 20000, tasks: [{ status_code: 20100, id: "task-unknown" }] })) }); const res = await runResolvedCall(taskCall(), g.deps); expect([res.state === "error" && res.disposition, g.calls.adjust, g.calls.life.at(-1), quarantined(g.calls.writes)]).toEqual(["quarantined", [], ["ambiguous", "task-unknown"], true]); });
  it("after process death, a pending claim GETs the task free (adds 0) and never reposts", async () => {
    const { deps, calls } = makeDeps({ claimEvidenceFetch: claim("pending", { providerTaskId: "task-123" }), cacheRead: row({ provider_task_id: "task-123" }) });
    deps.fetchImpl = fetcher(calls, () => liveOk(0)); const res = await runResolvedCall(taskCall(), deps);
    expect([res.state, res.state === "ok" && res.costUsd, calls.reserve.length]).toEqual(["ok", 0, 0]); // no reservation on a free resume
    expect(calls.fetch).toEqual([expect.stringContaining("/task_get/advanced/task-123")]); // FRESHNESS truth: a collected row expires on the REGISTRY ttl (60s fixture), never the 30-day task retention, so a due re-observation re-buys.
    expect(Date.parse(calls.writes.find((w) => w.status === "ready")!.expires_at as string) - NOW.getTime()).toBe(60_000); });
  it("recovers an accepted task id and exact cost from its spend receipt when the cache acknowledgement was lost", async () => { const g = makeDeps({ cacheRead: row({ provider_task_id: null, spend_attempt_id: "a1", quarantined_at: NOW.toISOString() }) }); (g.deps.spend as CachedCallDeps["spend"]).read = async () => ({ state: "ambiguous", providerTaskId: "task-123", actualUsd: null }); g.deps.fetchImpl = fetcher(g.calls, () => liveOk(0.006)); const res = await collectResolvedTask("k", PATHS, g.deps); expect([res.state, g.calls.fetch, g.calls.life.at(-1)]).toEqual(["ok", [expect.stringContaining("task_get/advanced/task-123")], ["reconcile", 0.006, "task-123"]]); });
  it("never marks collected evidence Ready until its exact spend receipt files", async () => { const g = makeDeps({ cacheRead: row({ spend_attempt_id: "a1" }) });
    (g.deps.spend as CachedCallDeps["spend"]).reconcile = async () => false; g.deps.fetchImpl = fetcher(g.calls, () => liveOk(0.006));
    const res = await collectResolvedTask("k", PATHS, g.deps); expect([res.state, res.state === "waiting" && res.detail.includes("spend receipt"), g.calls.writes.some((w) => w.status === "ready")]).toEqual(["waiting", true, false]); });
  it("maps every in-body task code onto the frozen disposition and clears ONLY a proven dead identity", async () => {
    const cases: [number, string, boolean][] = [
      [40601, "waiting", false], [40602, "waiting", false], [50000, "retry_free", false], [50301, "retry_free", false], // genuine queue: free GET, zero reposts. transient: the SAME id is kept
      [40100, "blocked", false], [40200, "waiting", false], [40203, "daily_limit", false], [40401, "repost_once", true], [40403, "repost_once", true]]; // an OLD task's payment state is not current account health; proven gone: clear, then ONE clean repost
    for (const [code, want, clears] of cases) {
      const { deps, calls } = makeDeps({ cacheRead: row() }); deps.fetchImpl = fetcher(calls, () => code === 40200 ? { status_code: code, tasks: [{ status_code: 20000 }] } : inBody(code)); const res = await collectResolvedTask("k", PATHS, deps);
      expect(res.state === "error" ? res.disposition : res.state).toBe(want);
      if (res.state === "error" && want !== "daily_limit") expect(res.detail).toContain(String(code)); if (code === 40200) expect([res.state, res.state === "waiting" && res.providerTaskId, res.state === "waiting" && res.costUsd]).toEqual(["waiting", "task-9", 0]);
      expect([cleared(calls.writes), calls.fetch.every((u) => u.includes("task_get"))]).toEqual([clears, true]); // never a repost
    } });
  it("never reposts a merely old task: only an exact missing result may replace a paid identity", async () => { let grants = 0; const stale = { posted_at: new Date(NOW.getTime() - 72 * 3_600_000).toISOString(), next_poll_at: FUTURE }; const g = makeDeps({ cacheRead: row(stale), authorizeRepost: async () => (++grants, true) }); g.deps.fetchImpl = fetcher(g.calls, () => inBody(40601)); const first = await collectResolvedTask("k", PATHS, g.deps); expect([first.state === "error" && first.disposition, grants, g.calls.fetch.length, quarantined(g.calls.writes)]).toEqual(["quarantined", 0, 1, true]); });
  it("on the FREE GET account/identity failures block without clearing or reposting; a transport blip keeps the task", async () => {
    for (const code of [401, 402, 403, 404]) { const dead = makeDeps({ cacheRead: row({ posted_at: NOW.toISOString() }), fetchImpl: httpFail(code) }); const d1 = await collectResolvedTask("k", PATHS, dead.deps);
      expect([d1.state === "error" && d1.disposition, cleared(dead.calls.writes), d1.state === "error" && (code === 402 ? d1.detail.includes("unknown") : d1.detail.includes(String(code)))]).toEqual(["blocked", false, true]); }
    const blip = makeDeps({ cacheRead: row({ posted_at: NOW.toISOString() }), fetchImpl: httpFail(503) }); const b1 = await collectResolvedTask("k", PATHS, blip.deps);
    expect([b1.state, b1.state === "waiting" && b1.costUsd, b1.state === "waiting" && b1.providerTaskId, cleared(blip.calls.writes), b1.state === "waiting" && b1.detail.includes("503")]).toEqual(["waiting", 0, "task-9", false, true]); });});
describe("quarantine - indefinite, both modes, zero automatic paid retries", () => {
  it("an UNCERTAIN Standard post stays quarantined FOREVER: 30 days on it is still one free listing GET and zero posts", async () => {
    const { deps, calls } = makeDeps({ fetchImpl: throwing() }); const res = await runResolvedCall(taskCall(), deps);
    expect([res.state === "error" && res.disposition, calls.reserve, calls.adjust.length, quarantined(calls.writes), blockedHold(calls.writes)]).toEqual(["quarantined", [0.01], 0, true, false]); // a visible pause, reservation kept: overcount, never undercount
    const next = await secondVisit(listing([]), new Date(NOW.getTime() + 30 * 86_400_000));
    expect([next.res.state === "error" && next.res.disposition, next.calls.reserve.length, cleared(next.calls.writes)]).toEqual(["quarantined", 0, false]); // never repost_once, however long it has been
    expect(next.calls.fetch).toEqual([expect.stringContaining("/tasks_ready")]); // an UNCERTAIN row still gets its ONE free listing, zero posts
  });
  it("an uncertain LIVE call keeps the reservation, quarantines, and the next visit buys nothing", async () => {
    const { deps, calls } = makeDeps({ fetchImpl: throwing() }); const res = await runResolvedCall(resolved(), deps);
    expect([res.state === "error" && res.disposition, res.state === "error" && res.detail.includes("was set aside")]).toEqual(["quarantined", true]); // a live call has no free finished list
    expect([calls.reserve, calls.adjust.length, quarantined(calls.writes), released(calls.writes)]).toEqual([[0.01], 0, true, false]); // never reconciled down: the provider may have charged it
    const g = makeDeps({ claimEvidenceFetch: claim("pending"), cacheRead: uncertainRow() });
    const later = await runResolvedCall(resolved(), g.deps); // a LATER visit reads the quarantined row and says so
    expect([later.state === "error" && later.disposition, g.calls.fetch.length, g.calls.reserve.length]).toEqual(["quarantined", 0, 0]); });
  it("an accepted post whose id could not be saved is quarantined, and later visits never post", async () => {
    const g = makeDeps(); let n = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (++n === 2) throw new Error("db down"); };
    g.deps.fetchImpl = postAccepted(g.calls); const res = await runResolvedCall(taskCall(), g.deps);
    expect([res.state === "error" && res.disposition, g.calls.adjust, quarantined(g.calls.writes)]).toEqual(["quarantined", [0.006 - 0.01], true]); // reconciled to actual; reservation kept
    expect((await secondVisit(listing([]))).calls.fetch.some((u) => u.includes("task_post"))).toBe(false); });
  it("recovers the id for FREE from tasks_ready by our own tag, then collects it", async () => {
    const g = makeDeps({ cacheRead: uncertainRow() });
    g.deps.fetchImpl = fetcher(g.calls, (u) => (u.includes("tasks_ready") ? listing([{ id: "someone-else", tag: "other-key" }, { id: "task-77", tag: "k" }]) : liveOk(0)));
    const paths = { ...PATHS, tasksReadyPath: () => "ai_optimization/claude/llm_responses/tasks_ready" }; // a family no other test's bucket touches
    const res = await collectResolvedTask("k", paths, g.deps); expect([res.state, res.state === "ok" && res.costUsd]).toEqual(["ok", 0]);
    expect(g.calls.writes.some((w) => w.provider_task_id === "task-77" && w.quarantined_at === null)).toBe(true);
    expect(g.calls.fetch).toEqual([expect.stringContaining("/llm_responses/tasks_ready"), expect.stringContaining("/task_get/advanced/task-77")]); // free listing, free collect, never a post
  });
  it("keeps a ready Standard result held when the provider omits its exact charge", async () => {
    const g = makeDeps({ cacheRead: row({ spend_attempt_id: "a1" }) });
    (g.deps.spend as CachedCallDeps["spend"]).read = async () => ({ state: "ambiguous", providerTaskId: "task-9", estimatedUsd: 0.01 });
    g.deps.fetchImpl = fetcher(g.calls, () => ({ status_code: 20000, tasks: [{ status_code: 20000, id: "task-9", result: [{ rank: 1 }] }] }));
    const out = await collectResolvedTask("k", PATHS, g.deps);
    expect([out.state, g.calls.life.at(-1), g.calls.writes.some((w) => w.status === "ready")])
      .toEqual(["waiting", undefined, false]);
  });
  it("several quarantined rows in one family cost ONE free listing GET per bucket window, then a fresh free GET", async () => {
    const g = makeDeps({ cacheRead: uncertainRow() });
    g.deps.fetchImpl = fetcher(g.calls, () => listing([])); const paths = { ...PATHS, tasksReadyPath: () => "serp/google/ai_mode/tasks_ready" }; // family untouched by other tests
    await collectResolvedTask("k1", paths, g.deps);
    g.deps.now = () => new Date(NOW.getTime() + 30_000); // still inside the 60s bucket
    await collectResolvedTask("k2", paths, g.deps);
    expect(g.calls.fetch).toHaveLength(1); // one FREE listing served both rows
    g.deps.now = () => new Date(NOW.getTime() + 90_000); // past the bucket window
    await collectResolvedTask("k3", paths, g.deps); expect(g.calls.fetch).toHaveLength(2); // expiry refetches, still free
  });});
describe("fail-closed persistence - never report success, never re-buy, on an unsaved row", () => {
  it("a failed pre-call receipt makes ZERO network calls in BOTH modes, through the real zero-row write seam", async () => {
    for (const call of [taskCall(), resolved()]) {
      const { deps, calls } = makeDeps(); delete deps.cacheWrite; const res = await runResolvedCall(call, deps); // the production seam, whose UPDATE matches no row
      expect([res.state === "error" && res.disposition, calls.fetch.length, calls.adjust]).toEqual(["none", 0, [-0.01]]); // never called, never charged, reservation handed back
    } });
  it("a paid LIVE answer that will not save is retried free, then quarantined: never released, never re-fetched", async () => {
    const g = makeDeps(); let tries = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (p.status === "ready") { tries++; throw new Error("db down"); } };
    const res = await runResolvedCall(resolved(), g.deps); expect([res.state === "error" && res.disposition, tries, g.calls.fetch.length, g.calls.reserve, released(g.calls.writes)]).toEqual(["quarantined", 3, 1, [0.01], false]); // three FREE write tries, one paid fetch; releasing is what would buy it twice
  });
  it("a ready write that fails once then succeeds is a plain ok with exactly one paid fetch", async () => {
    const g = makeDeps(); let n = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (p.status === "ready" && n++ === 0) throw new Error("blip"); };
    expect([(await runResolvedCall(resolved(), g.deps)).state, g.calls.fetch.length]).toEqual(["ok", 1]); });
  it("a records read that throws never becomes a cache miss: collect errors and calls nothing", async () => {
    const { deps, calls } = makeDeps({ cacheRead: async () => { throw new Error("db down"); } }); const res = await collectResolvedTask("k", PATHS, deps);
    expect([res.state === "error" && res.disposition, calls.fetch.length, res.state === "error" && res.detail.includes("records could not be read")]).toEqual(["none", 0, true]); });
  it("a collected result that will not save is retried free and stays free to collect again", async () => {
    const g = makeDeps({ cacheRead: row() }); let tries = 0;
    g.deps.cacheWrite = async (_k: string, p: Record<string, unknown>) => { g.calls.writes.push(p); if (p.status === "ready") { tries++; throw new Error("db down"); } };
    g.deps.fetchImpl = fetcher(g.calls, () => liveOk(0)); const res = await collectResolvedTask("k", PATHS, g.deps);
    expect([res.state === "error" && res.disposition, tries, cleared(g.calls.writes)]).toEqual(["none", 3, false]); // the id stays, so re-collecting costs nothing
  });});
