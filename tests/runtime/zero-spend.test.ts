import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import { PROOF_SPEND, runWithoutSpending, spendingClosed } from "@/lib/spend-scope";
const fetchSpy = vi.spyOn(globalThis, "fetch");
const MODEL_ASK = { promptId: "page-job-read", promptVersion: 1, action: "test", apiKey: "sk-not-used",
  model: "gpt-5-mini", instructions: "x", input: "y", schemaName: "s", zodSchema: z.object({ a: z.string() }),
  maxOutputTokens: 16, tenantId: "tenant-fx" } as never;
afterEach(() => { fetchSpy.mockClear(); });
describe("inside a no-spend scope nothing is bought, and nothing pretends it failed", () => {
  it("closes the model door before a client, a schema or a budget is touched", async () => {
    const { openAIStructuredResponse } = await import("@/domains/decision/llm/gateway");
    const args = MODEL_ASK as unknown as Parameters<typeof openAIStructuredResponse>[0];
    const outcome = await runWithoutSpending(() => openAIStructuredResponse(args));
    expect(outcome.kind).toBe("blocked_budget"); // the state every caller already reads as "did not buy"
    expect(fetchSpy).not.toHaveBeenCalled(); // and it never reached the network to find that out
    if (outcome.kind === "blocked_budget") expect(outcome.reason).toContain("paused");});
  it("closes the provider door the same way, leaving the work owed rather than failed", async () => {
    const { providerCall } = await import("@/domains/evidence/dataforseo/capabilities");
    const result = await runWithoutSpending(() => providerCall(
      "serp_organic" as never, { keyword: "haft seen set" } as never, { tenantId: "tenant-fx", unitKey: "u1" }));
    expect(result.state).toBe("capped"); // owed, not failed: a paused day is not an outage
    expect(fetchSpy).not.toHaveBeenCalled();});
  it("is ambient, so a path nobody remembered to thread the flag through still refuses", async () => {
    const deepInside = async () => ({ refused: await spendingClosed("tenant-fx") }); expect(await runWithoutSpending(() => deepInside())).toEqual({ refused: true });
    expect(await deepInside()).toEqual({ refused: false });
  });
  it("does not leak across a paid pass that runs after it", async () => {
    await runWithoutSpending(async () => { expect(await spendingClosed("tenant-fx")).toBe(true); }); expect(await spendingClosed("tenant-fx")).toBe(false);});
  it("opens only the named tenant's model allowance and never its external-evidence door", async () => {
    await PROOF_SPEND.run("tenant-fx", 1, 0.05, async () => {
      expect([PROOF_SPEND.activeFor("tenant-fx"), PROOF_SPEND.activeFor("other"), PROOF_SPEND.authorize("tenant-fx", "external"), PROOF_SPEND.authorize("tenant-fx", "model", 0.02), PROOF_SPEND.authorize("tenant-fx", "model", 0.02)]).toEqual([true, false, true, false, true]);
      expect(await runWithoutSpending(async () => PROOF_SPEND.activeFor("tenant-fx"))).toBe(false);
    }); expect(PROOF_SPEND.activeFor("tenant-fx")).toBeNull();});});
