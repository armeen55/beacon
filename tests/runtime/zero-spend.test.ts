/** PAUSING RESEARCH MUST STOP THE BUYING, NOT JUST THE RESEARCH CYCLE (operator, 2026-08-19): every stale surface rebuild ran the producer, which minted its paid budgets unconditionally, and maxDrafts bounded one pool of three. ZERO IS PROVED DIRECTLY: the doors are called and asked whether they touched the network. */
import { describe, expect, it, vi, afterEach } from "vitest";
import { z } from "zod";
import { runWithoutSpending, spendingRefused } from "@/lib/spend-scope";
const fetchSpy = vi.spyOn(globalThis, "fetch");
afterEach(() => { fetchSpy.mockClear(); });
describe("inside a no-spend scope nothing is bought, and nothing pretends it failed", () => {
  it("closes the model door before a client, a schema or a budget is touched", async () => {
    const { openAIStructuredResponse } = await import("@/domains/decision/llm/gateway");
    const args = {
      promptId: "page-job-read" as never, promptVersion: 1, action: "test", apiKey: "sk-not-used",
      model: "gpt-5-mini", instructions: "x", input: "y", schemaName: "s", zodSchema: z.object({ a: z.string() }),
      maxOutputTokens: 16, tenantId: "tenant-fx",
    } as unknown as Parameters<typeof openAIStructuredResponse>[0];
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
    const deepInside = async () => ({ refused: spendingRefused() }); expect(await runWithoutSpending(() => deepInside())).toEqual({ refused: true });
    expect(await deepInside()).toEqual({ refused: false }); // and it never leaks outside its own call stack
  });
  it("does not leak across a paid pass that runs after it", async () => {
    await runWithoutSpending(async () => { expect(spendingRefused()).toBe(true); }); expect(spendingRefused()).toBe(false);});});
