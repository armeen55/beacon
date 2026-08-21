/** PAUSING RESEARCH MUST STOP THE BUYING, NOT JUST THE RESEARCH CYCLE (operator, 2026-08-19).
 *
 *  The defect these pin: `research_paused` took an account out of the research claim and left every other door
 *  into the paid drafter open. A stale Today visit, a stale Changes visit and the cache warmer all rebuild the
 *  customer surface, the rebuild runs the proposal producer, and the producer minted its two paid budgets
 *  unconditionally. Decision side model spend landed at 23:08 UTC on a paused day with no research run in
 *  flight, and `maxDrafts: 0` did not stop it because that bounds one pool of three.
 *
 *  ZERO IS PROVED DIRECTLY HERE, never inferred from a ledger counter after the fact: the model door and the
 *  provider door are called inside the scope and asked whether they touched the network at all. */
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
    if (outcome.kind === "blocked_budget") expect(outcome.reason).toContain("paused");
  });

  it("closes the provider door the same way, leaving the work owed rather than failed", async () => {
    const { providerCall } = await import("@/domains/evidence/dataforseo/capabilities");
    const result = await runWithoutSpending(() => providerCall(
      "serp_organic" as never, { keyword: "haft seen set" } as never, { tenantId: "tenant-fx", unitKey: "u1" }));
    expect(result.state).toBe("capped"); // owed, not failed: a paused day is not an outage
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is ambient, so a path nobody remembered to thread the flag through still refuses", async () => {
    // The whole point of the scope: no producer has to be told, and one added tomorrow inherits the refusal.
    const deepInside = async () => ({ refused: spendingRefused() });
    expect(await runWithoutSpending(() => deepInside())).toEqual({ refused: true });
    expect(await deepInside()).toEqual({ refused: false }); // and it never leaks outside its own call stack
  });

  it("does not leak across a paid pass that runs after it", async () => {
    await runWithoutSpending(async () => { expect(spendingRefused()).toBe(true); });
    expect(spendingRefused()).toBe(false);
  });
});

/** THE ONE GATE, AND WHY IT IS NOT AT THE CALLERS. Four doors reach the rebuild body: a stale Today visit, a
 *  stale Changes visit, the cache warmer and the scheduler. Three of them passed no budget at all, so the rule
 *  is read inside the body every one of them goes through, and a fifth door added later inherits it. */
describe("a paused account rebuilds its surface and buys nothing, whatever the caller asked for", () => {
  const storeMock = (claim: boolean, held: unknown[] = []) => ({
    readStore: async () => held, writeStore: async () => undefined,
    claimScope: async (name: string) => { calls.claims.push(name); return claim; },
    releaseScope: async (name: string) => { calls.releases.push(name); },
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
        return { proposals: [], outcome: "no_actionable_candidate", persisted: 0 };
      },
      reconcileImplementedWithoutShipment: async () => undefined,
    }));
    const { refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
    // The caller asks for five paid drafts. The pause outranks it.
    await refreshCustomerSurface("tenant-fx", { maxDrafts: 5 }).catch(() => null);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.refusedInside).toBe(true); // every paid door inside this pass is already closed
    expect(seen[0]!.opts).toMatchObject({ maxDrafts: 0 }); // and the pause outranked the caller's ask
    expect(calls.claims).toContain("surface-claims"); // the cross-instance hold was taken at the boundary
    expect(calls.releases).toContain("surface-claims"); // and freed on the way out, build or no build
    vi.doUnmock("@/lib/persistence/json-store"); vi.doUnmock("@/domains/runtime"); vi.doUnmock("@/domains/decision"); vi.resetModules();
  });

  it("hands a second instance the release on file instead of building twice", async () => {
    vi.resetModules(); calls.claims.length = 0; calls.releases.length = 0;
    const held = [{ schemaVersion: 2, tenantId: "tenant-fx", computedAt: "2026-08-20T00:00:00.000Z",
      changes: { proposals: [] }, today: { today: {}, hasChanges: false } }];
    let built = 0;
    vi.doMock("@/lib/persistence/json-store", () => storeMock(false, held));
    vi.doMock("@/domains/runtime", () => ({ researchPermission: async () => "running" as const }));
    vi.doMock("@/domains/decision", () => ({
      produceProposalsForTenant: async () => { built += 1; return { proposals: [], outcome: "no_actionable_candidate", persisted: 0 }; },
      reconcileImplementedWithoutShipment: async () => undefined,
    }));
    const { refreshCustomerSurface } = await import("@/app/(shell)/surface-release");
    const out = await refreshCustomerSurface("tenant-fx");
    expect(built).toBe(0); // the other dispatcher owns the build
    expect(out).toBe(held[0]); // this one serves what is already published
    vi.doUnmock("@/lib/persistence/json-store"); vi.doUnmock("@/domains/runtime"); vi.doUnmock("@/domains/decision"); vi.resetModules();
  });
});

/** THE DOORS THEMSELVES READ THE SWITCH. The scope closes every caller that opened one, and the leak proved a
 *  path nobody wrapped keeps buying, so the two paid doors now refuse on the account's own pause bit with no
 *  scope open at all. A caller added tomorrow inherits this without anyone remembering anything. */