describe("a paused account rebuilds its surface and buys nothing, whatever the caller asked for", () => {
  const storeMock = (claim: boolean, held: unknown[] = []) => ({
    readStore: async () => held, writeStore: async () => undefined,
    claimScope: async (name: string) => { calls.claims.push(name); return claim ? "hold-1" : null; },
    releaseScope: async (name: string, _key: string, owner: string) => { calls.releases.push(`${name}:${owner}`); },});
  const calls = { claims: [] as string[], releases: [] as string[] };
  it("never enters the broad producer while paused or rebuilding stored rows only", async () => {
    vi.resetModules(); calls.claims.length = 0; calls.releases.length = 0;
    let produced = 0, permission: "paused" | "running" = "paused"; const doors: string[] = [];
    vi.doMock("@/lib/persistence/json-store", () => storeMock(true));
    vi.doMock("@/lib/tenant-context", async (real) => ({ ...(await real() as object), slugForTenantId: async (id: string) => id }));
    vi.doMock("@/domains/runtime", () => ({ researchPermission: async () => permission }));
    vi.doMock("@/domains/decision", () => ({
      produceProposalsForTenant: async () => { produced += 1; throw new Error("broad producer reached"); },
      reconcileImplementedWithoutShipment: async () => undefined, publishCustomerRelease: async (x: { release: string }) => x.release,}));
    vi.doMock("@/domains/measurement", () => ({ loadShippedChangesForTenant: async () => [] }));
    vi.doMock("@/domains/evidence", () => ({ loadGscDecaySignalsForTenant: async () => new Map(), loadGscPageSignalsForTenant: async () => new Map() }));
    vi.doMock("@/app/(shell)/changes-data", () => ({ buildChangesViewUncached: async (_t: string, _r: string) => {
      const { openAIStructuredResponse } = await import("@/domains/decision/llm/gateway"), { providerCall } = await import("@/domains/evidence/dataforseo/capabilities");
      doors.push((await openAIStructuredResponse({ ...(MODEL_ASK as object), tenantId: _t } as never)).kind, (await providerCall("serp_organic" as never, { keyword: "x" } as never, { tenantId: _t, unitKey: "u" })).state);
      return { proposals: [], stampRows: [] }; } }));
    vi.doMock("@/app/(shell)/today-view-data", () => ({ buildTodayCompositeFromChanges: async () => ({ headline: "Stored truth" }) }));
    const { refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
    const paused = await refreshCustomerSurface("tenant-fx", { maxDrafts: 5 }); permission = "running";
    const zero = await refreshCustomerSurface("tenant-other", { maxDrafts: 0 });
    expect([paused.tenantId, zero.tenantId, produced, doors]).toEqual(["tenant-fx", "tenant-other", 0, ["blocked_budget", "capped", "blocked_budget", "capped"]]);
    expect(fetchSpy).not.toHaveBeenCalled(); expect(calls.releases).toContain("surface-claims:hold-1");
    for (const id of ["@/lib/persistence/json-store", "@/lib/tenant-context", "@/domains/runtime", "@/domains/decision", "@/domains/measurement", "@/domains/evidence", "@/app/(shell)/changes-data", "@/app/(shell)/today-view-data"]) vi.doUnmock(id); vi.resetModules();});
  it("hands a second instance the release on file instead of building twice", async () => {
    vi.resetModules(); calls.claims.length = 0; calls.releases.length = 0;
    const held = [{ schemaVersion: 2, tenantId: "tenant-fx", computedAt: "2026-08-20T00:00:00.000Z",
      changes: { proposals: [] }, today: { today: {}, hasChanges: false } }];
    let built = 0;
    vi.doMock("@/lib/persistence/json-store", () => storeMock(false, held));
    vi.doMock("@/domains/runtime", () => ({ researchPermission: async () => "running" as const }));
    vi.doMock("@/domains/decision", () => ({
      produceProposalsForTenant: async () => { built += 1; return { proposals: [], outcome: "no_actionable_candidate", persisted: 0 }; },
      reconcileImplementedWithoutShipment: async () => undefined,}));
    const { refreshCustomerSurface } = await import("@/app/(shell)/surface-release"); const out = await refreshCustomerSurface("tenant-fx");
    expect(built).toBe(0); // the other dispatcher owns the build
    expect(out).toBe(held[0]); // this one serves what is already published
    vi.doUnmock("@/lib/persistence/json-store"); vi.doUnmock("@/domains/runtime"); vi.doUnmock("@/domains/decision"); vi.resetModules();});});
describe("the funded proof can touch exactly one stored candidate", () => {
  const id = "tenant-fx::/one::existing_edit::answer", stale = "it did not pass the re-read of a stored change against the rules that stand today: the reading on file was made under an older review contract, so it is read again before these words are offered", row = { id, tenantId: "tenant-fx", basis: "basis-current::d8", status: "needs_review", researchOnly: false, impactScore: 7, obligation: { kind: "review" }, faults: [stale], limitations: [stale] };
  const drive = async (readbackStatus: string, startStatus = "needs_review", permissions = ["paused"], saveResult = "saved", authorized = false) => { const events: string[] = []; let stored = { ...row, status: startStatus }, pi = 0;
    const deps = { permission: async () => permissions[Math.min(pi++, permissions.length - 1)], load: async (_t: string, asked: string) => (events.push(`load:${asked}`), stored), version: () => "v1",
      providerConfigured: () => true, reviewAuthorized: () => authorized, delivery: () => "existing_page_edit", obligation: () => ({ kind: "review" }), preflight: async () => null,
      spend: { reserve: async () => (events.push("admit"), { outcome: "reserved", attemptId: "proof-1" }), claimTransmission: async () => (events.push("claim"), "claimed"),
        release: async () => (events.push("release"), true), reconcile: async (_id: string, usd: number, _task: null, _basis: string, payload: { success: boolean; reason: string }) => (events.push(`reconcile:${usd}:${payload.success}`), true) },
      review: async (_row: unknown, opts: { attempts: { record?: (r: unknown) => void } }) => (events.push(`review:${id}`), opts.attempts.record?.({ status: "drafted", attempts: 1, costUsd: 0.01 }), { row: { ...row, status: "needs_review", researchOnly: false, obligation: undefined }, detail: "accepted" }),
      promote: async (_t: string, asked: string, _v: string, _basis: unknown, _answer: unknown, candidate?: typeof row) => (events.push(`promote:${asked}:${candidate ? "reviewed" : "stored"}`), stored = { ...(candidate ?? stored), status: readbackStatus, obligation: readbackStatus === "ready" ? undefined : (candidate ?? stored).obligation } as never, { status: saveResult === "saved" ? "promoted" : "stale" }),
      acceptable: (candidate: { status?: string; researchOnly?: boolean; obligation?: unknown; gaps?: unknown[] } | null) => candidate?.status === "ready" && candidate.researchOnly === false && candidate.obligation == null && (candidate.gaps?.length ?? 0) === 0 };
    const proof = (await import("@/domains/runtime/ops/atomic-proof")).default;
    return { out: await proof.run({ tenantId: "tenant-fx", proposalId: id, currentBasis: "basis-current::d8", maxOpenAiCalls: 1, maxOpenAiUsd: 0.05 }, deps as never), events }; };
  it("persists then rereads the same stable id and trusts only the stored Ready row", async () => { const good = await drive("ready"), bad = await drive("needs_review"), already = await drive("ready", "ready"), changed = await drive("ready", "needs_review", ["paused"], "blocked"), free = await drive("ready", "needs_review", ["paused"], "saved", true); expect([good.out.success, bad.out.success, already.out.success, changed.out.success, changed.events.at(-1), good.events, already.events, free.out.success, free.out.meter, free.events]).toEqual([true, false, false, false, "reconcile:0:false", [`load:${id}`, "admit", "claim", `review:${id}`, `promote:${id}:reviewed`, `load:${id}`, "reconcile:0:true"], [`load:${id}`], true, { ops: 0, providerCalls: 0, costUsd: 0 }, [`load:${id}`, `promote:${id}:stored`, `load:${id}`]]);});
  it("admits one concurrent press and spends nothing after research resumes", async () => { const resumed = await drive("ready", "needs_review", ["paused", "running"]); expect([resumed.out.success, resumed.events.includes("review:" + id), resumed.events.at(-1)]).toEqual([false, false, "release"]);
    const events: string[] = []; let held = false, release!: () => void; const wait = new Promise<void>((r) => { release = r; });
    const base = { permission: async () => "paused", load: async () => row, version: () => "v1", providerConfigured: () => true, reviewAuthorized: () => false, delivery: () => "existing_page_edit", obligation: () => ({ kind: "review" }), preflight: async () => null, acceptable: () => true,
      spend: { reserve: async () => held ? { outcome: "resumed", attemptId: "proof-1" } : (held = true, { outcome: "reserved", attemptId: "proof-1" }), claimTransmission: async () => "claimed", release: async () => (held = false, true), reconcile: async () => true },
      review: async () => (events.push("review"), await wait, { row: { ...row, status: "needs_review" }, detail: "accepted" }), promote: async () => ({ status: "promoted" }) };
    const proof = (await import("@/domains/runtime/ops/atomic-proof")).default, args = { tenantId: "tenant-fx", proposalId: id, currentBasis: "basis-current::d8", maxOpenAiCalls: 1, maxOpenAiUsd: 0.05 }, first = proof.run(args, base as never);
    const preflight = await proof.run(args, { ...base, preflight: async () => "This change states a fact with no source behind it.", spend: { ...base.spend, reserve: async () => { throw new Error("admission reached"); } }, review: async () => { throw new Error("review reached"); } } as never); expect([preflight.success, preflight.reason]).toEqual([false, "candidate_preflight:This change states a fact with no source behind it."]);
    const noKey = await proof.run(args, { ...base, providerConfigured: () => false, spend: { ...base.spend, reserve: async () => { throw new Error("admission reached"); } } } as never), oldBasis = await proof.run({ ...args, currentBasis: "basis-new::d9" }, { ...base, spend: { ...base.spend, reserve: async () => { throw new Error("admission reached"); } } } as never); expect([noKey.reason, oldBasis.reason]).toEqual(["openai_not_configured_in_this_runtime", "candidate_basis_is_not_current"]);
    while (!events.length) await Promise.resolve(); const second = await proof.run(args, base as never); release(); await first;
    expect([second.success, second.reason, events]).toEqual([false, "proof_admission_resumed", ["review"]]);
    let reviews = 0, releases = 0; const zeroCall = { ...base, spend: { ...base.spend, reserve: async () => ({ outcome: "reserved", attemptId: `proof-${reviews}` }), release: async () => (releases++, true) }, review: async (_r: unknown, o: { attempts: { record?: (x: unknown) => void } }) => (reviews++, o.attempts.record?.({ status: "blocked_budget", attempts: 0, costUsd: 0 }), { row: null, detail: "nothing crossed the wire" }) };
    const failed = await proof.run(args, zeroCall as never), retried = await proof.run(args, zeroCall as never);
    let charged = false, reconciled = 0; const afterWire = { ...zeroCall, spend: { ...zeroCall.spend, reserve: async () => charged ? { outcome: "resumed", attemptId: "proof-paid" } : (charged = true, { outcome: "reserved", attemptId: "proof-paid" }), reconcile: async () => (reconciled++, true) }, review: async () => Promise.reject(new Error("transmission receipt lost")) }, paidFailure = await proof.run(args, afterWire as never), blockedReplay = await proof.run(args, afterWire as never);
    expect([failed.reason, retried.reason, reviews, releases, paidFailure.reason, blockedReplay.reason, reconciled]).toEqual(["review_did_not_return_the_exact_candidate", "review_did_not_return_the_exact_candidate", 2, 2, "proof_execution_failed", "proof_admission_resumed", 1]);});});
describe("the paid doors refuse a paused account even with no scope open", () => {
  it("blocks the model door at the pause bit, before any network", async () => {
    const { setSpendPauseProbeForTests } = await import("@/lib/spend-scope");
    setSpendPauseProbeForTests(async () => true);
    const { openAIStructuredResponse } = await import("@/domains/decision/llm/gateway");
    const outcome = await openAIStructuredResponse(MODEL_ASK);
    setSpendPauseProbeForTests(null);
    expect(outcome.kind).toBe("blocked_budget");
    if (outcome.kind === "blocked_budget") expect(outcome.reason).toContain("paused");
    expect(fetchSpy).not.toHaveBeenCalled();});
  it("blocks the provider door the same way, leaving the work owed", async () => {
    const { setSpendPauseProbeForTests } = await import("@/lib/spend-scope");
    setSpendPauseProbeForTests(async () => true);
    const { providerCall } = await import("@/domains/evidence/dataforseo/capabilities"); const result = await providerCall("serp_organic" as never, { keyword: "haft seen" } as never, { tenantId: "tenant-fx", unitKey: "u1" });
    setSpendPauseProbeForTests(null);
    expect(result.state).toBe("capped"); expect(fetchSpy).not.toHaveBeenCalled();});
  it("leaves the FREE collect of an already-purchased task untouched by the pause", async () => {
    const { setSpendPauseProbeForTests, runWithoutSpending } = await import("@/lib/spend-scope"); // Collection is a task_get that costs nothing; the pause stops buying, never picking up what was bought.
    setSpendPauseProbeForTests(async () => true);
    const { collectCapability } = await import("@/domains/evidence/dataforseo/capabilities"); let reached = false;
    const out = await runWithoutSpending(() => collectCapability("dfs2_missing", {
      claimEvidenceFetch: async () => { reached = true; return { outcome: "missing" }; },
    } as never)).catch(() => null);
    setSpendPauseProbeForTests(null);
    expect(reached || out != null).toBe(true); // it went to work rather than refusing at the boundary
  });});
describe("two dispatchers cannot both rebuild one account, and only the owner can free the hold", () => {
  type Hold = { content: [{ until: string; owner?: string }] };
  const claimsTable = (rows: Map<string, Hold>) => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        insert: (r: { scope_key: string; content: Hold["content"] }) => ({
          select: async () => rows.has(r.scope_key)
            ? { data: null, error: { code: "23505", message: "duplicate key" } }
            : (rows.set(r.scope_key, { content: r.content }), { data: [{ scope_key: r.scope_key }], error: null }),}),
        update: (r: { content: Hold["content"] }) => ({
          eq: (_c: string, key: string) => {
            const takeover = {
              lt: (_p: string, nowIso: string) => ({
                select: async () => {
                  const held = rows.get(key);
                  if (!held || held.content[0].until >= nowIso) return { data: [], error: null };
                  rows.set(key, { content: r.content });
                  return { data: [{ scope_key: key }], error: null };},}),
              eq: (_o: string, owner: string) => ({ // The release path: a second eq is the OWNER match, and the row changes only when it holds.
                then: (res: (v: unknown) => unknown) => {
                  const held = rows.get(key);
                  if (held && held.content[0].owner === owner) rows.set(key, { content: r.content });
                  return Promise.resolve({ data: null, error: null }).then(res);},}),};
            return takeover;},}),}),}),});
  it("grants the hold to exactly one caller, and an expired hold never wedges the account", async () => {
    vi.resetModules();
    const rows = new Map<string, Hold>();
    vi.doMock("@/lib/persistence/supabase", () => claimsTable(rows));
    const { claimScope } = await import("@/lib/persistence/json-store"); // The two dispatchers arrive one after the other, which is what the database sees however they were scheduled: the first statement takes the hold, and the second changes nothing and is told so.
    expect(typeof await claimScope("surface-claims", "tenant-fx", 300)).toBe("string");
    expect(await claimScope("surface-claims", "tenant-fx", 300)).toBeNull(); // never both
    expect(typeof await claimScope("surface-claims", "tenant-other", 300)).toBe("string"); // another account is not blocked by it // AND A HOLD THAT OUTLIVES ITS OWNER NEVER WEDGES THE ACCOUNT: expired, the next dispatcher takes it.
    rows.set("surface-claims::tenant-fx", { content: [{ until: "2000-01-01T00:00:00.000Z", owner: "dead" }] });
    expect(typeof await claimScope("surface-claims", "tenant-fx", 300)).toBe("string");
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();});
  it("lets a holder that outlived its TTL release NOTHING, so its successor keeps the hold", async () => { // A stalls past TTL; B takes the hold; A's late release must free NOTHING or C rebuilds beside B.
    vi.resetModules();
    const rows = new Map<string, Hold>();
    vi.doMock("@/lib/persistence/supabase", () => claimsTable(rows));
    const { claimScope, releaseScope } = await import("@/lib/persistence/json-store"); const a = await claimScope("surface-claims", "tenant-fx", 300);
    expect(typeof a).toBe("string");
    rows.set("surface-claims::tenant-fx", { content: [{ ...rows.get("surface-claims::tenant-fx")!.content[0], until: "2000-01-01T00:00:00.000Z" }] }); // A's TTL passes
    const b = await claimScope("surface-claims", "tenant-fx", 300);
    expect(typeof b).toBe("string"); // B takes the expired hold
    await releaseScope("surface-claims", "tenant-fx", a!); // A wakes up late and releases
    expect(await claimScope("surface-claims", "tenant-fx", 300)).toBeNull(); // C is still refused: B holds
    await releaseScope("surface-claims", "tenant-fx", b!); // B's own release is the one that lands
    expect(typeof await claimScope("surface-claims", "tenant-fx", 300)).toBe("string"); // now C may build
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();});});
describe("the rebuild claim fails closed in every hosted failure mode", () => {
  const hosted = async (impl: () => unknown): Promise<string | null> => {
    vi.resetModules();
    const prior = { source: process.env.DATA_SOURCE, vercel: process.env.VERCEL };
    process.env.DATA_SOURCE = "supabase"; delete process.env.VERCEL;
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: impl }));
    const { claimScope } = await import("@/lib/persistence/json-store"); const got = await claimScope("surface-claims", "tenant-fx", 300);
    process.env.DATA_SOURCE = prior.source ?? ""; if (prior.vercel != null) process.env.VERCEL = prior.vercel;
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();
    return got;};
  const table = (error: { code?: string; message: string }) => () => ({
    from: () => ({
      insert: () => ({ select: async () => ({ data: null, error }) }),
      update: () => ({ eq: () => ({ lt: () => ({ select: async () => ({ data: null, error }) }) }) }),}),});
  it("refuses when the database client will not start", async () => {
    expect(await hosted(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set"); })).toBeNull();});
  it("refuses when the claims table is not migrated here", async () => {
    expect(await hosted(table({ code: "42P01", message: "relation does not exist" }))).toBeNull();});
  it("refuses when the statement fails", async () => {
    expect(await hosted(table({ code: "57014", message: "canceling statement due to statement timeout" }))).toBeNull();});
  it("refuses when the answer is not something it can read", async () => {
    expect(await hosted(() => ({ from: () => ({ insert: () => ({ select: async () => ({ data: null, error: null }) }) }) }))).toBeNull();});
  it("still grants in explicitly local file mode, where there is one process and nothing to race", async () => {
    vi.resetModules();
    const prior = process.env.DATA_SOURCE;
    process.env.DATA_SOURCE = "file"; delete process.env.VERCEL;
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => { throw new Error("no env"); } }));
    const { claimScope } = await import("@/lib/persistence/json-store"); expect(typeof await claimScope("surface-claims", "tenant-fx", 300)).toBe("string");
    process.env.DATA_SOURCE = prior ?? "";
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();});});
describe("pressing Pause closes the doors on the very next paid call", () => {
  const withRealPausePath = async (fn: (mod: typeof import("@/lib/spend-scope")) => Promise<void>, reads: { paused: () => boolean; count?: { n: number } }) => {
    vi.resetModules();
    const prior = process.env.VITEST; delete process.env.VITEST;
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
        if (reads.count) reads.count.n += 1;
        return { data: { research_paused: reads.paused() }, error: null };
      } }) }) }),
    }) }));
    try { await fn(await import("@/lib/spend-scope")); }
    finally { process.env.VITEST = prior; vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }};
  it("never remembers permission: the switch flipped mid-minute refuses on the very next ask", async () => {
    let paused = false;
    await withRealPausePath(async ({ spendingClosed }) => {
      expect(await spendingClosed("tenant-fx")).toBe(false); // running is read
      paused = true; // the operator presses Pause
      expect(await spendingClosed("tenant-fx")).toBe(true); // no memo shields the stale grant
    }, { paused: () => paused });});
  it("remembers only the refusal, so a paused drafting pass reads the switch once, not dozens of times", async () => {
    const count = { n: 0 };
    await withRealPausePath(async ({ spendingClosed }) => {
      for (let i = 0; i < 3; i += 1) expect(await spendingClosed("tenant-fx")).toBe(true);
      expect(count.n).toBe(1); // one read, then the memoized refusal
    }, { paused: () => true, count });});
  it("lets the verified pause write settle the boundary directly, and a resume clears without granting", async () => {
    const count = { n: 0 };
    await withRealPausePath(async ({ spendingClosed, settleSpendPause }) => {
      settleSpendPause("tenant-fx", true); // the write's readback landed: refuse before any read
      expect(await spendingClosed("tenant-fx")).toBe(true);
      expect(count.n).toBe(0); // refused from the settled memo, no read at all
      settleSpendPause("tenant-fx", false); // resume clears the memo and grants NOTHING by itself
      expect(await spendingClosed("tenant-fx")).toBe(false);
      expect(count.n).toBe(1); // the grant came from a fresh read, never from the settle
    }, { paused: () => false, count });});
  it("refuses at BOTH paid doors immediately after the flip, with zero network", async () => {
    let paused = false;
    await withRealPausePath(async () => {
      const { openAIStructuredResponse } = await import("@/domains/decision/llm/gateway"); const { providerCall } = await import("@/domains/evidence/dataforseo/capabilities");
      paused = true; // Pause lands; the doors are asked next
      const model = await openAIStructuredResponse(MODEL_ASK);
      expect(model.kind).toBe("blocked_budget"); const provider = await providerCall("serp_organic" as never, { keyword: "haft seen" } as never, { tenantId: "tenant-fx", unitKey: "u1" });
      expect(provider.state).toBe("capped");
      expect(fetchSpy).not.toHaveBeenCalled(); // zero network, so zero ledger movement by construction
    }, { paused: () => paused });});});
