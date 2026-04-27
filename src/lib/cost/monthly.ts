/**
 * Sprint 6A.3b (2026-04-26) — monthly aggregation helper for the
 * native polling cost ledger.
 *
 * Reads `.data/cost-ledger.json` (the same per-tenant daily ledger
 * managed by `./budget.ts`) and aggregates by month. NO schema change
 * — the ledger remains a flat list of `SpendEntry` rows; monthly is
 * a derived view.
 *
 * Separate from `src/domains/recommendations/adjudicator-budget.ts`,
 * which manages the Sprint 6A.2 specific-edit / adjudicator cap in
 * `llm-budget.json`. Two cost surfaces, two ledgers, two helpers —
 * one budget cannot drain the other.
 *
 * Pure / no writes. The poll loop wires this in 6A.3c; until then
 * `checkMonthlyBudget` has zero callers in production code.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types — mirror the BudgetCheck shape from `./budget.ts` so cron logging
// can format daily + monthly + per-run from one template.
// ---------------------------------------------------------------------------

export type MonthlyBudgetCheck = {
  allowed: boolean;
  reason?: string;
  spent_usd: number;
  cap_usd: number;
  /** `Math.round((spent / cap) * 100)`, NOT clamped. */
  percent: number;
  /** YYYY-MM the calculation covers. */
  month_key: string;
  /** When `tenantId` is supplied, sums entries for THAT tenant. When
   *  omitted (the operator-default $200 cap path), sums ALL tenants. */
  scope: "global" | "tenant";
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Default $200/month per Sprint 6A.3 plan — set high enough that
 * normal full-native operation never trips. Override via env.
 */
export function monthlyCapUsd(): number {
  const env = process.env.BEACON_MONTHLY_BUDGET_USD;
  return env ? parseFloat(env) : 200.0;
}

// ---------------------------------------------------------------------------
// Ledger read (intentionally a self-contained read; no shared mutable
// state with budget.ts — both helpers re-read from disk on every call,
// which keeps the source-of-truth a single file)
// ---------------------------------------------------------------------------

type SpendEntry = {
  tenant_id: string;
  date: string; // YYYY-MM-DD
  amount_usd: number;
  label: string;
  timestamp: string;
};

// Sprint 6A.3b (2026-04-26) — paths computed at call time so tests
// that `process.chdir(tmpdir)` are hermetic (matches budget.ts).
function ledgerPath(): string {
  return join(process.cwd(), ".data", "cost-ledger.json");
}

function readLedger(): SpendEntry[] {
  const path = ledgerPath();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SpendEntry[];
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * `YYYY-MM` for the supplied `Date` (or now). Mirrors the format used by
 * `adjudicator-budget.currentMonthKey` so cross-pipeline analytics can
 * join on month consistently.
 */
export function currentMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function sumMonthly(
  entries: SpendEntry[],
  monthKey: string,
  tenantId?: string,
): number {
  return entries
    .filter((e) => e.date.startsWith(monthKey))
    .filter((e) => (tenantId ? e.tenant_id === tenantId : true))
    .reduce((sum, e) => sum + e.amount_usd, 0);
}

function percent(spentUsd: number, capUsd: number): number {
  if (capUsd <= 0) return 100;
  return Math.round((spentUsd / capUsd) * 100);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CheckMonthlyBudgetOpts = {
  /**
   * Optional. When set, the check sums entries for THIS tenant only
   * (per-tenant monthly view). When omitted, sums ALL entries this
   * month (the operator-default global $200 cap path). Single-tenant
   * Ritz today: both modes return the same value.
   */
  tenantId?: string;
  /** Frozen `now` for deterministic tests. */
  now?: Date;
};

/**
 * Sprint 6A.3b — monthly cap check. Reads the ledger, sums entries
 * for the current month (and optionally the supplied tenant), compares
 * against `BEACON_MONTHLY_BUDGET_USD` (default $200). Pure read; never
 * writes.
 */
export function checkMonthlyBudget(
  opts: CheckMonthlyBudgetOpts = {},
): MonthlyBudgetCheck {
  const now = opts.now ?? new Date();
  const monthKey = currentMonthKey(now);
  const entries = readLedger();
  const spent = sumMonthly(entries, monthKey, opts.tenantId);
  const cap = monthlyCapUsd();
  const scope = opts.tenantId ? "tenant" : "global";

  if (spent >= cap) {
    const who = opts.tenantId
      ? `Tenant ${opts.tenantId}`
      : "Global";
    return {
      allowed: false,
      reason: `${who} monthly budget exhausted: $${spent.toFixed(2)} of $${cap.toFixed(2)} used in ${monthKey}`,
      spent_usd: spent,
      cap_usd: cap,
      percent: percent(spent, cap),
      month_key: monthKey,
      scope,
    };
  }
  return {
    allowed: true,
    spent_usd: spent,
    cap_usd: cap,
    percent: percent(spent, cap),
    month_key: monthKey,
    scope,
  };
}

/**
 * Pure read helper for diagnostic dashboards. Returns this month's
 * spend in USD for the supplied tenant (or all tenants when omitted).
 */
export function getMonthlySpend(
  opts: CheckMonthlyBudgetOpts = {},
): { spent_usd: number; month_key: string; scope: "global" | "tenant" } {
  const now = opts.now ?? new Date();
  const monthKey = currentMonthKey(now);
  const entries = readLedger();
  const spent = sumMonthly(entries, monthKey, opts.tenantId);
  return {
    spent_usd: spent,
    month_key: monthKey,
    scope: opts.tenantId ? "tenant" : "global",
  };
}
