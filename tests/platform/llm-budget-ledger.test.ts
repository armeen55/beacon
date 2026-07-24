/**
 * Durable per-account LLM budget ledger: validation before I/O, insert/atomic
 * increment upserts, and never-throws (recording can't block a paid call).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { recordSpendSupabase } from "@/lib/cost/budget-ledger-supabase";

type MaybeSingleResult = { data: Record<string, unknown> | null; error: { message: string } | null };
type ListResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type MutationResult = { error: { message: string } | null };

const SUPABASE_STATE = {
  selectResult: { data: null, error: null } as MaybeSingleResult,
  listResult: { data: [], error: null } as ListResult,
  insertResult: { error: null } as MutationResult,
  updateResult: { error: null } as MutationResult,
  insertCalls: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<Record<string, unknown>>,
  fromTablesCalled: [] as string[],
};

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      SUPABASE_STATE.fromTablesCalled.push(table);
      return {
        select(_cols: string) {
          const selectChain = {
            eq() {
              return selectChain;
            },
            async maybeSingle() {
              return SUPABASE_STATE.selectResult;
            },
            then(resolve: (v: ListResult) => unknown) {
              return Promise.resolve(SUPABASE_STATE.listResult).then(resolve);
            },
          };
          return selectChain;
        },
        insert(row: Record<string, unknown>) {
          SUPABASE_STATE.insertCalls.push(row);
          return Promise.resolve(SUPABASE_STATE.insertResult);
        },
        update(patch: Record<string, unknown>) {
          const updateChain = {
            eq() {
              return updateChain;
            },
            then(resolve: (v: MutationResult) => unknown) {
              SUPABASE_STATE.updateCalls.push(patch);
              return Promise.resolve(SUPABASE_STATE.updateResult).then(resolve);
            },
          };
          return updateChain;
        },
      };
    },
  }),
}));

let warnSpy: ReturnType<typeof vi.spyOn>;
let prevFlag: string | undefined;

beforeEach(() => {
  SUPABASE_STATE.selectResult = { data: null, error: null };
  SUPABASE_STATE.listResult = { data: [], error: null };
  SUPABASE_STATE.insertResult = { error: null };
  SUPABASE_STATE.updateResult = { error: null };
  SUPABASE_STATE.insertCalls = [];
  SUPABASE_STATE.updateCalls = [];
  SUPABASE_STATE.fromTablesCalled = [];
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  prevFlag = process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE;
});

afterEach(() => {
  warnSpy.mockRestore();
  if (prevFlag === undefined) delete process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE;
  else process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = prevFlag;
});

describe("recordSpendSupabase — the always-on durable per-account writer", () => {
  it("inserts a new row when one does not exist", async () => {
    await recordSpendSupabase({
      tenantId: "tenant-fixture-local",
      platform: "perplexity",
      costUsd: 0.0917,
      promptCount: 100,
      chunkCount: 1,
      runId: "pollrun-XYZ",
    });
    expect(SUPABASE_STATE.insertCalls).toHaveLength(1);
    const inserted = SUPABASE_STATE.insertCalls[0]!;
    expect(inserted.tenant_id).toBe("tenant-fixture-local");
    expect(inserted.spent_usd).toBe(0.0917);
    expect(inserted.call_count).toBe(1);
    expect(SUPABASE_STATE.updateCalls).toHaveLength(0);
  });

  it("updates an existing row with atomic increments", async () => {
    SUPABASE_STATE.selectResult = {
      data: { spent_usd: "0.1", call_count: 2, prompt_count: 50, chunk_count: 1 },
      error: null,
    };
    await recordSpendSupabase({
      tenantId: "tenant-fixture-local",
      platform: "openai",
      costUsd: 2.88,
      promptCount: 100,
      chunkCount: 1,
    });
    expect(SUPABASE_STATE.updateCalls).toHaveLength(1);
    const patch = SUPABASE_STATE.updateCalls[0] as Record<string, number | string | null>;
    expect(patch.spent_usd).toBeCloseTo(2.98, 5);
    expect(patch.call_count).toBe(3);
    expect(patch.prompt_count).toBe(150);
    expect(SUPABASE_STATE.insertCalls).toHaveLength(0);
  });

  it("a Supabase failure logs and returns; recording never blocks the paid call that already happened", async () => {
    SUPABASE_STATE.selectResult = { data: null, error: { message: "boom" } };
    await expect(
      recordSpendSupabase({ tenantId: "tenant-fixture-local", platform: "perplexity", costUsd: 0.05 }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    expect(SUPABASE_STATE.insertCalls).toEqual([]);
  });

  const badInputs: Array<{ name: string; input: Parameters<typeof recordSpendSupabase>[0] }> = [
    { name: "empty tenantId", input: { tenantId: "", platform: "perplexity", costUsd: 0.05 } },
    { name: "invalid platform", input: { tenantId: "t1", platform: "claude" as never, costUsd: 0.05 } },
    { name: "negative costUsd", input: { tenantId: "t1", platform: "perplexity", costUsd: -0.01 } },
    { name: "non-finite costUsd", input: { tenantId: "t1", platform: "perplexity", costUsd: NaN } },
    { name: "non-integer promptCount", input: { tenantId: "t1", platform: "perplexity", costUsd: 0.05, promptCount: 1.5 } },
  ];
  for (const c of badInputs) {
    it(`rejects ${c.name}: warns + no Supabase round-trip`, async () => {
      await recordSpendSupabase(c.input);
      expect(warnSpy).toHaveBeenCalled();
      expect(SUPABASE_STATE.fromTablesCalled).toEqual([]);
    });
  }
});