describe("an idle tick collects only provider receipts whose durable wake is due", () => {
  it("bounds free collection and performs no account-wide rebuild scan when no run is admitted", async () => {
    vi.resetModules();
    const events: string[] = [];
    vi.doMock("@/domains/evidence/dataforseo/default-deps", () => ({
      pendingProviderTaskKeys: async (limit: number) => { events.push(`enumerate:${limit}`); return ["dfs2_owed"]; },}));
    vi.doMock("@/domains/evidence/dataforseo/capabilities", () => ({
      collectCapability: async (key: string) => { events.push(`collect:${key}`); return { state: "hit", envelope: {}, costUsd: 0, cacheKey: key }; },}));
    vi.doMock("@/domains/runtime/research-run", () => ({ claimDueRuns: async () => [], RESEARCH_RUN_LEASE_SECONDS: 800, finishRun: async () => true, newOwnerToken: () => "o1", startExtraPass: async () => null }));
    const { runDueAccounts } = await import("@/domains/runtime/ops/scheduler");
    await runDueAccounts({ now: () => new Date("2026-08-21T12:00:00Z"), steps: { strandedToday: async () => [] } as never });
    expect(events).toEqual(["enumerate:8", "collect:dfs2_owed"]);
    expect(fetchSpy).not.toHaveBeenCalled(); // GET went through the collector fake; nothing posted, nothing paid
    vi.doUnmock("@/domains/evidence/dataforseo/default-deps"); vi.doUnmock("@/domains/evidence/dataforseo/capabilities");
    vi.doUnmock("@/domains/runtime/research-run"); vi.resetModules();});});
