import "server-only";

/**
 * retrieval-budget (2026-07-02, master plan item 50) - the retrieval twin's own spend cap.
 * Same shape as `src/domains/recommendations/adjudicator-budget.ts` (checkBudget/recordSpend,
 * monthly cap, fail-closed on an unreadable budget) but a SEPARATE ledger surface - embedding
 * spend must never share a cap with (or be able to drain) the adjudicator/drafting caps, and
 * vice versa. Backed by `.data/retrieval-budget.json` plus a durable mirror in the shared
 * Supabase `llm_budget_ledger` table under platform "other" (the pre-existing catch-all value;
 * no CHECK-constraint migration needed for this feature).
 *
 * Embeddings are cheap by design (text-embedding-3-small ~$0.02 per 1M tokens - a full
 * ~150-page Iranopedia index at ~10 chunks x ~200 tokens/page is ~300k tokens, well under
 * a cent), so the default monthly cap is intentionally small ($2) - it exists as a runaway
 * guard, not a throttle on normal use.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { isSupabaseConfigured } from "@/lib/persistence/supabase";
import { getTenantSpentThisMonthUsd, recordSpendSupabase } from "@/lib/cost/budget-ledger-supabase";
import { currentTenantId } from "@/lib/tenant-context";
import { log } from "@/lib/logger";

const STORE_NAME = "retrieval-twin-budget";
const DEFAULT_CAP_USD = 2;
/** Shared-ledger platform tag. "other" already passes the llm_budget_ledger CHECK constraint. */
const RETRIEVAL_PLATFORM = "other" as const;

async function durableMonthlySpentUsd(now: Date): Promise<number | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const tenantId = await currentTenantId();
    return await getTenantSpentThisMonthUsd(tenantId, now, RETRIEVAL_PLATFORM);
  } catch {
    return null;
  }
}

export type RetrievalBudgetState = {
  monthKey: string;
  spendUsd: number;
  calls: number;
  capUsd: number;
  updatedAt: string;
};

export function currentMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function emptyState(now: Date): RetrievalBudgetState {
  return { monthKey: currentMonthKey(now), spendUsd: 0, calls: 0, capUsd: DEFAULT_CAP_USD, updatedAt: now.toISOString() };
}

async function readState(now: Date): Promise<RetrievalBudgetState> {
  const rows = await readStore<RetrievalBudgetState>(STORE_NAME);
  const existing = rows[0];
  if (!existing) return emptyState(now);
  const month = currentMonthKey(now);
  if (existing.monthKey !== month) {
    return { monthKey: month, spendUsd: 0, calls: 0, capUsd: existing.capUsd ?? DEFAULT_CAP_USD, updatedAt: now.toISOString() };
  }
  return existing;
}

async function writeState(state: RetrievalBudgetState): Promise<void> {
  await writeStore<RetrievalBudgetState>(STORE_NAME, [state]);
}

export type RetrievalBudgetCheckResult = { allowed: true; remaining: number } | { allowed: false; reason: string };

/**
 * Pure budget-boundary decision - mirrors isOverAdjudicatorBudget exactly (fail-closed AT the
 * cap, not just over it, and a known projected cost also blocks a call that would cross it).
 */
export function isOverRetrievalBudget(spendUsd: number, projectedCostUsd: number, capUsd: number): boolean {
  return spendUsd >= capUsd || spendUsd + projectedCostUsd > capUsd;
}

export async function checkBudget(opts: { now?: Date; projectedCostUsd?: number } = {}): Promise<RetrievalBudgetCheckResult> {
  const now = opts.now ?? new Date();
  const state = await readState(now);
  const projected = opts.projectedCostUsd ?? 0;

  const durable = await durableMonthlySpentUsd(now);
  const effectiveSpend = durable != null ? Math.max(state.spendUsd, durable) : state.spendUsd;

  if (isOverRetrievalBudget(effectiveSpend, projected, state.capUsd)) {
    return {
      allowed: false,
      reason: `Monthly embeddings budget cap reached ($${effectiveSpend.toFixed(4)} of $${state.capUsd} this ${state.monthKey}).`,
    };
  }
  return { allowed: true, remaining: state.capUsd - effectiveSpend };
}

export async function recordSpend(costUsd: number, opts: { now?: Date } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const state = await readState(now);
  state.spendUsd = round6(state.spendUsd + costUsd);
  state.calls += 1;
  state.updatedAt = now.toISOString();
  await writeState(state);

  if (isSupabaseConfigured() && Number.isFinite(costUsd) && costUsd >= 0) {
    try {
      const tenantId = await currentTenantId();
      await recordSpendSupabase({ tenantId, platform: RETRIEVAL_PLATFORM, costUsd });
    } catch (e) {
      log.warn?.("retrieval-twin durable spend write failed (non-fatal)", { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

export async function getBudgetState(now?: Date): Promise<RetrievalBudgetState> {
  return readState(now ?? new Date());
}

export async function setBudgetCap(capUsd: number, now: Date = new Date()): Promise<void> {
  const state = await readState(now);
  state.capUsd = capUsd;
  state.updatedAt = now.toISOString();
  await writeState(state);
}

function round6(n: number): number {
  return Math.round(n * 1_000_000) / 1_000_000;
}
