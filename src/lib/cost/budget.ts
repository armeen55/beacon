/**
 * Cost governance — per-tenant daily API budget caps + per-run cap.
 *
 * Every native polling loop calls `recordSpend` after each API call.
 * Before making an API call, the orchestrator calls `checkTenantBudget`
 * (daily) and `checkPerRunBudget` (per-chunk running tally) to decide
 * whether the call is allowed. Monthly aggregation lives in
 * `./monthly.ts` (separate helper, same ledger).
 *
 * Backed by `.data/cost-ledger.json` — an append-only log of spend
 * events. The ledger is the single source of truth for native polling
 * cost tracking. **Separate from `llm-budget.json`** which is the
 * Sprint 6A.2 specific-edit / adjudicator monthly cap. Two cost
 * surfaces, two ledgers — one budget cannot drain the other.
 *
 * Budget caps read from env (defaults match Sprint 6A.3 plan):
 *   BEACON_DAILY_BUDGET_USD_PER_TENANT (default $10)
 *   BEACON_DAILY_BUDGET_GLOBAL_USD     (default $20)
 *   BEACON_MONTHLY_BUDGET_USD          (default $200, see ./monthly.ts)
 *   BEACON_PER_RUN_BUDGET_USD          (default $5, see checkPerRunBudget)
 *
 * Sprint 6A.3a/b status: helpers exist + tested. Polling-loop wiring
 * lands in 6A.3c. Until then `checkTenantBudget` / `checkPerRunBudget`
 * have zero callers in production code.
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
  /**
   * Sprint 6A.3b (2026-04-26) — `Math.round((spent / cap) * 100)`. NOT
   * clamped: `percent > 100` is informative when spend somehow exceeded
   * the cap (e.g. concurrent writes). Logging code formats this as
   * "28% of $10".
   */
  percent: number;
};

export type PerRunBudgetCheck = {
  allowed: boolean;
  reason?: string;
  /** Estimated/accumulated spend for this single run. */
  spent_usd: number;
  cap_usd: number;
  percent: number;
};

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function perTenantCapUsd(): number {
  const env = process.env.BEACON_DAILY_BUDGET_USD_PER_TENANT;
  // Sprint 6A.3b (2026-04-26) — bumped default $5 → $10. Operator-set
  // value for full-native daily polling. Caps are runaway protection,
  // not throttling — set high enough that normal operation never trips.
  return env ? parseFloat(env) : 10.0;
}

function globalCapUsd(): number {
  const env = process.env.BEACON_DAILY_BUDGET_GLOBAL_USD;
  return env ? parseFloat(env) : 20.0;
}

/**
 * Per-run (per-chunk) cap — ceiling on accumulated cost for a single
 * `pollPerplexityForTenant` invocation. Pure config read; no ledger
 * touch. Default $5 covers ~6.7x normal chunk spend at 25 prompts ×
 * $0.03 = $0.75. Trip means something is genuinely wrong.
 */
export function perRunCapUsd(): number {
  const env = process.env.BEACON_PER_RUN_BUDGET_USD;
  return env ? parseFloat(env) : 5.0;
}

// ---------------------------------------------------------------------------
// Ledger persistence
// ---------------------------------------------------------------------------

// Sprint 6A.3b (2026-04-26) — paths computed at call time (not
// module-load) so tests that `process.chdir(tmpdir)` in beforeEach are
// hermetic. Module-level `join(process.cwd(), ...)` constants would
// freeze the path to the runner's startup cwd, leaking writes into the
// real `.data/`. (Discovered the hard way during 6A.3b test wiring.)
function dataDir(): string {
  return join(process.cwd(), ".data");
}
function ledgerPath(): string {
  return join(dataDir(), "cost-ledger.json");
}

function ensureDataDir(): void {
  if (process.env.VERCEL === "1") return;
  const dir = dataDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function readLedger(): SpendEntry[] {
  ensureDataDir();
  const path = ledgerPath();
  if (!existsSync(path)) return [];
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as SpendEntry[];
  } catch {
    return [];
  }
}

function writeLedger(entries: SpendEntry[]): void {
  ensureDataDir();
  writeFileSync(ledgerPath(), JSON.stringify(entries, null, 2), "utf-8");
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
 *
 * Sprint 6A.3b (2026-04-26) — `percent` field added on every return for
 * richer cron-log lines ("28% of $10").
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
      percent: percent(tenantSpent, tenantCap),
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
      percent: percent(globalSpent, gCap),
    };
  }

  return {
    allowed: true,
    spent_usd: tenantSpent,
    cap_usd: tenantCap,
    percent: percent(tenantSpent, tenantCap),
  };
}

/**
 * Sprint 6A.3b (2026-04-26) — per-run (per-chunk) budget guard. Pure
 * config check, no ledger I/O. The poll loop calls this with its
 * accumulated cost-so-far before each provider call; if the running
 * tally exceeds `BEACON_PER_RUN_BUDGET_USD`, the loop halts and
 * surfaces a `partial_budget_blocked` status.
 *
 * Caller-supplied `accumulatedUsd` is the source of truth for "this
 * run" — the helper does not pull from the ledger, so a single chunk
 * can't be incorrectly throttled by another tenant's spend.
 */
export function checkPerRunBudget(accumulatedUsd: number): PerRunBudgetCheck {
  const cap = perRunCapUsd();
  if (accumulatedUsd >= cap) {
    return {
      allowed: false,
      reason: `Per-run budget exhausted: $${accumulatedUsd.toFixed(2)} of $${cap.toFixed(2)} used`,
      spent_usd: accumulatedUsd,
      cap_usd: cap,
      percent: percent(accumulatedUsd, cap),
    };
  }
  return {
    allowed: true,
    spent_usd: accumulatedUsd,
    cap_usd: cap,
    percent: percent(accumulatedUsd, cap),
  };
}

/**
 * Calculate spent / cap as a percent integer. NOT clamped — values
 * over 100 are informative when spend exceeded the cap (concurrent
 * writes, race condition, manual ledger edit). Caller can clamp for
 * display.
 *
 * Cap of 0 is treated as 100% to avoid division-by-zero NaN, which
 * would break log parsers.
 */
function percent(spentUsd: number, capUsd: number): number {
  if (capUsd <= 0) return 100;
  return Math.round((spentUsd / capUsd) * 100);
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
