/**
 * PLATFORM — LLM budget ledger dual-write (Core 100K terminal suite; trimmed
 * from src/lib/cost/budget-ledger-supabase.test.ts).
 *
 * Spend-cap-adjacent invariants: flag-gated writes, atomic increments,
 * never-throws (recording can never block a poll), validation BEFORE any
 * Supabase round-trip, and the calm snapshot reader. The fail-closed spend
 * CAP itself is pinned in tests/platform/critical-fix-regression.test.ts
 * (budget-check throw ⇒ allowed:false).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  recordSpendDualWrite,
  readSpendSnapshotForDate,
  isBudgetLedgerDualWriteEnabled,
} from "@/lib/cost/budget-ledger-supabase";

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

describe("recordSpendDualWrite — flag-gated", () => {
  it("flag unset (or '0') → no Supabase write attempted at all", async () => {
    delete process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE;
    expect(isBudgetLedgerDualWriteEnabled()).toBe(false);
    await recordSpendDualWrite({ tenantId: "tenant-fixture-local", platform: "perplexity", costUsd: 0.0917 });
    expect(SUPABASE_STATE.fromTablesCalled).toEqual([]);
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "0";
    expect(isBudgetLedgerDualWriteEnabled()).toBe(false);
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "1";
    expect(isBudgetLedgerDualWriteEnabled()).toBe(true);
  });
});

describe("recordSpendDualWrite — upserts when enabled", () => {
  beforeEach(() => {
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "1";
  });

  it("inserts a new row when one does not exist", async () => {
    await recordSpendDualWrite({
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
    await recordSpendDualWrite({
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
});

describe("recordSpendDualWrite — never throws, validates before I/O", () => {
  beforeEach(() => {
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "1";
  });

  it("a Supabase failure logs and returns; recording can never block a poll", async () => {
    SUPABASE_STATE.selectResult = { data: null, error: { message: "boom" } };
    await expect(
      recordSpendDualWrite({ tenantId: "tenant-fixture-local", platform: "perplexity", costUsd: 0.05 }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    expect(SUPABASE_STATE.insertCalls).toEqual([]);
  });

  const badInputs: Array<{ name: string; input: Parameters<typeof recordSpendDualWrite>[0] }> = [
    { name: "empty tenantId", input: { tenantId: "", platform: "perplexity", costUsd: 0.05 } },
    { name: "invalid platform", input: { tenantId: "t1", platform: "claude" as never, costUsd: 0.05 } },
    { name: "negative costUsd", input: { tenantId: "t1", platform: "perplexity", costUsd: -0.01 } },
    { name: "non-finite costUsd", input: { tenantId: "t1", platform: "perplexity", costUsd: NaN } },
    { name: "non-integer promptCount", input: { tenantId: "t1", platform: "perplexity", costUsd: 0.05, promptCount: 1.5 } },
  ];
  for (const c of badInputs) {
    it(`rejects ${c.name}: warns + no Supabase round-trip`, async () => {
      await recordSpendDualWrite(c.input);
      expect(warnSpy).toHaveBeenCalled();
      expect(SUPABASE_STATE.fromTablesCalled).toEqual([]);
    });
  }
});

describe("readSpendSnapshotForDate — calm fallback, not flag-gated", () => {
  it("rejects a malformed date and returns [] on a Supabase error; never throws", async () => {
    expect(await readSpendSnapshotForDate("not-a-date")).toEqual([]);
    expect(SUPABASE_STATE.fromTablesCalled).toEqual([]);
    SUPABASE_STATE.listResult = { data: null, error: { message: "rls denied" } };
    expect(await readSpendSnapshotForDate("2026-05-09")).toEqual([]);
  });

  it("maps rows (null daily_cap_usd → null cap) and reads even with the write flag unset", async () => {
    delete process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE;
    SUPABASE_STATE.listResult = {
      data: [
        { tenant_id: "tenant-fixture-local", platform: "perplexity", spent_usd: "0.0917", daily_cap_usd: null, prompt_count: 100 },
      ],
      error: null,
    };
    const out = await readSpendSnapshotForDate("2026-05-09");
    expect(out).toEqual([
      { tenant_id: "tenant-fixture-local", platform: "perplexity", spent_usd: 0.0917, cap_usd: null, prompt_count: 100 },
    ]);
    expect(SUPABASE_STATE.fromTablesCalled).toContain("llm_budget_ledger");
  });
});
