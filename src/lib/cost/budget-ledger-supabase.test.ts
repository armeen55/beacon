/**
 * Phase 2 Stage B.2 — recordSpendDualWrite contract tests.
 *
 * Pins the 7 invariants from the operator brief:
 *   1. Flag unset → no Supabase write attempted.
 *   2. Flag set + valid input → upserts (insert when row absent, update
 *      when row exists, atomic increments to counters).
 *   3. Supabase failure logs but does NOT throw.
 *   4. Validation rejects empty tenantId, invalid platform, negative or
 *      non-finite cost, non-integer/negative counters — BEFORE any
 *      Supabase round-trip.
 *   5. Poll behavior is unchanged with flag off (covered by:
 *      `dual-write returns immediately, no client constructed`).
 *   6. Spend snapshot read handles empty/unavailable table calmly.
 *   7. No enforcement/skip behavior — recordSpendDualWrite cannot
 *      block a poll. (Tested via "never throws" + return value void.)
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  recordSpendDualWrite,
  readSpendSnapshotForDate,
  isBudgetLedgerDualWriteEnabled,
} from "./budget-ledger-supabase";

// ── Supabase admin mock ──

type MaybeSingleResult = { data: Record<string, unknown> | null; error: { message: string } | null };
type ListResult = { data: Array<Record<string, unknown>> | null; error: { message: string } | null };
type MutationResult = { error: { message: string } | null };

const SUPABASE_STATE = {
  selectResult: { data: null, error: null } as MaybeSingleResult,
  listResult: { data: [], error: null } as ListResult,
  insertResult: { error: null } as MutationResult,
  updateResult: { error: null } as MutationResult,
  // Recording surfaces.
  selectCalls: [] as Array<Record<string, unknown>>,
  insertCalls: [] as Array<Record<string, unknown>>,
  updateCalls: [] as Array<Record<string, unknown>>,
  // For "should NOT call Supabase" assertions.
  fromTablesCalled: [] as string[],
};

vi.mock("@/lib/persistence/supabase", () => ({
  getSupabaseAdmin: () => ({
    from(table: string) {
      SUPABASE_STATE.fromTablesCalled.push(table);
      return {
        select(_cols: string) {
          let filter: Record<string, unknown> = {};
          const selectChain = {
            eq(col: string, val: unknown) {
              filter = { ...filter, [col]: val };
              return selectChain;
            },
            async maybeSingle() {
              SUPABASE_STATE.selectCalls.push(filter);
              return SUPABASE_STATE.selectResult;
            },
            // For readSpendSnapshotForDate: terminal `.eq()` returns the list directly.
            then(resolve: (v: ListResult) => unknown) {
              SUPABASE_STATE.selectCalls.push(filter);
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
          let filter: Record<string, unknown> = {};
          const updateChain = {
            eq(col: string, val: unknown) {
              filter = { ...filter, [col]: val };
              return updateChain;
            },
            then(resolve: (v: MutationResult) => unknown) {
              SUPABASE_STATE.updateCalls.push({ patch, filter });
              return Promise.resolve(SUPABASE_STATE.updateResult).then(resolve);
            },
          };
          return updateChain;
        },
      };
    },
  }),
}));

function resetState() {
  SUPABASE_STATE.selectResult = { data: null, error: null };
  SUPABASE_STATE.listResult = { data: [], error: null };
  SUPABASE_STATE.insertResult = { error: null };
  SUPABASE_STATE.updateResult = { error: null };
  SUPABASE_STATE.selectCalls = [];
  SUPABASE_STATE.insertCalls = [];
  SUPABASE_STATE.updateCalls = [];
  SUPABASE_STATE.fromTablesCalled = [];
}

let warnSpy: ReturnType<typeof vi.spyOn>;
let prevFlag: string | undefined;

beforeEach(() => {
  resetState();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  prevFlag = process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE;
});

afterEach(() => {
  warnSpy.mockRestore();
  if (prevFlag === undefined) delete process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE;
  else process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = prevFlag;
});

// ── 1. Flag unset → no write attempted ──

describe("recordSpendDualWrite — Invariant 1: flag-gated", () => {
  it("flag unset → no Supabase write attempted", async () => {
    delete process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE;
    expect(isBudgetLedgerDualWriteEnabled()).toBe(false);
    await recordSpendDualWrite({
      tenantId: "tenant-ritz-founder",
      platform: "perplexity",
      costUsd: 0.0917,
    });
    expect(SUPABASE_STATE.fromTablesCalled).toEqual([]);
    expect(SUPABASE_STATE.insertCalls).toEqual([]);
    expect(SUPABASE_STATE.updateCalls).toEqual([]);
  });

  it("flag set to '0' or '' → still no write", async () => {
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "0";
    expect(isBudgetLedgerDualWriteEnabled()).toBe(false);
    await recordSpendDualWrite({
      tenantId: "tenant-ritz-founder",
      platform: "perplexity",
      costUsd: 0.05,
    });
    expect(SUPABASE_STATE.fromTablesCalled).toEqual([]);
  });

  it("flag set to exactly '1' → enabled", async () => {
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "1";
    expect(isBudgetLedgerDualWriteEnabled()).toBe(true);
  });
});

// ── 2. Flag set → upserts ──

describe("recordSpendDualWrite — Invariant 2: upserts when enabled", () => {
  beforeEach(() => {
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "1";
  });

  it("inserts a new row when one does not exist", async () => {
    SUPABASE_STATE.selectResult = { data: null, error: null };
    await recordSpendDualWrite({
      tenantId: "tenant-ritz-founder",
      platform: "perplexity",
      costUsd: 0.0917,
      promptCount: 100,
      chunkCount: 1,
      runId: "pollrun-XYZ",
      metadata: { scope_label: "test" },
    });
    expect(SUPABASE_STATE.insertCalls).toHaveLength(1);
    const inserted = SUPABASE_STATE.insertCalls[0];
    expect(inserted.tenant_id).toBe("tenant-ritz-founder");
    expect(inserted.platform).toBe("perplexity");
    expect(inserted.spent_usd).toBe(0.0917);
    expect(inserted.call_count).toBe(1);
    expect(inserted.prompt_count).toBe(100);
    expect(inserted.chunk_count).toBe(1);
    expect(inserted.last_run_id).toBe("pollrun-XYZ");
    expect(inserted.metadata).toEqual({ scope_label: "test" });
    expect(SUPABASE_STATE.updateCalls).toHaveLength(0);
  });

  it("updates an existing row with atomic increments", async () => {
    SUPABASE_STATE.selectResult = {
      data: {
        spent_usd: "0.1",
        call_count: 2,
        prompt_count: 50,
        chunk_count: 1,
      },
      error: null,
    };
    await recordSpendDualWrite({
      tenantId: "tenant-ritz-founder",
      platform: "openai",
      costUsd: 2.88,
      promptCount: 100,
      chunkCount: 1,
      runId: "pollrun-ABC",
    });
    expect(SUPABASE_STATE.updateCalls).toHaveLength(1);
    const { patch } = SUPABASE_STATE.updateCalls[0] as {
      patch: Record<string, number | string | null>;
    };
    expect(patch.spent_usd).toBeCloseTo(2.98, 5);
    expect(patch.call_count).toBe(3);
    expect(patch.prompt_count).toBe(150);
    expect(patch.chunk_count).toBe(2);
    expect(patch.last_run_id).toBe("pollrun-ABC");
    expect(SUPABASE_STATE.insertCalls).toHaveLength(0);
  });
});

// ── 3. Supabase failure logs but does not throw ──

describe("recordSpendDualWrite — Invariant 3: never throws", () => {
  beforeEach(() => {
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "1";
  });

  it("select error logs and returns; never throws", async () => {
    SUPABASE_STATE.selectResult = { data: null, error: { message: "boom" } };
    await expect(
      recordSpendDualWrite({
        tenantId: "tenant-ritz-founder",
        platform: "perplexity",
        costUsd: 0.05,
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    expect(SUPABASE_STATE.insertCalls).toEqual([]);
    expect(SUPABASE_STATE.updateCalls).toEqual([]);
  });

  it("insert error logs and returns; never throws", async () => {
    SUPABASE_STATE.selectResult = { data: null, error: null };
    SUPABASE_STATE.insertResult = { error: { message: "constraint violation" } };
    await expect(
      recordSpendDualWrite({
        tenantId: "tenant-ritz-founder",
        platform: "perplexity",
        costUsd: 0.05,
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });

  it("update error logs and returns; never throws", async () => {
    SUPABASE_STATE.selectResult = {
      data: { spent_usd: "0.01", call_count: 1, prompt_count: 10, chunk_count: 1 },
      error: null,
    };
    SUPABASE_STATE.updateResult = { error: { message: "lock timeout" } };
    await expect(
      recordSpendDualWrite({
        tenantId: "tenant-ritz-founder",
        platform: "perplexity",
        costUsd: 0.05,
      }),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
  });
});

// ── 4. Validation rejects bad input BEFORE round-trip ──

describe("recordSpendDualWrite — Invariant 4: validation rejects bad input", () => {
  beforeEach(() => {
    process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE = "1";
  });

  const cases: Array<{
    name: string;
    input: Parameters<typeof recordSpendDualWrite>[0];
  }> = [
    {
      name: "empty tenantId",
      input: { tenantId: "", platform: "perplexity", costUsd: 0.05 },
    },
    {
      name: "whitespace-only tenantId",
      input: { tenantId: "   ", platform: "perplexity", costUsd: 0.05 },
    },
    {
      name: "invalid platform",
      input: {
        tenantId: "t1",
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        platform: "claude" as any,
        costUsd: 0.05,
      },
    },
    {
      name: "negative costUsd",
      input: { tenantId: "t1", platform: "perplexity", costUsd: -0.01 },
    },
    {
      name: "non-finite costUsd (NaN)",
      input: { tenantId: "t1", platform: "perplexity", costUsd: NaN },
    },
    {
      name: "non-finite costUsd (Infinity)",
      input: { tenantId: "t1", platform: "perplexity", costUsd: Infinity },
    },
    {
      name: "non-integer promptCount",
      input: {
        tenantId: "t1",
        platform: "perplexity",
        costUsd: 0.05,
        promptCount: 1.5,
      },
    },
    {
      name: "negative chunkCount",
      input: {
        tenantId: "t1",
        platform: "perplexity",
        costUsd: 0.05,
        chunkCount: -1,
      },
    },
  ];

  for (const c of cases) {
    it(`rejects ${c.name}: warns + no Supabase write`, async () => {
      await recordSpendDualWrite(c.input);
      expect(warnSpy).toHaveBeenCalled();
      expect(SUPABASE_STATE.fromTablesCalled).toEqual([]);
      expect(SUPABASE_STATE.insertCalls).toEqual([]);
      expect(SUPABASE_STATE.updateCalls).toEqual([]);
    });
  }
});

// ── 6. Spend snapshot reader ──

describe("readSpendSnapshotForDate — Invariant 6: calm fallback", () => {
  it("rejects malformed date string with warn + empty array", async () => {
    const out = await readSpendSnapshotForDate("not-a-date");
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
    expect(SUPABASE_STATE.fromTablesCalled).toEqual([]);
  });

  it("returns [] when ledger is empty", async () => {
    SUPABASE_STATE.listResult = { data: [], error: null };
    const out = await readSpendSnapshotForDate("2026-05-09");
    expect(out).toEqual([]);
  });

  it("returns [] when Supabase errors; never throws", async () => {
    SUPABASE_STATE.listResult = { data: null, error: { message: "rls denied" } };
    const out = await readSpendSnapshotForDate("2026-05-09");
    expect(out).toEqual([]);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("maps rows with null daily_cap_usd to null cap", async () => {
    SUPABASE_STATE.listResult = {
      data: [
        {
          tenant_id: "tenant-ritz-founder",
          platform: "perplexity",
          spent_usd: "0.0917",
          daily_cap_usd: null,
          prompt_count: 100,
        },
      ],
      error: null,
    };
    const out = await readSpendSnapshotForDate("2026-05-09");
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({
      tenant_id: "tenant-ritz-founder",
      platform: "perplexity",
      spent_usd: 0.0917,
      cap_usd: null,
      prompt_count: 100,
    });
  });
});

// ── 7. Read snapshot is NOT flag-gated (canary safety) ──

describe("readSpendSnapshotForDate — Invariant 7: not flag-gated", () => {
  it("works with the dual-write flag unset", async () => {
    delete process.env.BEACON_BUDGET_LEDGER_DUAL_WRITE;
    SUPABASE_STATE.listResult = { data: [], error: null };
    const out = await readSpendSnapshotForDate("2026-05-09");
    expect(out).toEqual([]);
    // It DID call Supabase to do the read — the flag does not gate reads.
    expect(SUPABASE_STATE.fromTablesCalled).toContain("llm_budget_ledger");
  });
});
