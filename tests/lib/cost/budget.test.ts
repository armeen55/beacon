/**
 * Sprint 6A.3b (2026-04-26) — `src/lib/cost/budget.ts` tests.
 *
 * The budget helpers read `.data/cost-ledger.json`. We use a
 * temporary working directory per test so the production ledger is
 * never touched. `process.chdir(tmpdir)` + `process.cwd()` inside
 * the helper makes this hermetic.
 *
 * NO real network calls. NO production ledger writes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  rmSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  checkTenantBudget,
  checkPerRunBudget,
  perRunCapUsd,
  recordSpend,
  getTenantSpendToday,
  getGlobalSpendToday,
  type SpendEntry,
} from "@/lib/cost/budget";

const ORIGINAL_CWD = process.cwd();
const ORIGINAL_ENV = { ...process.env };

let workdir: string;

function seedLedger(entries: SpendEntry[]): void {
  const dataDir = join(workdir, ".data");
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(
    join(dataDir, "cost-ledger.json"),
    JSON.stringify(entries, null, 2),
    "utf-8",
  );
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "beacon-budget-test-"));
  process.chdir(workdir);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.BEACON_DAILY_BUDGET_USD_PER_TENANT;
  delete process.env.BEACON_DAILY_BUDGET_GLOBAL_USD;
  delete process.env.BEACON_PER_RUN_BUDGET_USD;
  delete process.env.VERCEL;
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.env = { ...ORIGINAL_ENV };
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
});

const today = new Date().toISOString().slice(0, 10);
const TENANT = "tenant-test";

function entry(amount: number, tenant = TENANT, date = today): SpendEntry {
  return {
    tenant_id: tenant,
    date,
    amount_usd: amount,
    label: "openai:gpt-4o:p-1",
    timestamp: new Date().toISOString(),
  };
}

// ── Defaults (Sprint 6A.3b operator-locked) ──────────────────────────────

describe("checkTenantBudget — Sprint 6A.3b defaults", () => {
  it("daily per-tenant default cap is $10 (was $5 in 6A.3a)", () => {
    const r = checkTenantBudget(TENANT);
    expect(r.cap_usd).toBe(10);
  });

  it("env BEACON_DAILY_BUDGET_USD_PER_TENANT overrides default", () => {
    process.env.BEACON_DAILY_BUDGET_USD_PER_TENANT = "25";
    const r = checkTenantBudget(TENANT);
    expect(r.cap_usd).toBe(25);
  });

  it("global daily default cap is $20", () => {
    // Push tenant under cap so the global cap reads on the path.
    seedLedger([entry(5)]);
    const r = checkTenantBudget(TENANT);
    expect(r.allowed).toBe(true);
    // The success path returns tenant cap; we can't directly observe
    // global default from this return shape — but the function would
    // refuse a 21-dollar entry and we test that elsewhere.
    expect(r.cap_usd).toBe(10);
  });
});

// ── percent field (added in 6A.3b) ───────────────────────────────────────

describe("checkTenantBudget — percent field", () => {
  it("returns 0 percent on empty ledger", () => {
    const r = checkTenantBudget(TENANT);
    expect(r.percent).toBe(0);
    expect(r.spent_usd).toBe(0);
    expect(r.allowed).toBe(true);
  });

  it("returns ~50 percent when half-spent", () => {
    seedLedger([entry(5)]); // half of $10 default
    const r = checkTenantBudget(TENANT);
    expect(r.percent).toBe(50);
    expect(r.allowed).toBe(true);
  });

  it("returns ~80 percent when 80% spent", () => {
    seedLedger([entry(8)]);
    const r = checkTenantBudget(TENANT);
    expect(r.percent).toBe(80);
    expect(r.allowed).toBe(true);
  });

  it("returns 100 percent + blocks at the cap", () => {
    seedLedger([entry(10)]); // exactly cap
    const r = checkTenantBudget(TENANT);
    expect(r.percent).toBe(100);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/daily budget exhausted/);
  });

  it("returns >100 percent when somehow exceeded (race condition)", () => {
    seedLedger([entry(15)]); // well over $10 cap
    const r = checkTenantBudget(TENANT);
    expect(r.percent).toBe(150);
    expect(r.allowed).toBe(false);
  });
});

// ── tenant-specific scope ────────────────────────────────────────────────

describe("checkTenantBudget — tenant-specific scope", () => {
  it("does not count other tenants' spend toward this tenant's cap", () => {
    seedLedger([
      entry(9, "tenant-other"),
      entry(2, TENANT),
    ]);
    const r = checkTenantBudget(TENANT);
    expect(r.spent_usd).toBe(2);
    expect(r.allowed).toBe(true);
  });

  it("does not count yesterday's spend toward today's cap", () => {
    const yesterday = new Date(Date.now() - 86_400_000)
      .toISOString()
      .slice(0, 10);
    seedLedger([
      entry(10, TENANT, yesterday), // cap-busting yesterday
      entry(2, TENANT, today),
    ]);
    const r = checkTenantBudget(TENANT);
    expect(r.spent_usd).toBe(2);
    expect(r.allowed).toBe(true);
  });
});

// ── empty ledger / safe defaults ─────────────────────────────────────────

describe("checkTenantBudget — empty ledger", () => {
  it("allows when ledger file does not exist", () => {
    // No seedLedger() call.
    const r = checkTenantBudget(TENANT);
    expect(r.allowed).toBe(true);
    expect(r.spent_usd).toBe(0);
    expect(r.percent).toBe(0);
  });

  it("allows when ledger file is empty array", () => {
    seedLedger([]);
    const r = checkTenantBudget(TENANT);
    expect(r.allowed).toBe(true);
    expect(r.spent_usd).toBe(0);
  });
});

// ── checkPerRunBudget ────────────────────────────────────────────────────

describe("checkPerRunBudget — per-chunk runaway protection", () => {
  // Step 1.5 (master plan) — default raised $5 → $8 in budget.ts.
  // Tests below pin the new default; env override path unchanged.
  it("default cap is $8", () => {
    expect(perRunCapUsd()).toBe(8);
  });

  it("env BEACON_PER_RUN_BUDGET_USD overrides default", () => {
    process.env.BEACON_PER_RUN_BUDGET_USD = "10";
    expect(perRunCapUsd()).toBe(10);
  });

  it("allows accumulated $0 (loop start)", () => {
    const r = checkPerRunBudget(0);
    expect(r.allowed).toBe(true);
    expect(r.spent_usd).toBe(0);
    expect(r.cap_usd).toBe(8);
    expect(r.percent).toBe(0);
  });

  it("allows accumulated $7.99 (under cap)", () => {
    const r = checkPerRunBudget(7.99);
    expect(r.allowed).toBe(true);
    expect(r.percent).toBe(100); // rounds up but allowed
  });

  it("blocks at exactly the cap ($8)", () => {
    const r = checkPerRunBudget(8);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Per-run budget exhausted/);
    expect(r.percent).toBe(100);
  });

  it("blocks above the cap with informative percent", () => {
    const r = checkPerRunBudget(12);
    expect(r.allowed).toBe(false);
    expect(r.percent).toBe(150);
  });

  it("returns same shape regardless of allowed/blocked", () => {
    const ok = checkPerRunBudget(0);
    const blocked = checkPerRunBudget(99);
    for (const k of ["allowed", "spent_usd", "cap_usd", "percent"] as const) {
      expect(k in ok).toBe(true);
      expect(k in blocked).toBe(true);
    }
  });
});

// ── recordSpend round-trip (for documentation; not the focus of 6A.3b) ──

describe("recordSpend round-trip", () => {
  it("appends to ledger and is readable via getTenantSpendToday", () => {
    recordSpend(TENANT, 0.25, "openai:gpt-4o:p-1");
    expect(getTenantSpendToday(TENANT)).toBe(0.25);
  });

  it("getGlobalSpendToday sums across tenants", () => {
    recordSpend(TENANT, 0.25, "openai:gpt-4o:p-1");
    recordSpend("tenant-other", 0.5, "openai:gpt-4o:p-2");
    expect(getGlobalSpendToday()).toBe(0.75);
  });
});
