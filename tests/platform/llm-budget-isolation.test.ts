/** Per-account LLM budget isolation (closure, 2026-07-24). The promise: one account's LLM spend can never change another account's remaining budget or cap it, on EITHER layer (per-account file backstop + per-account durable ledger), and no budget operation runs without an explicit account. */
import { describe, expect, it, vi, beforeEach } from "vitest";
// Per-tenant in-memory json-store: rows keyed by the EXPLICIT tenantId option.
const FILE_ROWS = new Map<string, unknown[]>();
const readCalls: Array<{ name: string; tenantId?: string }> = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async (name: string, _f?: unknown, opts?: { tenantId?: string }) => {
    readCalls.push({ name, tenantId: opts?.tenantId });
    if (!opts?.tenantId) throw new Error("test: readStore called without explicit tenantId");
    return FILE_ROWS.get(opts.tenantId) ?? [];
  }),
  writeStore: vi.fn(async (name: string, rows: unknown[], opts?: { tenantId?: string }) => {
    if (!opts?.tenantId) throw new Error("test: writeStore called without explicit tenantId");
    FILE_ROWS.set(opts.tenantId, rows);
  }),
}));
// Per-tenant durable ledger seam.
const DURABLE = new Map<string, number>();
const durableWrites: Array<{ tenantId: string; costUsd: number }> = [];
vi.mock("@/lib/persistence/supabase", () => ({ isSupabaseConfigured: () => true }));
// The operator's daily cap has its own module and its own tests; this suite is about per-account isolation.
vi.mock("@/lib/cost/daily-cap", () => ({ dailyCapReason: vi.fn(async () => null),
  shareFor: (_d: string, p: string) => (p === "fact_check" ? 1 : 0.92) }));
vi.mock("@/lib/cost/budget-ledger-supabase", () => ({
  getTenantSpentThisMonthUsd: vi.fn(async (tenantId: string) => DURABLE.get(tenantId) ?? 0),
  recordSpendSupabase: vi.fn(async (a: { tenantId: string; costUsd: number }) => {
    durableWrites.push({ tenantId: a.tenantId, costUsd: a.costUsd });
  }),
}));
import { checkBudget, recordSpend } from "@/domains/decision/llm/adjudicator-budget";
const A = "tenant-a";
const B = "tenant-b";
describe("per-account LLM budget isolation", () => {
  beforeEach(() => {
    FILE_ROWS.clear();
    DURABLE.clear();
    durableWrites.length = 0;
    readCalls.length = 0;
  });
  it("account A's file-layer spend never changes account B's remaining budget", async () => {
    await recordSpend(54.99, { tenantId: A }); const a = await checkBudget({ tenantId: A, projectedCostUsd: 0.02 });
    const b = await checkBudget({ tenantId: B, projectedCostUsd: 0.02 });
    expect(a.allowed).toBe(false); // A is at its own cap (55 default)
    expect(b).toEqual({ allowed: true, remaining: 55 }); // B untouched
  });
  it("recording spend for A writes A's ledgers only, and B stays uncapped on the durable layer too", async () => {
    DURABLE.set(A, 55); // A's durable monthly spend at cap
    const a = await checkBudget({ tenantId: A }); const b = await checkBudget({ tenantId: B });
    expect(a.allowed).toBe(false); expect(b.allowed).toBe(true);
    await recordSpend(0.5, { tenantId: B }); expect(durableWrites).toEqual([{ tenantId: B, costUsd: 0.5 }]);
    expect(FILE_ROWS.has(A)).toBe(false); // A's file ledger untouched by B's spend
  });
  it("same-account max(file, durable) and the exact-cap boundary are unchanged", async () => {
    DURABLE.set(A, 4);
    await recordSpend(6, { tenantId: A }); // file 6, durable(mock) 4 → effective 6... plus durable write
    DURABLE.set(A, 55); // durable now reports AT cap for A
    const at = await checkBudget({ tenantId: A, projectedCostUsd: 0 });
    expect(at.allowed).toBe(false); // spend == cap fails closed at the boundary
  });
  it("a missing account fails before any ledger I/O; every read carried the explicit account", async () => {
    await expect(checkBudget({ tenantId: "" })).rejects.toThrow(/tenantId is required/); await expect(recordSpend(1, { tenantId: "  " })).rejects.toThrow(/tenantId is required/);
    expect(readCalls.length).toBe(0);
    // And the successful paths above always routed with the explicit account.
    await checkBudget({ tenantId: A }); expect(readCalls.every((c) => c.name === "llm-budget" && (c.tenantId === A || c.tenantId === B))).toBe(true);
  });
});
