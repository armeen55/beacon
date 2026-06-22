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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
const recordSpendSupabase = vi.fn(async () => {});
vi.mock("@/lib/cost/budget-ledger-supabase", () => ({
  getTenantSpentThisMonthUsd: (...args: unknown[]) =>
    getTenantSpentThisMonthUsd(...args),
  recordSpendSupabase: (...args: unknown[]) => recordSpendSupabase(...args),
}));

import {
  checkBudget,
  recordSpend,
} from "@/domains/recommendations/adjudicator-budget";

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
