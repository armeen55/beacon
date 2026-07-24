import "server-only";

/**
 * Per-account LLM budget guardrail.
 *
 * Tracks each account's monthly LLM spend and hard-caps calls when spend hits
 * the configured limit for the current month. Callers check before calling
 * the provider and record after. Every read and write takes the EXPLICIT
 * account: no ambient tenant resolution exists anywhere in this path
 * (isolation closures 2026-07-23/24).
 *
 * Two layers, same account identity on both:
 *   - Durable Supabase ledger (`llm_budget_ledger`, platform
 *     "adjudicator-openai"): the authoritative per-account monthly spend. On
 *     Vercel the file layer no-ops, so without this read the cap would fail
 *     OPEN (audit-3 #1, 2026-06-22).
 *   - File-layer backstop (`llm-budget`, TENANT-SCOPED store): dev-disk
 *     protection when Supabase is unreachable. Routed per account via the
 *     explicit tenantId; the pre-closure shared global blob is inert and
 *     never read.
 * `checkBudget` blocks on max(file, durable) FOR THE SAME ACCOUNT;
 * `recordSpend` writes both. Fail-soft: a durable read error falls back to
 * the account's file spend.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { isSupabaseConfigured } from "@/lib/persistence/supabase";
import {
  getTenantSpentThisMonthUsd,
  recordSpendSupabase,
} from "@/lib/cost/budget-ledger-supabase";
import { log } from "@/lib/logger";

const STORE_NAME = "llm-budget";
const DEFAULT_CAP_USD = 10;

/** Platform tag for adjudicator/LLM-narrative spend in the durable ledger. */
const ADJUDICATOR_PLATFORM = "adjudicator-openai" as const;

/**
 * Durable monthly spend from Supabase for an EXPLICIT account, or null when
 * the DB is unconfigured / read errored (caller falls back to the account's
 * file ledger). Never throws.
 */
async function durableMonthlySpentUsd(now: Date, tenantId: string): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    return await getTenantSpentThisMonthUsd(tenantId, now, ADJUDICATOR_PLATFORM);
  } catch {
    return null;
  }
}

export type AdjudicatorBudgetState = {
  /** YYYY-MM. Resets when a new month begins. */
  monthKey: string;
  spendUsd: number;
  calls: number;
  capUsd: number;
  /** ISO timestamp of last write. For audit. */
  updatedAt: string;
};

export function currentMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function emptyState(now: Date = new Date()): AdjudicatorBudgetState {
  return {
    monthKey: currentMonthKey(now),
    spendUsd: 0,
    calls: 0,
    capUsd: DEFAULT_CAP_USD,
    updatedAt: now.toISOString(),
  };
}

/** A missing/empty account can never bind budget state to the wrong ledger. */
function requireTenant(tenantId: string, op: string): string {
  const t = (tenantId ?? "").trim();
  if (!t) throw new Error(`adjudicator-budget.${op}: explicit tenantId is required.`);
  return t;
}

async function readState(now: Date, tenantId: string): Promise<AdjudicatorBudgetState> {
  const rows = await readStore<AdjudicatorBudgetState>(STORE_NAME, undefined, { tenantId });
  const existing = rows[0];
  if (!existing) return emptyState(now);
  const month = currentMonthKey(now);
  if (existing.monthKey !== month) {
    // Month rolled over — reset spend but preserve the cap.
    return {
      monthKey: month,
      spendUsd: 0,
      calls: 0,
      capUsd: existing.capUsd ?? DEFAULT_CAP_USD,
      updatedAt: now.toISOString(),
    };
  }
  return existing;
}

async function writeState(state: AdjudicatorBudgetState, tenantId: string): Promise<void> {
  await writeStore<AdjudicatorBudgetState>(STORE_NAME, [state], { tenantId });
}

export type BudgetCheckResult =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string };

/**
 * Pure budget-boundary decision (wave-10, 2026-06-14). Blocks when spend is
 * ALREADY at/over the cap, OR when this call's projected cost would push the
 * total OVER it. The first clause makes the cap fail-closed AT the boundary
 * (a zero-projected call at spend == cap must not slip through); the second
 * still lets a KNOWN-cost call land exactly on the cap from below.
 */
export function isOverAdjudicatorBudget(
  spendUsd: number,
  projectedCostUsd: number,
  capUsd: number,
): boolean {
  return spendUsd >= capUsd || spendUsd + projectedCostUsd > capUsd;
}

export async function checkBudget(
  opts: { tenantId: string; now?: Date; projectedCostUsd?: number },
): Promise<BudgetCheckResult> {
  const tenantId = requireTenant(opts.tenantId, "checkBudget");
  const now = opts.now ?? new Date();
  const state = await readState(now, tenantId);
  const projected = opts.projectedCostUsd ?? 0;

  // audit-3 #1: take the GREATER of this account's file spend and its durable
  // Supabase monthly spend. On Vercel the file reads back 0 (writes no-op), so
  // the durable per-account spend is the real total.
  const durable = await durableMonthlySpentUsd(now, tenantId);
  const effectiveSpend = durable != null ? Math.max(state.spendUsd, durable) : state.spendUsd;

  if (isOverAdjudicatorBudget(effectiveSpend, projected, state.capUsd)) {
    return {
      allowed: false,
      reason: `Monthly adjudicator budget cap reached (${effectiveSpend.toFixed(4)} / ${state.capUsd} USD this ${state.monthKey}).`,
    };
  }
  return { allowed: true, remaining: state.capUsd - effectiveSpend };
}

export async function recordSpend(costUsd: number, opts: { tenantId: string; now?: Date }): Promise<void> {
  const tenantId = requireTenant(opts.tenantId, "recordSpend");
  const now = opts.now ?? new Date();
  const state = await readState(now, tenantId);
  state.spendUsd = round6(state.spendUsd + costUsd);
  state.calls += 1;
  state.updatedAt = now.toISOString();
  await writeState(state, tenantId);

  // Mirror the spend into the durable per-account Supabase ledger so the cap
  // survives Vercel's ephemeral disk. Never throws; a durable miss only loses
  // cross-run accounting, it never blocks the paid call that already happened.
  if (isSupabaseConfigured() && Number.isFinite(costUsd) && costUsd >= 0) {
    try {
      await recordSpendSupabase({
        tenantId,
        platform: ADJUDICATOR_PLATFORM,
        costUsd,
      });
    } catch (e) {
      log.warn?.("adjudicator durable spend write failed (non-fatal)", {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
