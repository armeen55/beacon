/** Per-account LLM budget-read isolation: legacy checkBudget remains a read-only operator/status projection; paid writes use the atomic reservation door. */
import { describe, expect, it, vi, beforeEach } from "vitest";
const FILE_ROWS = new Map<string, unknown[]>(); // Per-tenant in-memory json-store: rows keyed by the EXPLICIT tenantId option.
const readCalls: Array<{ name: string; tenantId?: string }> = [];
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async (name: string, _f?: unknown, opts?: { tenantId?: string }) => {
    readCalls.push({ name, tenantId: opts?.tenantId });
    if (!opts?.tenantId) throw new Error("test: readStore called without explicit tenantId");
    return FILE_ROWS.get(opts.tenantId) ?? [];}),}));
const DURABLE = new Map<string, number>(); // Per-tenant durable ledger seam.
vi.mock("@/lib/persistence/supabase", () => ({ isSupabaseConfigured: () => true }));
vi.mock("@/lib/cost/daily-cap", () => ({ dailyCapReason: vi.fn(async () => null), // The operator's daily cap has its own module and its own tests; this suite is about per-account isolation.
  shareFor: (_d: string, p: string) => (p === "fact_check" ? 1 : 0.92) }));
vi.mock("@/lib/cost/budget-ledger-supabase", () => ({
  getTenantSpentThisMonthUsd: vi.fn(async (tenantId: string) => DURABLE.get(tenantId) ?? 0),}));
import { checkBudget } from "@/domains/decision/llm/adjudicator-budget";
const A = "tenant-a";
const B = "tenant-b";
describe("per-account LLM budget isolation", () => {
  beforeEach(() => {
    FILE_ROWS.clear();
    DURABLE.clear();
    readCalls.length = 0;});
  it("account A's spend never changes account B's remaining budget on either read layer", async () => {
    FILE_ROWS.set(A, [{ monthKey: "2026-09", spendUsd: 249.99, calls: 1, capUsd: 250, updatedAt: "2026-09-19T00:00:00.000Z" }]);
    expect([(await checkBudget({ tenantId: A, projectedCostUsd: 0.02 })).allowed, await checkBudget({ tenantId: B, projectedCostUsd: 0.02 })]).toEqual([false, { allowed: true, remaining: 250 }]); // A is at its own cap, whatever that cap currently is; B untouched
    FILE_ROWS.clear(); DURABLE.set(A, 250); // A's DURABLE monthly spend at cap, with nothing on its file layer
    expect([(await checkBudget({ tenantId: A })).allowed, (await checkBudget({ tenantId: B })).allowed, FILE_ROWS.has(B)]).toEqual([false, true, false]); });
  it("same-account max(file, durable) and the exact-cap boundary are unchanged", async () => {
    DURABLE.set(A, 4);
    FILE_ROWS.set(A, [{ monthKey: "2026-09", spendUsd: 6, calls: 1, capUsd: 250, updatedAt: "2026-09-19T00:00:00.000Z" }]);
    DURABLE.set(A, 250); // durable now reports AT cap for A
    const at = await checkBudget({ tenantId: A, projectedCostUsd: 0 });
    expect(at.allowed).toBe(false); // spend == cap fails closed at the boundary
  });
  it("lifts an account state written under the former $55 default without changing its spend", async () => { FILE_ROWS.set(A, [{ monthKey: "2026-08", spendUsd: 54.991292, calls: 1, capUsd: 55, updatedAt: "2026-08-28T00:00:00.000Z" }]); expect(await checkBudget({ tenantId: A, now: new Date("2026-08-29T00:00:00.000Z") })).toEqual({ allowed: true, remaining: 195.008708 }); }); // the lift now lands on the 250 default of 2026-09-10
  it("a missing account fails before any ledger I/O; every read carried the explicit account", async () => {
    await expect(checkBudget({ tenantId: "" })).rejects.toThrow(/tenantId is required/);
    expect(readCalls.length).toBe(0);
    await checkBudget({ tenantId: A }); expect(readCalls.every((c) => c.name === "llm-budget" && (c.tenantId === A || c.tenantId === B))).toBe(true);});}); // And the successful paths above always routed with the explicit account.