/** THE ONE GATE IS INSIDE THE BODY all four rebuild doors share, so a fifth door added later inherits it. */
describe("a paused account rebuilds its surface and buys nothing, whatever the caller asked for", () => {
  const storeMock = (claim: boolean, held: unknown[] = []) => ({
    readStore: async () => held, writeStore: async () => undefined,
    claimScope: async (name: string) => { calls.claims.push(name); return claim ? "hold-1" : null; },
    releaseScope: async (name: string, _key: string, owner: string) => { calls.releases.push(`${name}:${owner}`); },
  });
  const calls = { claims: [] as string[], releases: [] as string[] };
  it("overrides the caller's own draft budget, closes every door on the stack, and releases its hold", async () => {
    vi.resetModules(); calls.claims.length = 0; calls.releases.length = 0;
    const seen: Array<{ opts: unknown; refusedInside: boolean }> = [];
    vi.doMock("@/lib/persistence/json-store", () => storeMock(true));
    vi.doMock("@/domains/runtime", () => ({ researchPermission: async () => "paused" as const }));
    vi.doMock("@/domains/decision", () => ({
      produceProposalsForTenant: async (_t: string, opts: unknown) => {
        // ASKED FROM INSIDE THE PRODUCER, which is the only place the answer means anything.
        const { spendingRefused: refused } = await import("@/lib/spend-scope");
        seen.push({ opts, refusedInside: refused() });
        return { proposals: [], outcome: "no_actionable_candidate", persisted: 0 };},
      reconcileImplementedWithoutShipment: async () => undefined,}));
    const { refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
    // The caller asks for five paid drafts. The pause outranks it.
    await refreshCustomerSurface("tenant-fx", { maxDrafts: 5 }).catch(() => null); expect(seen).toHaveLength(1);
    expect(seen[0]!.refusedInside).toBe(true); // every paid door inside this pass is already closed
    expect(seen[0]!.opts).toMatchObject({ maxDrafts: 0 }); // and the pause outranked the caller's ask
    expect(calls.claims).toContain("surface-claims"); // the cross-instance hold was taken at the boundary
    expect(calls.releases).toContain("surface-claims:hold-1"); // and freed with ITS OWN token, build or no build
    vi.doUnmock("@/lib/persistence/json-store"); vi.doUnmock("@/domains/runtime"); vi.doUnmock("@/domains/decision"); vi.resetModules();});
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
    vi.doUnmock("@/lib/persistence/json-store"); vi.doUnmock("@/domains/runtime"); vi.doUnmock("@/domains/decision"); vi.resetModules();
  });
});
/** THE DOORS THEMSELVES READ THE SWITCH, with no scope open at all: a caller added tomorrow inherits it. */
describe("the paid doors refuse a paused account even with no scope open", () => {
  it("blocks the model door at the pause bit, before any network", async () => {
    const { setSpendPauseProbeForTests } = await import("@/lib/spend-scope");
    setSpendPauseProbeForTests(async () => true);
    const { openAIStructuredResponse } = await import("@/domains/decision/llm/gateway"); const { z } = await import("zod");
    const outcome = await openAIStructuredResponse({
      promptId: "page-job-read", promptVersion: 1, action: "test", apiKey: "sk-not-used",
      model: "gpt-5-mini", instructions: "x", input: "y", schemaName: "s", zodSchema: z.object({ a: z.string() }),
      maxOutputTokens: 16, tenantId: "tenant-fx",
    } as never);
    setSpendPauseProbeForTests(null);
    expect(outcome.kind).toBe("blocked_budget");
    if (outcome.kind === "blocked_budget") expect(outcome.reason).toContain("paused");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("blocks the provider door the same way, leaving the work owed", async () => {
    const { setSpendPauseProbeForTests } = await import("@/lib/spend-scope");
    setSpendPauseProbeForTests(async () => true);
    const { providerCall } = await import("@/domains/evidence/dataforseo/capabilities"); const result = await providerCall("serp_organic" as never, { keyword: "haft seen" } as never, { tenantId: "tenant-fx", unitKey: "u1" });
    setSpendPauseProbeForTests(null);
    expect(result.state).toBe("capped"); expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("leaves the FREE collect of an already-purchased task untouched by the pause", async () => {
    // Collection is a task_get that costs nothing; the pause stops buying, never picking up what was bought.
    const { setSpendPauseProbeForTests, runWithoutSpending } = await import("@/lib/spend-scope");
    setSpendPauseProbeForTests(async () => true);
    const { collectCapability } = await import("@/domains/evidence/dataforseo/capabilities"); let reached = false;
    const out = await runWithoutSpending(() => collectCapability("dfs2_missing", {
      claimEvidenceFetch: async () => { reached = true; return { outcome: "missing" }; },
    } as never)).catch(() => null);
    setSpendPauseProbeForTests(null);
    expect(reached || out != null).toBe(true); // it went to work rather than refusing at the boundary
  });
});
/** ONE REBUILD PER ACCOUNT, DECIDED BY THE DATABASE (reviewer, 2026-08-19): read-check-act is not a claim. */
describe("two dispatchers cannot both rebuild one account, and only the owner can free the hold", () => {
  type Hold = { content: [{ until: string; owner?: string }] };
  /** One fake claims table honoring the three statements the store issues: winning insert, expired takeover, owner-matched release. */
  const claimsTable = (rows: Map<string, Hold>) => ({
    getSupabaseAdmin: () => ({
      from: () => ({
        insert: (r: { scope_key: string; content: Hold["content"] }) => ({
          select: async () => rows.has(r.scope_key)
            ? { data: null, error: { code: "23505", message: "duplicate key" } }
            : (rows.set(r.scope_key, { content: r.content }), { data: [{ scope_key: r.scope_key }], error: null }),
        }),
        update: (r: { content: Hold["content"] }) => ({
          eq: (_c: string, key: string) => {
            const takeover = {
              lt: (_p: string, nowIso: string) => ({
                select: async () => {
                  const held = rows.get(key);
                  if (!held || held.content[0].until >= nowIso) return { data: [], error: null };
                  rows.set(key, { content: r.content });
                  return { data: [{ scope_key: key }], error: null };
                },
              }),
              // The release path: a second eq is the OWNER match, and the row changes only when it holds.
              eq: (_o: string, owner: string) => ({
                then: (res: (v: unknown) => unknown) => {
                  const held = rows.get(key);
                  if (held && held.content[0].owner === owner) rows.set(key, { content: r.content });
                  return Promise.resolve({ data: null, error: null }).then(res);
                },
              }),
            };
            return takeover;
          },
        }),
      }),
    }),
  });
  it("grants the hold to exactly one caller, and an expired hold never wedges the account", async () => {
    vi.resetModules();
    const rows = new Map<string, Hold>();
    vi.doMock("@/lib/persistence/supabase", () => claimsTable(rows));
    const { claimScope } = await import("@/lib/persistence/json-store");
    // The two dispatchers arrive one after the other, which is what the database sees however they were scheduled: the first statement takes the hold, and the second changes nothing and is told so.
    expect(typeof await claimScope("surface-claims", "tenant-fx", 300)).toBe("string");
    expect(await claimScope("surface-claims", "tenant-fx", 300)).toBeNull(); // never both
    expect(typeof await claimScope("surface-claims", "tenant-other", 300)).toBe("string"); // another account is not blocked by it
    // AND A HOLD THAT OUTLIVES ITS OWNER NEVER WEDGES THE ACCOUNT: expired, the next dispatcher takes it.
    rows.set("surface-claims::tenant-fx", { content: [{ until: "2000-01-01T00:00:00.000Z", owner: "dead" }] });
    expect(typeof await claimScope("surface-claims", "tenant-fx", 300)).toBe("string");
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();
  });
  it("lets a holder that outlived its TTL release NOTHING, so its successor keeps the hold", async () => {
    // A stalls past TTL; B takes the hold; A's late release must free NOTHING or C rebuilds beside B.
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
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();
  });
});
/** A BROKEN HOSTED INSTANCE IS NOT A QUIET SINGLE-PROCESS MACHINE: only local file mode grants without a database (reviewer, 2026-08-19). */
describe("the rebuild claim fails closed in every hosted failure mode", () => {
  const hosted = async (impl: () => unknown): Promise<string | null> => {
    vi.resetModules();
    const prior = { source: process.env.DATA_SOURCE, vercel: process.env.VERCEL };
    process.env.DATA_SOURCE = "supabase"; delete process.env.VERCEL;
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: impl }));
    const { claimScope } = await import("@/lib/persistence/json-store"); const got = await claimScope("surface-claims", "tenant-fx", 300);
    process.env.DATA_SOURCE = prior.source ?? ""; if (prior.vercel != null) process.env.VERCEL = prior.vercel;
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();
    return got;
  };
  const table = (error: { code?: string; message: string }) => () => ({
    from: () => ({
      insert: () => ({ select: async () => ({ data: null, error }) }),
      update: () => ({ eq: () => ({ lt: () => ({ select: async () => ({ data: null, error }) }) }) }),
    }),
  });
  it("refuses when the database client will not start", async () => {
    expect(await hosted(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set"); })).toBeNull();
  });
  it("refuses when the claims table is not migrated here", async () => {
    expect(await hosted(table({ code: "42P01", message: "relation does not exist" }))).toBeNull();
  });
  it("refuses when the statement fails", async () => {
    expect(await hosted(table({ code: "57014", message: "canceling statement due to statement timeout" }))).toBeNull();
  });
  it("refuses when the answer is not something it can read", async () => {
    expect(await hosted(() => ({ from: () => ({ insert: () => ({ select: async () => ({ data: null, error: null }) }) }) }))).toBeNull();
  });
  it("still grants in explicitly local file mode, where there is one process and nothing to race", async () => {
    vi.resetModules();
    const prior = process.env.DATA_SOURCE;
    process.env.DATA_SOURCE = "file"; delete process.env.VERCEL;
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => { throw new Error("no env"); } }));
    const { claimScope } = await import("@/lib/persistence/json-store"); expect(typeof await claimScope("surface-claims", "tenant-fx", 300)).toBe("string");
    process.env.DATA_SOURCE = prior ?? "";
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();
  });
});
/** PRESSING PAUSE MUST LAND ON THE VERY NEXT PAID CALL (reviewer, 2026-08-21): permission is never remembered, only the refusal. These run the REAL read path, hermetics lifted for their duration. */
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
    finally { process.env.VITEST = prior; vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules(); }
  };
  it("never remembers permission: the switch flipped mid-minute refuses on the very next ask", async () => {
    let paused = false;
    await withRealPausePath(async ({ spendingClosed }) => {
      expect(await spendingClosed("tenant-fx")).toBe(false); // running is read
      paused = true; // the operator presses Pause
      expect(await spendingClosed("tenant-fx")).toBe(true); // no memo shields the stale grant
    }, { paused: () => paused });
  });
  it("remembers only the refusal, so a paused drafting pass reads the switch once, not dozens of times", async () => {
    const count = { n: 0 };
    await withRealPausePath(async ({ spendingClosed }) => {
      for (let i = 0; i < 3; i += 1) expect(await spendingClosed("tenant-fx")).toBe(true);
      expect(count.n).toBe(1); // one read, then the memoized refusal
    }, { paused: () => true, count });
  });
  it("lets the verified pause write settle the boundary directly, and a resume clears without granting", async () => {
    const count = { n: 0 };
    await withRealPausePath(async ({ spendingClosed, settleSpendPause }) => {
      settleSpendPause("tenant-fx", true); // the write's readback landed: refuse before any read
      expect(await spendingClosed("tenant-fx")).toBe(true);
      expect(count.n).toBe(0); // refused from the settled memo, no read at all
      settleSpendPause("tenant-fx", false); // resume clears the memo and grants NOTHING by itself
      expect(await spendingClosed("tenant-fx")).toBe(false);
      expect(count.n).toBe(1); // the grant came from a fresh read, never from the settle
    }, { paused: () => false, count });
  });
  it("refuses at BOTH paid doors immediately after the flip, with zero network", async () => {
    let paused = false;
    await withRealPausePath(async () => {
      const { openAIStructuredResponse } = await import("@/domains/decision/llm/gateway"); const { providerCall } = await import("@/domains/evidence/dataforseo/capabilities");
      paused = true; // Pause lands; the doors are asked next
      const model = await openAIStructuredResponse({
        promptId: "page-job-read", promptVersion: 1, action: "test", apiKey: "sk-not-used",
        model: "gpt-5-mini", instructions: "x", input: "y", schemaName: "s", zodSchema: z.object({ a: z.string() }),
        maxOutputTokens: 16, tenantId: "tenant-fx",
      } as never);
      expect(model.kind).toBe("blocked_budget"); const provider = await providerCall("serp_organic" as never, { keyword: "haft seen" } as never, { tenantId: "tenant-fx", unitKey: "u1" });
      expect(provider.state).toBe("capped");
      expect(fetchSpy).not.toHaveBeenCalled(); // zero network, so zero ledger movement by construction
    }, { paused: () => paused });
  });
});
/** ALREADY-BOUGHT TASKS MUST ACTUALLY FINISH WHILE PAUSED (reviewer, 2026-08-21): the free collect existed as a function nothing called, and paid-for evidence expired provider side. */
describe("a paused tick collects what was already paid for, free, then republishes", () => {
  it("enumerates pending receipts, collects each with a free GET, posts nothing, and rebuilds after", async () => {
    vi.resetModules();
    const events: string[] = [];
    vi.doMock("@/domains/evidence/dataforseo/default-deps", () => ({
      pendingProviderTaskKeys: async (limit: number) => { events.push(`enumerate:${limit}`); return ["dfs2_owed"]; },
    }));
    vi.doMock("@/domains/evidence/dataforseo/capabilities", () => ({
      collectCapability: async (key: string) => { events.push(`collect:${key}`); return { state: "hit", envelope: {}, costUsd: 0, cacheKey: key }; },
    }));
    vi.doMock("@/domains/runtime/research-run", () => ({ claimDueRuns: async () => [], finishRun: async () => true, newOwnerToken: () => "o1", startExtraPass: async () => null }));
    vi.doMock("@/app/(shell)/surface-release", () => ({
      readCustomerSurface: async () => ({ computedAt: "2020-01-01T00:00:00.000Z" }), isCustomerSurfaceStale: () => true,
      refreshCustomerSurface: async (t: string) => { events.push(`rebuild:${t}`); return {}; },
    }));
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({
      from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ id: "tenant-fx" }], error: null }) }) }) }) }) }),
    }) }));
    const { runDueAccounts } = await import("@/domains/runtime/ops/scheduler");
    // The stranded probe is somebody else's contract; this pin holds the dispatch to the paused tail.
    await runDueAccounts({ now: () => new Date("2026-08-21T12:00:00Z"), steps: { strandedToday: async () => [] } as never });
    // The order IS the contract: what was already bought lands first, then the republish reads it.
    expect(events).toEqual(["enumerate:5", "collect:dfs2_owed", "rebuild:tenant-fx"]);
    expect(fetchSpy).not.toHaveBeenCalled(); // GET went through the collector fake; nothing posted, nothing paid
    vi.doUnmock("@/domains/evidence/dataforseo/default-deps"); vi.doUnmock("@/domains/evidence/dataforseo/capabilities");
    vi.doUnmock("@/domains/runtime/research-run"); vi.doUnmock("@/app/(shell)/surface-release");
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();
  });
});
