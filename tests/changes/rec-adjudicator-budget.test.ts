/** Adjudicator budget: durable ledger + fail-closed boundary (Core 100K Phase 6 merge; spend-caps pin). */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import {
  checkBudget,
  recordSpend,
} from "@/domains/recommendations/adjudicator-budget";
import { isOverAdjudicatorBudget } from "@/domains/recommendations/adjudicator-budget";

// ===== from tests/domains/recommendations/adjudicator-budget-durable.test.ts =====
/**
 * audit-3 #1 (2026-06-22) — the adjudicator monthly cap must be DURABLE.
 *
 * On Vercel (and every GitHub Actions run) `json-store` no-ops disk writes, so
 * the file-backed `.data/llm-budget.json` reads back 0 forever. Pre-fix
 * `checkBudget`/`recordSpend` consulted ONLY the file, so the monthly cap
 * silently failed OPEN in production — paid adjudicator calls could run
 * unbounded.
 *
 * The fix consults the durable Supabase `llm_budget_ledger` (platform
 * `adjudicator-openai`): `checkBudget` blocks on max(file, durable) monthly
 * spend, and `recordSpend` mirrors the spend into the durable ledger. These
 * tests mock the persistence + DB layers so we exercise the wiring without a
 * real Supabase.
 */

// File ledger always reads back EMPTY (the Vercel reality: writes no-op, the
// store reads 0). This also satisfies the global-store hermetic isolation
// architecture invariant (vi.mock of json-store).
vi.mock("@/lib/persistence/json-store", () => ({
  readStore: vi.fn(async () => []),
  writeStore: vi.fn(async () => {}),
}));

// DB is "configured" so the durable path is exercised.
vi.mock("@/lib/persistence/supabase", () => ({
  isSupabaseConfigured: () => true,
}));

vi.mock("@/lib/tenant-context", () => ({
  currentTenantId: vi.fn(async () => "tenant-iranopedia"),
}));

const getTenantSpentThisMonthUsd = vi.fn();
const recordSpendSupabase = vi.fn(async (_input: unknown) => {});
vi.mock("@/lib/cost/budget-ledger-supabase", () => ({
  getTenantSpentThisMonthUsd: (
    tenantId: string,
    now?: Date,
    platform?: string,
  ) => getTenantSpentThisMonthUsd(tenantId, now, platform),
  recordSpendSupabase: (input: unknown) => recordSpendSupabase(input),
}));


const NOW = new Date("2026-06-22T12:00:00.000Z");

beforeEach(() => {
  getTenantSpentThisMonthUsd.mockReset();
  recordSpendSupabase.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("adjudicator cap — durable (audit-3 #1)", () => {
  it("BLOCKS when durable monthly spend is over cap even though the file reads 0", async () => {
    // The Vercel fail-open: file spend 0 (mocked empty), durable spend 11 > $10.
    getTenantSpentThisMonthUsd.mockResolvedValue(11);
    const result = await checkBudget({ now: NOW });
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("11.0000");
    }
  });

  it("queries the durable ledger scoped to the adjudicator platform", async () => {
    getTenantSpentThisMonthUsd.mockResolvedValue(0);
    await checkBudget({ now: NOW });
    expect(getTenantSpentThisMonthUsd).toHaveBeenCalledWith(
      "tenant-iranopedia",
      NOW,
      "adjudicator-openai",
    );
  });

  it("allows when durable spend is under cap (file also 0)", async () => {
    getTenantSpentThisMonthUsd.mockResolvedValue(3);
    const result = await checkBudget({ now: NOW });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.remaining).toBeCloseTo(7);
  });

  it("falls back to the file ledger when the durable read errors (null)", async () => {
    // null = read error → must not crash, must not block (file is 0 here).
    getTenantSpentThisMonthUsd.mockResolvedValue(null);
    const result = await checkBudget({ now: NOW });
    expect(result.allowed).toBe(true);
  });

  it("recordSpend mirrors into the durable ledger on the adjudicator platform", async () => {
    await recordSpend(0.0123, { now: NOW });
    expect(recordSpendSupabase).toHaveBeenCalledWith({
      tenantId: "tenant-iranopedia",
      platform: "adjudicator-openai",
      costUsd: 0.0123,
    });
  });
});

// ===== from tests/domains/recommendations/adjudicator-budget-boundary.test.ts =====
/**
 * wave-10 (2026-06-14) — adjudicator budget boundary is fail-closed AT the cap.
 *
 * Pre-fix `checkBudget` used only `spendUsd + projected > capUsd`. With the
 * default `projected = 0` (adjudicate.ts calls checkBudget without a projected
 * cost), a call made at spend EXACTLY == cap slipped through (`cap + 0 > cap`
 * is false), letting the adjudicator exceed its monthly cap by one call —
 * inconsistent with the native-polling path which blocks at `spent >= cap`.
 * `isOverAdjudicatorBudget` now blocks at-or-over the cap while still allowing
 * a KNOWN-cost call to land exactly on the cap from below.
 */


describe("isOverAdjudicatorBudget — fail-closed at the cap", () => {
  it("allows spend below the cap (projected unknown / 0)", () => {
    expect(isOverAdjudicatorBudget(5, 0, 10)).toBe(false);
  });

  it("BLOCKS when spend is already EXACTLY at the cap (the wave-10 fix; projected=0)", () => {
    // Pre-fix: 10 + 0 > 10 === false -> wrongly ALLOWED. Now blocked.
    expect(isOverAdjudicatorBudget(10, 0, 10)).toBe(true);
  });

  it("blocks when spend is over the cap", () => {
    expect(isOverAdjudicatorBudget(12, 0, 10)).toBe(true);
  });

  it("still allows a known-cost call that lands EXACTLY on the cap from below", () => {
    // 5 + 5 = 10 == cap; not over -> allowed (not over-strict).
    expect(isOverAdjudicatorBudget(5, 5, 10)).toBe(false);
  });

  it("blocks a known-cost call that would push total OVER the cap", () => {
    expect(isOverAdjudicatorBudget(5, 6, 10)).toBe(true);
  });
});
