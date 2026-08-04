/** The durable per-account LLM spend writer, as its two PROMISES rather than its row mechanics: money already
 *  spent is added to that account's own running total, and a ledger I could not write NEVER blocks or breaks the
 *  paid call that already happened. Bad input is refused before the database is touched at all. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { recordSpendSupabase } from "@/lib/cost/budget-ledger-supabase";

const db = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, readError: null as { message: string } | null, wrote: [] as Record<string, unknown>[], tables: [] as string[] }));
vi.mock("@/lib/persistence/supabase", () => ({ getSupabaseAdmin: () => ({ from(table: string) {
  db.tables.push(table);
  const chain = { eq: () => chain, maybeSingle: async () => ({ data: db.row, error: db.readError }),
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: db.row ? [db.row] : [], error: db.readError }).then(r) };
  const wrote = (patch: Record<string, unknown>) => { db.wrote.push(patch); const w = { eq: () => w, then: (r: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(r) }; return w; };
  return { select: () => chain, insert: wrote, update: wrote }; } }) }));

beforeEach(() => { db.row = null; db.readError = null; db.wrote = []; db.tables = []; vi.spyOn(console, "warn").mockImplementation(() => {}); });

describe("the durable per-account LLM spend writer", () => {
  it("adds what was just spent to that account's own running total, opening it when the account has spent nothing yet", async () => {
    await recordSpendSupabase({ tenantId: "acct-a", platform: "perplexity", costUsd: 0.0917, promptCount: 100, chunkCount: 1, runId: "run-x" });
    expect([db.wrote[0]!.tenant_id, db.wrote[0]!.spent_usd, db.wrote[0]!.call_count]).toEqual(["acct-a", 0.0917, 1]);
    db.row = { spent_usd: "0.1", call_count: 2, prompt_count: 50, chunk_count: 1 }; db.wrote = [];
    await recordSpendSupabase({ tenantId: "acct-a", platform: "openai", costUsd: 2.88, promptCount: 100, chunkCount: 1 });
    expect([Number(db.wrote[0]!.spent_usd).toFixed(2), db.wrote[0]!.call_count, db.wrote[0]!.prompt_count]).toEqual(["2.98", 3, 150]); });
  it("answers false and writes nothing when the ledger cannot be read, so the paid call it is recording is never broken by it", async () => {
    db.readError = { message: "boom" };
    await expect(recordSpendSupabase({ tenantId: "acct-a", platform: "perplexity", costUsd: 0.05 })).resolves.toBe(false);
    expect(db.wrote).toEqual([]); });
  it.each([["no account", { tenantId: "", platform: "perplexity", costUsd: 0.05 }], ["an engine that cannot be billed", { tenantId: "t1", platform: "claude", costUsd: 0.05 }],
    ["a negative amount", { tenantId: "t1", platform: "perplexity", costUsd: -0.01 }], ["an amount that is not a number", { tenantId: "t1", platform: "perplexity", costUsd: NaN }],
    ["a fractional count", { tenantId: "t1", platform: "perplexity", costUsd: 0.05, promptCount: 1.5 }]] as const)(
    "refuses %s before the database is touched at all", async (_name, input) => {
      await recordSpendSupabase(input as Parameters<typeof recordSpendSupabase>[0]);
      expect(db.tables).toEqual([]); });
});
