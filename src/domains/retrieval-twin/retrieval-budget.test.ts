import { describe, it, expect, vi, beforeEach } from "vitest";

let stored: unknown[] = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: async () => stored,
  writeStore: async (_name: string, data: unknown[]) => {
    stored = data;
  },
}));

let supabaseConfigured = false;
vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => supabaseConfigured,
}));

let ambientTenantId = "tenant-test";
vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: async () => ambientTenantId,
}));

const getSpentMock = vi.fn();
const recordSpendMock = vi.fn();
vi.mock("@/lib/cost/budget-ledger-supabase", () => ({
  getTenantSpentThisMonthUsd: (...args: unknown[]) => getSpentMock(...args),
  recordSpendSupabase: (...args: unknown[]) => recordSpendMock(...args),
}));

import { checkBudget, recordSpend, getBudgetState, setBudgetCap, isOverRetrievalBudget, currentMonthKey } from "./retrieval-budget";

const NOW = new Date("2026-07-02T12:00:00Z");

beforeEach(() => {
  vi.clearAllMocks();
  stored = [];
  supabaseConfigured = false;
  ambientTenantId = "tenant-test";
  getSpentMock.mockResolvedValue(null);
  recordSpendMock.mockResolvedValue(undefined);
});

describe("isOverRetrievalBudget (pure)", () => {
  it("fails closed AT the cap (spend already equals cap)", () => {
    expect(isOverRetrievalBudget(2, 0, 2)).toBe(true);
  });
  it("blocks a call whose projected cost would cross the cap", () => {
    expect(isOverRetrievalBudget(1.9, 0.2, 2)).toBe(true);
  });
  it("allows a call that lands exactly on the cap from below", () => {
    expect(isOverRetrievalBudget(1.9, 0.1, 2)).toBe(false);
  });
  it("allows well under cap", () => {
    expect(isOverRetrievalBudget(0, 0.01, 2)).toBe(false);
  });
});

describe("checkBudget / recordSpend (file ledger only, Supabase unconfigured)", () => {
  it("starts with a fresh $2 cap and $0 spent", async () => {
    const r = await checkBudget({ now: NOW });
    expect(r.allowed).toBe(true);
    if (r.allowed) expect(r.remaining).toBe(2);
  });

  it("records spend and reduces remaining budget", async () => {
    await recordSpend(0.01, { now: NOW });
    const state = await getBudgetState(NOW);
    expect(state.spendUsd).toBeCloseTo(0.01, 6);
    expect(state.calls).toBe(1);
  });

  it("blocks once accumulated spend reaches the cap (fail closed)", async () => {
    await setBudgetCap(0.02, NOW);
    await recordSpend(0.02, { now: NOW });
    const r = await checkBudget({ now: NOW });
    expect(r.allowed).toBe(false);
    if (!r.allowed) expect(r.reason).toMatch(/budget cap reached/i);
  });

  it("blocks a projected call that would push spend over the cap", async () => {
    await setBudgetCap(0.02, NOW);
    await recordSpend(0.015, { now: NOW });
    const r = await checkBudget({ now: NOW, projectedCostUsd: 0.01 });
    expect(r.allowed).toBe(false);
  });

  it("resets spend when the month rolls over but keeps the configured cap", async () => {
    await setBudgetCap(1.5, NOW);
    await recordSpend(1, { now: NOW });
    const nextMonth = new Date("2026-08-01T00:00:00Z");
    const state = await getBudgetState(nextMonth);
    expect(state.spendUsd).toBe(0);
    expect(state.capUsd).toBe(1.5);
    expect(state.monthKey).toBe(currentMonthKey(nextMonth));
  });
});

describe("checkBudget propagates an unreadable state (caller must fail closed)", () => {
  it("rejects rather than silently returning allowed:true when the store throws", async () => {
    // Simulate an unreadable store by making readStore throw for this one call. Matches
    // structured-drafter.ts's contract: it wraps checkBudget in a .catch(() => blocked),
    // so this module's job is only to NOT swallow the error into a false "allowed".
    const jsonStore = await import("@/lib/persistence/json-store");
    const original = jsonStore.readStore;
    jsonStore.readStore = async () => {
      throw new Error("disk unreadable");
    };
    await expect(checkBudget({ now: NOW })).rejects.toThrow();
    jsonStore.readStore = original;
  });
});

describe("checkBudget takes the GREATER of file spend and durable Supabase spend", () => {
  it("blocks when the durable ledger shows more spend than the file ledger (Vercel ephemeral-disk case)", async () => {
    supabaseConfigured = true;
    await setBudgetCap(1, NOW);
    // File ledger shows only $0.10 spent (e.g. disk was wiped), but the durable
    // Supabase ledger shows the tenant already spent $1 this month.
    await recordSpend(0.1, { now: NOW });
    getSpentMock.mockResolvedValue(1);
    const r = await checkBudget({ now: NOW });
    expect(r.allowed).toBe(false);
  });

  it("falls back to file spend when the durable read errors (returns null)", async () => {
    supabaseConfigured = true;
    getSpentMock.mockResolvedValue(null);
    await setBudgetCap(2, NOW);
    await recordSpend(0.01, { now: NOW });
    const r = await checkBudget({ now: NOW });
    expect(r.allowed).toBe(true);
  });
});

describe("recordSpend mirrors to the durable ledger when Supabase is configured", () => {
  it("calls recordSpendSupabase with the platform tag 'other'", async () => {
    supabaseConfigured = true;
    await recordSpend(0.005, { now: NOW });
    expect(recordSpendMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant-test", platform: "other", costUsd: 0.005 }));
  });

  it("never throws even when the durable write fails", async () => {
    supabaseConfigured = true;
    recordSpendMock.mockRejectedValue(new Error("supabase down"));
    await expect(recordSpend(0.005, { now: NOW })).resolves.toBeUndefined();
  });

  it("does not touch the durable ledger when Supabase is unconfigured", async () => {
    supabaseConfigured = false;
    await recordSpend(0.005, { now: NOW });
    expect(recordSpendMock).not.toHaveBeenCalled();
  });
});
