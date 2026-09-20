import "server-only";

/**
 * Per-account LLM budget guardrail.
 *
 * Tracks each account's monthly LLM spend and hard-caps calls when spend hits the configured limit for the current month. Callers check before calling
 * the provider and record after. Every read and write takes the EXPLICIT account: no ambient tenant resolution exists anywhere in this path (isolation closures 2026-07-23/24).
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
 * `checkBudget` projects max(file, durable) FOR THE SAME ACCOUNT for status surfaces. Paid calls themselves use the atomic reservation RPC.
 */

import { readStore } from "@/lib/persistence/json-store";
import { isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getTenantSpentThisMonthUsd } from "@/lib/cost/budget-ledger-supabase";
import { dailyCapReason, shareFor } from "@/lib/cost/daily-cap";

const STORE_NAME = "llm-budget";
// Operator-authorized recurring account ceiling. readState treats the code default as a floor, so a
// state written under the former $55 default is lifted without rewriting the spend ledger.
const DEFAULT_CAP_USD = 250; // raised 55 -> 75 with operator approval on 2026-08-29, then 75 -> 250 with the operator's "unlock all caps" instruction of 2026-09-10, matching the search platform's ceiling; the per-day brake on the account row stays the working limit

/** Platform tag for adjudicator/LLM-narrative spend in the durable ledger. */
const ADJUDICATOR_PLATFORM = "adjudicator-openai" as const;

/**
 * Durable monthly spend from Supabase for an EXPLICIT account, or null when the DB is unconfigured / read errored (caller falls back to the account's file ledger). Never throws.
 */
async function durableMonthlySpentUsd(now: Date, tenantId: string): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    return await getTenantSpentThisMonthUsd(tenantId, now, ADJUDICATOR_PLATFORM);
  } catch {
    return null;
  }
}

type AdjudicatorBudgetState = {
  /** YYYY-MM. Resets when a new month begins. */
  monthKey: string;
  spendUsd: number;
  calls: number;
  capUsd: number;
  /** ISO timestamp of last write. For audit. */
  updatedAt: string;
};

function currentMonthKey(now: Date = new Date()): string {
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
  // THE CODE DEFAULT IS A FLOOR: a state stamped under an older, lower default (the 10 that predated 30) must not keep starving the month after the raise. A cap someone raised ABOVE the default survives.
  const capUsd = Math.max(existing.capUsd ?? 0, DEFAULT_CAP_USD);
  if (existing.monthKey !== month) {
    // Month rolled over - reset spend but preserve the cap.
    return {
      monthKey: month,
      spendUsd: 0,
      calls: 0,
      capUsd,
      updatedAt: now.toISOString(),
    };
  }
  return { ...existing, capUsd };
}

type BudgetCheckResult =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string };

/**
 * Pure budget-boundary decision (wave-10, 2026-06-14). Blocks when spend is ALREADY at/over the cap, OR when this call's projected cost would push the
 * total OVER it. The first clause makes the cap fail-closed AT the boundary (a zero-projected call at spend == cap must not slip through); the second
 * still lets a KNOWN-cost call land exactly on the cap from below.
 */
function isOverAdjudicatorBudget(
  spendUsd: number,
  projectedCostUsd: number,
  capUsd: number,
): boolean {
  return spendUsd >= capUsd || spendUsd + projectedCostUsd > capUsd;
}

export async function checkBudget(
  opts: { tenantId: string; now?: Date; projectedCostUsd?: number; purpose?: "fact_check" | "bulk" },
): Promise<BudgetCheckResult> {
  const tenantId = requireTenant(opts.tenantId, "checkBudget");
  const now = opts.now ?? new Date();
  const state = await readState(now, tenantId);
  const projected = opts.projectedCostUsd ?? 0;

  // audit-3 #1: take the GREATER of this account's file spend and its durable Supabase monthly spend. On Vercel the file reads back 0 (writes no-op), so the durable per-account spend is the real total.
  const durable = await durableMonthlySpentUsd(now, tenantId);
  const effectiveSpend = durable != null ? Math.max(state.spendUsd, durable) : state.spendUsd;

  if (isOverAdjudicatorBudget(effectiveSpend, projected, state.capUsd)) {
    return {
      allowed: false,
      reason: `Monthly adjudicator budget cap reached (${effectiveSpend.toFixed(4)} / ${state.capUsd} USD this ${state.monthKey}).`,
    };
  }
  // THE OPERATOR'S DAILY CAP RIDES THIS DOOR TOO (lib/cost/daily-cap): one day-total across every
  // platform on the ledger, held under the account's own daily_budget_usd, failing closed on an
  // unreadable ledger.
  // NON-FACT MODEL WORK MAY NOT SPEND THE FACT RESERVE, and the call about to be made counts against the
  // ceiling it asks to cross: twenty-nine answer analyses ran before fact_check ever got a turn.
  const daily = await dailyCapReason(tenantId, now, shareFor("model", opts.purpose ?? "bulk"), projected, opts.purpose ?? "bulk");
  if (daily) return { allowed: false, reason: daily };
  return { allowed: true, remaining: state.capUsd - effectiveSpend };
}