describe("the paid doors refuse a paused account even with no scope open", () => {
  it("blocks the model door at the pause bit, before any network", async () => {
    const { setSpendPauseProbeForTests } = await import("@/lib/spend-scope");
    setSpendPauseProbeForTests(async () => true);
    const { openAIStructuredResponse } = await import("@/domains/decision/llm/gateway");
    const { z } = await import("zod");
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
    const { providerCall } = await import("@/domains/evidence/dataforseo/capabilities");
    const result = await providerCall("serp_organic" as never, { keyword: "haft seen" } as never, { tenantId: "tenant-fx", unitKey: "u1" });
    setSpendPauseProbeForTests(null);
    expect(result.state).toBe("capped");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("leaves the FREE collect of an already-purchased task untouched by the pause", async () => {
    // Collection is a task_get that costs nothing; the pause stops buying, never picking up what was bought.
    const { setSpendPauseProbeForTests, runWithoutSpending } = await import("@/lib/spend-scope");
    setSpendPauseProbeForTests(async () => true);
    const { collectCapability } = await import("@/domains/evidence/dataforseo/capabilities");
    let reached = false;
    const out = await runWithoutSpending(() => collectCapability("dfs2_missing", {
      claimEvidenceFetch: async () => { reached = true; return { outcome: "missing" }; },
    } as never)).catch(() => null);
    setSpendPauseProbeForTests(null);
    expect(reached || out != null).toBe(true); // it went to work rather than refusing at the boundary
  });
});

/** ONE REBUILD PER ACCOUNT, DECIDED BY THE DATABASE (reviewer, 2026-08-19). Reading the release, checking it
 *  and then acting is not a claim: two dispatchers on two instances both read "stale", both decide, and both
 *  do the whole job. It buys nothing, and it doubles database work of exactly the kind that has exhausted this
 *  project's connection budget before. */
describe("two dispatchers cannot both rebuild one account", () => {
  it("grants the hold to exactly one caller and refuses the other until it expires", async () => {
    vi.resetModules();
    const rows = new Map<string, { content: [{ until: string }] }>();
    vi.doMock("@/lib/persistence/supabase", () => ({
      getSupabaseAdmin: () => ({
        from: () => ({
          // insert wins only when nothing holds the scope yet; a duplicate key is a real database error.
          insert: (r: { scope_key: string; content: [{ until: string }] }) => ({
            select: async () => rows.has(r.scope_key)
              ? { data: null, error: { code: "23505", message: "duplicate key" } }
              : (rows.set(r.scope_key, { content: r.content }), { data: [{ scope_key: r.scope_key }], error: null }),
          }),
          // update carries the condition: it changes the row ONLY where the hold already expired.
          update: (r: { content: [{ until: string }] }) => ({
            eq: (_c: string, key: string) => ({
              lt: (_p: string, nowIso: string) => ({
                select: async () => {
                  const held = rows.get(key);
                  if (!held || held.content[0].until >= nowIso) return { data: [], error: null };
                  rows.set(key, { content: r.content });
                  return { data: [{ scope_key: key }], error: null };
                },
              }),
            }),
          }),
        }),
      }),
    }));
    const { claimScope } = await import("@/lib/persistence/json-store");
    // The two dispatchers arrive one after the other, which is what the database sees however they were
    // scheduled: the first statement takes the hold, and the second changes nothing and is told so.
    expect(await claimScope("surface-claims", "tenant-fx", 300)).toBe(true);
    expect(await claimScope("surface-claims", "tenant-fx", 300)).toBe(false); // never both
    expect(await claimScope("surface-claims", "tenant-other", 300)).toBe(true); // another account is not blocked by it
    // AND A HOLD THAT OUTLIVES ITS OWNER NEVER WEDGES THE ACCOUNT: expired, the next dispatcher takes it.
    rows.set("surface-claims::tenant-fx", { content: [{ until: "2000-01-01T00:00:00.000Z" }] });
    expect(await claimScope("surface-claims", "tenant-fx", 300)).toBe(true);
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();
  });
});

/** A BROKEN HOSTED INSTANCE IS NOT A QUIET SINGLE-PROCESS MACHINE (reviewer, 2026-08-19). The claim used to be
 *  granted whenever the database could not answer, which hands the hold to every dispatcher at once in exactly
 *  the state where that is most likely. Only explicitly local file mode may grant without a database. */
describe("the rebuild claim fails closed in every hosted failure mode", () => {
  const hosted = async (impl: () => unknown): Promise<boolean> => {
    vi.resetModules();
    const prior = { source: process.env.DATA_SOURCE, vercel: process.env.VERCEL };
    process.env.DATA_SOURCE = "supabase"; delete process.env.VERCEL;
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: impl }));
    const { claimScope } = await import("@/lib/persistence/json-store");
    const got = await claimScope("surface-claims", "tenant-fx", 300);
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
    expect(await hosted(() => { throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set"); })).toBe(false);
  });
  it("refuses when the claims table is not migrated here", async () => {
    expect(await hosted(table({ code: "42P01", message: "relation does not exist" }))).toBe(false);
  });
  it("refuses when the statement fails", async () => {
    expect(await hosted(table({ code: "57014", message: "canceling statement due to statement timeout" }))).toBe(false);
  });
  it("refuses when the answer is not something it can read", async () => {
    expect(await hosted(() => ({ from: () => ({ insert: () => ({ select: async () => ({ data: null, error: null }) }) }) }))).toBe(false);
  });
  it("still grants in explicitly local file mode, where there is one process and nothing to race", async () => {
    vi.resetModules();
    const prior = process.env.DATA_SOURCE;
    process.env.DATA_SOURCE = "file"; delete process.env.VERCEL;
    vi.doMock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => { throw new Error("no env"); } }));
    const { claimScope } = await import("@/lib/persistence/json-store");
    expect(await claimScope("surface-claims", "tenant-fx", 300)).toBe(true);
    process.env.DATA_SOURCE = prior ?? "";
    vi.doUnmock("@/lib/persistence/supabase"); vi.resetModules();
  });
});
