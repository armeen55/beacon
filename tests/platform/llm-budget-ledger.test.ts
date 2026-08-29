/** The durable per-account LLM spend writer, as its two PROMISES rather than its row mechanics: money already spent is added to that account's own running total, and a ledger I could not write NEVER blocks or breaks the paid call that already happened. Bad input is refused before the database is touched at all. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { recordSpendSupabase } from "@/lib/cost/budget-ledger-supabase";
const db = vi.hoisted(() => ({ readError: null as { message: string } | null, wrote: [] as Record<string, unknown>[], tables: [] as string[], spentToday: 0 }));
// THE WRITE IS ONE ATOMIC INCREMENT IN THE DATABASE, never a total this process computed. Reading the row, adding the cost here and writing the absolute value back lost one of any two concurrent charges outright, and the cap that fails closed then read a total lower than what was spent. The mock is the RPC, and what it is handed is a DELTA: two charges send two deltas and neither one depends on what the other read.
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ rpc: async (fn: string, args: Record<string, unknown>) => {
  db.tables.push(fn);
  if (db.readError) return { data: null, error: db.readError };
  db.wrote.push(args); return { data: true, error: null }; },
  // The daily gate reads today's rows through this same client, so the cap test exercises the real read path.
  from: () => { const chain = { select: () => chain, eq: () => chain,
    then: (r: (v: unknown) => unknown) => r({ data: [{ spent_usd: db.spentToday }], error: null }) }; return chain; } }),
  isSupabaseConfigured: () => true }));
const acct = vi.hoisted(() => ({ fail: false, budget: 1 as number | null }));
vi.mock("@/domains/account", () => ({ getTenant: async () => { if (acct.fail) throw new Error("flicker"); return { daily_budget_usd: acct.budget }; } }));
beforeEach(() => { db.readError = null; db.wrote = []; db.tables = []; vi.spyOn(console, "warn").mockImplementation(() => {}); });
describe("the durable per-account LLM spend writer", () => {
  it("adds what was just spent to that account's own running total, opening it when the account has spent nothing yet", async () => {
    await recordSpendSupabase({ tenantId: "acct-a", platform: "perplexity", costUsd: 0.0917, promptCount: 100, chunkCount: 1, runId: "run-x" });
    expect([db.tables[0], db.wrote[0]!.p_tenant_id, db.wrote[0]!.p_platform, db.wrote[0]!.p_delta, db.wrote[0]!.p_prompts]).toEqual(["increment_llm_spend", "acct-a", "perplexity", 0.0917, 100]);
    await recordSpendSupabase({ tenantId: "acct-a", platform: "openai", costUsd: 2.88, promptCount: 100, chunkCount: 1 }); expect([db.wrote[1]!.p_delta, db.wrote[1]!.p_platform, db.wrote.length]).toEqual([2.88, "openai", 2]); });
  it("answers false and writes nothing when the ledger cannot be written, so the paid call it is recording is never broken by it", async () => {
    db.readError = { message: "boom" };
    await expect(recordSpendSupabase({ tenantId: "acct-a", platform: "perplexity", costUsd: 0.05 })).resolves.toBe(false); expect(db.wrote).toEqual([]); });
  it.each([["no account", { tenantId: "", platform: "perplexity", costUsd: 0.05 }], ["an engine that cannot be billed", { tenantId: "t1", platform: "claude", costUsd: 0.05 }],
    ["a negative amount", { tenantId: "t1", platform: "perplexity", costUsd: -0.01 }], ["an amount that is not a number", { tenantId: "t1", platform: "perplexity", costUsd: NaN }],
    ["a fractional count", { tenantId: "t1", platform: "perplexity", costUsd: 0.05, promptCount: 1.5 }]] as const)(
    "refuses %s before the database is touched at all", async (_name, input) => {
      await recordSpendSupabase(input as Parameters<typeof recordSpendSupabase>[0]); expect(db.tables).toEqual([]); });});
describe("one canonical day for money and research", () => {
  it("the ledger day IS the reporting day, including across the seven-hour gap where UTC has already rolled", async () => {
    const { ledgerDay } = await import("@/lib/cost/budget-ledger-supabase"); const { reportingDay } = await import("@/lib/reporting-day");
    // 06:59Z is still YESTERDAY in Pacific; a UTC slice called it today and let the two budgets roll apart.
    for (const at of ["2026-08-18T06:59:00.000Z", "2026-08-18T07:01:00.000Z", "2026-08-19T00:30:00.000Z", "2026-12-15T07:59:00.000Z", "2026-12-15T08:01:00.000Z"].map((i) => new Date(i))) expect(ledgerDay(at)).toBe(reportingDay(at));
    expect(ledgerDay(new Date("2026-08-18T06:59:00.000Z"))).toBe("2026-08-17"); // not the UTC label
  });
  it("holds the fact reserve on BOTH doors and counts the call about to be made", async () => {
    const { shareFor, SEARCH_SHARE, FACT_RESERVE_SHARE, dailyCapReason } = await import("@/lib/cost/daily-cap"); expect(shareFor("search", "bulk")).toBeCloseTo(SEARCH_SHARE - FACT_RESERVE_SHARE, 10);
    expect(shareFor("model", "bulk")).toBeCloseTo(1 - FACT_RESERVE_SHARE, 10); // non-fact OpenAI is held back too
    expect([shareFor("search", "fact_check"), shareFor("model", "fact_check")]).toEqual([1, 1]);
    // THE COUNTEREXAMPLE: $0.769 spent of a $1 day. A $0.21 bulk buy would land at $0.979 and eat the reserve.
    db.spentToday = 0.769;
    expect(await dailyCapReason("t", new Date(), shareFor("search", "bulk"), 0.21)).toContain("budget");
    expect(await dailyCapReason("t", new Date(), shareFor("search", "bulk"), 0)).toBeNull(); // what the old check saw
    expect(await dailyCapReason("t", new Date(), shareFor("search", "fact_check"), 0.21)).toBeNull(); // the reserve is still there
    db.spentToday = 0.93; // non-fact model work stops at 0.92, leaving the fact reserve intact
    expect(await dailyCapReason("t", new Date(), shareFor("model", "bulk"), 0.01)).toContain("budget"); expect(await dailyCapReason("t", new Date(), shareFor("model", "fact_check"), 0.02)).toBeNull();
    db.spentToday = 0;});});
describe("migration history is immutable", () => {
  it("the applied 2026-08-18 migration keeps its committed bytes and later moves live in their own files", async () => {
    const { readFileSync, existsSync } = await import("node:fs"); const { createHash } = await import("node:crypto");
    const original = readFileSync("migrations/2026-08-18_page_source_facts_and_fact_check_phase.sql"); expect(createHash("sha256").update(original).digest("hex")).toBe("75862d2956f861aa0d5f66cd38f0d4d098d24264505bb3be8196f76b92564a1c");
    // the lifecycle, the ledger day and the rules version each got their own immutable file
    for (const f of ["2026-08-18b_claim_lifecycle", "2026-08-18c_ledger_reporting_day", "2026-08-18d_verification_rules_version"]) expect(existsSync(`migrations/${f}.sql`)).toBe(true);
  });});

/** AN UNREADABLE BUDGET IS NOT THE DEFAULT BUDGET. The cap fell back to the standard allowance when the tenant read failed, so an account whose operator had set the day to zero, which that file's contract calls turning paid work off, would have spent against a five dollar cap the moment the read flickered. */
describe("the day's budget", () => { it("refuses paid work when it cannot be read, and honours a zero the operator set", async () => {
  const { dailyCapReason } = await import("@/lib/cost/daily-cap"); const ask = () => dailyCapReason("t", new Date(), 1, 0.01);
  acct.fail = true; const unread = await ask(); acct.fail = false; acct.budget = 0; const off = await ask(); acct.budget = 50;
  expect([unread?.includes("could not be read") ?? false, off?.includes("budget for this kind of work is spent") ?? false, await ask()], "unreadable refuses, zero refuses, a real budget allows").toEqual([true, true, null]); }); });
