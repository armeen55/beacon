/**
 * Cost governance — per-tenant daily API budget caps.
 *
 * Every CX2 platform adapter calls `recordSpend` after each API call.
 * Before making an API call, the orchestrator calls `checkTenantBudget`
 * to decide whether the call is allowed. Budget exceeded → fail fast
 * with a clear error, never silently burn money.
 *
 * Backed by `.data/cost-ledger.json` — an append-only log of spend
 * events. The ledger is the single source of truth for cost tracking.
 * CX2.9 (founder cost dashboard) reads from it.
 *
 * Budget caps read from env:
 *   BEACON_DAILY_BUDGET_USD_PER_TENANT (default $5)
 *   BEACON_DAILY_BUDGET_GLOBAL_USD (default $20)
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SpendEntry = {
  tenant_id: string;
  date: string;       // YYYY-MM-DD
  amount_usd: number;
  label: string;      // e.g., "openai:gpt-4o:prompt-123"
  timestamp: string;  // ISO
};

export type BudgetCheck = {
  allowed: boolean;
  reason?: string;
  spent_usd: number;
  cap_usd: number;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function perTenantCapUsd(): number {
  const env = process.env.BEACON_DAILY_BUDGET_USD_PER_TENANT;
  return env ? parseFloat(env) : 5.0;
}

function globalCapUsd(): number {
  const env = process.env.BEACON_DAILY_BUDGET_GLOBAL_USD;
  return env ? parseFloat(env) : 20.0;
}

// ---------------------------------------------------------------------------
// Ledger persistence
// ---------------------------------------------------------------------------

const DATA_DIR = join(process.cwd(), ".data");
const LEDGER_PATH = join(DATA_DIR, "cost-ledger.json");

function ensureDataDir(): void {
  if (process.env.VERCEL === "1") return;
  if (!existsSync(DATA_DIR)) {
    mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readLedger(): SpendEntry[] {
  ensureDataDir();
  if (!existsSync(LEDGER_PATH)) return [];
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, "utf-8")) as SpendEntry[];
  } catch {
    return [];
  }
}

function writeLedger(entries: SpendEntry[]): void {
  ensureDataDir();
  writeFileSync(LEDGER_PATH, JSON.stringify(entries, null, 2), "utf-8");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function todayYmd(): string {
  return new Date().toISOString().slice(0, 10);
}

function sumForTenantToday(
  entries: SpendEntry[],
  tenantId: string,
  date: string,
): number {
  return entries
    .filter((e) => e.tenant_id === tenantId && e.date === date)
    .reduce((sum, e) => sum + e.amount_usd, 0);
}

function sumGlobalToday(entries: SpendEntry[], date: string): number {
  return entries
    .filter((e) => e.date === date)
    .reduce((sum, e) => sum + e.amount_usd, 0);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Check whether a tenant has budget remaining for today.
 * Returns `{ allowed: true }` when under both per-tenant and global caps.
 * Returns `{ allowed: false, reason }` when either cap is hit.
 *
 * Call BEFORE making an API call. If `allowed` is false, skip the call
 * and surface the reason to the operator.
 */
export function checkTenantBudget(tenantId: string): BudgetCheck {
  const entries = readLedger();
  const date = todayYmd();

  const tenantSpent = sumForTenantToday(entries, tenantId, date);
  const tenantCap = perTenantCapUsd();
  if (tenantSpent >= tenantCap) {
    return {
      allowed: false,
      reason: `Tenant ${tenantId} daily budget exhausted: $${tenantSpent.toFixed(2)} of $${tenantCap.toFixed(2)} used`,
      spent_usd: tenantSpent,
      cap_usd: tenantCap,
    };
  }

  const globalSpent = sumGlobalToday(entries, date);
  const gCap = globalCapUsd();
  if (globalSpent >= gCap) {
    return {
      allowed: false,
      reason: `Global daily budget exhausted: $${globalSpent.toFixed(2)} of $${gCap.toFixed(2)} used`,
      spent_usd: globalSpent,
      cap_usd: gCap,
    };
  }

  return {
    allowed: true,
    spent_usd: tenantSpent,
    cap_usd: tenantCap,
  };
}

/**
 * Record a spend event after an API call completes. Appends to the
 * cost ledger on disk immediately — no batching — so a mid-run crash
 * never loses spend records.
 */
export function recordSpend(
  tenantId: string,
  amountUsd: number,
  label: string,
): void {
  const entries = readLedger();
  entries.push({
    tenant_id: tenantId,
    date: todayYmd(),
    amount_usd: amountUsd,
    label,
    timestamp: new Date().toISOString(),
  });
  writeLedger(entries);
}

/**
 * Get today's spend for a tenant (for display in dashboards).
 */
export function getTenantSpendToday(tenantId: string): number {
  return sumForTenantToday(readLedger(), tenantId, todayYmd());
}

/**
 * Get today's global spend across all tenants.
 */
export function getGlobalSpendToday(): number {
  return sumGlobalToday(readLedger(), todayYmd());
}
