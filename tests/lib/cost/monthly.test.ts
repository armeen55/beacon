/**
 * Sprint 6A.3b (2026-04-26) — `src/lib/cost/monthly.ts` tests.
 *
 * Same temp-cwd hermetic pattern as budget.test.ts. NO real network
 * calls. NO production ledger writes.
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
  checkMonthlyBudget,
  currentMonthKey,
  getMonthlySpend,
  monthlyCapUsd,
} from "@/lib/cost/monthly";

type SpendEntry = {
  tenant_id: string;
  date: string;
  amount_usd: number;
  label: string;
  timestamp: string;
};

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
  workdir = mkdtempSync(join(tmpdir(), "beacon-monthly-test-"));
  process.chdir(workdir);
  process.env = { ...ORIGINAL_ENV };
  delete process.env.BEACON_MONTHLY_BUDGET_USD;
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  process.env = { ...ORIGINAL_ENV };
  try {
    rmSync(workdir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
});

const TENANT = "tenant-test";
const NOW = new Date("2026-04-26T12:00:00Z");
const THIS_MONTH = "2026-04";
const LAST_MONTH = "2026-03";

function entry(amount: number, date: string, tenant = TENANT): SpendEntry {
  return {
    tenant_id: tenant,
    date,
    amount_usd: amount,
    label: "openai:gpt-4o:p-1",
    timestamp: date + "T10:00:00Z",
  };
}

// ── Defaults ─────────────────────────────────────────────────────────────

describe("checkMonthlyBudget — Sprint 6A.3b defaults", () => {
  it("default cap is $200", () => {
    expect(monthlyCapUsd()).toBe(200);
  });

  it("env BEACON_MONTHLY_BUDGET_USD overrides default", () => {
    process.env.BEACON_MONTHLY_BUDGET_USD = "500";
    expect(monthlyCapUsd()).toBe(500);
  });

  it("returns $200 cap_usd on a fresh ledger", () => {
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.cap_usd).toBe(200);
    expect(r.spent_usd).toBe(0);
    expect(r.allowed).toBe(true);
  });
});

// ── currentMonthKey ──────────────────────────────────────────────────────

describe("currentMonthKey", () => {
  it("formats YYYY-MM", () => {
    expect(currentMonthKey(new Date("2026-04-26T12:00:00Z"))).toBe("2026-04");
    expect(currentMonthKey(new Date("2026-12-01T00:00:00Z"))).toBe("2026-12");
    expect(currentMonthKey(new Date("2027-01-15T23:59:59Z"))).toBe("2027-01");
  });

  it("uses now when no argument supplied", () => {
    const k = currentMonthKey();
    expect(k).toMatch(/^\d{4}-\d{2}$/);
  });
});

// ── Month aggregation ────────────────────────────────────────────────────

describe("checkMonthlyBudget — month aggregation", () => {
  it("sums entries from current month only", () => {
    seedLedger([
      entry(10, "2026-04-01"),
      entry(15, "2026-04-15"),
      entry(50, "2026-03-30"), // last month, must be excluded
      entry(99, "2026-05-01"), // future, excluded
    ]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.spent_usd).toBe(25);
    expect(r.month_key).toBe(THIS_MONTH);
    expect(r.allowed).toBe(true);
  });

  it("global mode (no tenantId) sums across all tenants", () => {
    seedLedger([
      entry(10, "2026-04-01", "tenant-a"),
      entry(20, "2026-04-02", "tenant-b"),
      entry(5, "2026-04-03", "tenant-c"),
    ]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.spent_usd).toBe(35);
    expect(r.scope).toBe("global");
  });

  it("tenant mode sums only that tenant's entries", () => {
    seedLedger([
      entry(10, "2026-04-01", "tenant-a"),
      entry(20, "2026-04-02", "tenant-b"),
      entry(5, "2026-04-03", "tenant-a"),
    ]);
    const r = checkMonthlyBudget({ now: NOW, tenantId: "tenant-a" });
    expect(r.spent_usd).toBe(15); // 10 + 5
    expect(r.scope).toBe("tenant");
  });

  it("returns 0 when no entries match", () => {
    seedLedger([entry(50, LAST_MONTH + "-01")]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.spent_usd).toBe(0);
    expect(r.allowed).toBe(true);
  });
});

// ── percent + cap blocking ───────────────────────────────────────────────

describe("checkMonthlyBudget — percent + cap blocking", () => {
  it("returns 0 percent on empty ledger", () => {
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.percent).toBe(0);
    expect(r.allowed).toBe(true);
  });

  it("returns 50 percent when half spent (default $200 cap)", () => {
    seedLedger([entry(100, "2026-04-15")]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.percent).toBe(50);
    expect(r.allowed).toBe(true);
  });

  it("returns 80 percent at 80% spent", () => {
    seedLedger([entry(160, "2026-04-15")]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.percent).toBe(80);
    expect(r.allowed).toBe(true);
  });

  it("blocks at 100 percent + provides reason", () => {
    seedLedger([entry(200, "2026-04-15")]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.percent).toBe(100);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/monthly budget exhausted/);
    expect(r.reason).toMatch(/2026-04/);
  });

  it("returns >100 percent when exceeded (race condition)", () => {
    seedLedger([entry(250, "2026-04-15")]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.percent).toBe(125);
    expect(r.allowed).toBe(false);
  });

  it("includes tenantId in the reason when tenant mode blocks", () => {
    seedLedger([entry(200, "2026-04-15", "tenant-x")]);
    const r = checkMonthlyBudget({ now: NOW, tenantId: "tenant-x" });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/Tenant tenant-x/);
  });

  it("includes 'Global' in the reason when global mode blocks", () => {
    seedLedger([entry(200, "2026-04-15")]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/^Global/);
  });
});

// ── env overrides + edge cases ───────────────────────────────────────────

describe("checkMonthlyBudget — env override behavior", () => {
  it("respects BEACON_MONTHLY_BUDGET_USD when computing percent + cap", () => {
    process.env.BEACON_MONTHLY_BUDGET_USD = "500";
    seedLedger([entry(250, "2026-04-15")]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.cap_usd).toBe(500);
    expect(r.percent).toBe(50);
    expect(r.allowed).toBe(true);
  });

  it("env-set cap of $0 returns 100 percent (avoids divide-by-zero NaN)", () => {
    process.env.BEACON_MONTHLY_BUDGET_USD = "0";
    seedLedger([entry(10, "2026-04-15")]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.percent).toBe(100);
    expect(r.allowed).toBe(false);
  });
});

// ── empty ledger ─────────────────────────────────────────────────────────

describe("checkMonthlyBudget — empty ledger / missing file", () => {
  it("allows when ledger file does not exist", () => {
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.spent_usd).toBe(0);
    expect(r.percent).toBe(0);
  });

  it("allows when ledger file is empty array", () => {
    seedLedger([]);
    const r = checkMonthlyBudget({ now: NOW });
    expect(r.allowed).toBe(true);
    expect(r.spent_usd).toBe(0);
  });
});

// ── getMonthlySpend (read-only diagnostic) ───────────────────────────────

describe("getMonthlySpend — diagnostic read", () => {
  it("returns spent + month_key without comparing against cap", () => {
    seedLedger([entry(42.5, "2026-04-15")]);
    const r = getMonthlySpend({ now: NOW });
    expect(r.spent_usd).toBe(42.5);
    expect(r.month_key).toBe(THIS_MONTH);
    expect(r.scope).toBe("global");
  });

  it("respects tenantId filter", () => {
    seedLedger([
      entry(10, "2026-04-15", "tenant-a"),
      entry(20, "2026-04-16", "tenant-b"),
    ]);
    const r = getMonthlySpend({ now: NOW, tenantId: "tenant-b" });
    expect(r.spent_usd).toBe(20);
    expect(r.scope).toBe("tenant");
  });
});
