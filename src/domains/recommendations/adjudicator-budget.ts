import "server-only";

/**
 * Adjudicator budget guardrail — Phase v7 Commit 3 (2026-04-23).
 *
 * Tracks monthly LLM spend in `.data/llm-budget.json`. Hard-caps calls
 * when the spend hits the configured limit for the current month. The
 * cap is small by design ($10 default for Ritz dogfood). Callers check
 * before calling the LLM and increment after.
 *
 * The budget store is single-writer (the adjudicator runs server-side
 * from /recommendations page render or cron). No lock needed at this
 * scale; if two renders race the worst case is a fractional overshoot.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE_NAME = "llm-budget";
const DEFAULT_CAP_USD = 10;

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

async function readState(now: Date): Promise<AdjudicatorBudgetState> {
  const rows = await readStore<AdjudicatorBudgetState>(STORE_NAME);
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

async function writeState(state: AdjudicatorBudgetState): Promise<void> {
  await writeStore<AdjudicatorBudgetState>(STORE_NAME, [state]);
}

export type BudgetCheckResult =
  | { allowed: true; remaining: number }
  | { allowed: false; reason: string };

/**
 * Pure budget-boundary decision (wave-10, 2026-06-14). Blocks when spend is
 * ALREADY at/over the cap, OR when this call's projected cost would push the
 * total OVER it.
 *
 * The first clause (`spendUsd >= capUsd`) makes the cap fail-closed AT the
 * boundary — matching the native-polling path (`budget.ts`: `spent >= cap`)
 * and `monthly.ts`. Pre-fix the check was only `spendUsd + projected > capUsd`,
 * so with `projected = 0` (cost unknown at call time — the DEFAULT, since
 * adjudicate.ts calls checkBudget without a projected cost) a call made at
 * spend EXACTLY == cap slipped through (`cap + 0 > cap` is false), letting the
 * adjudicator exceed its monthly cap by one call. The second clause still lets
 * a KNOWN-cost call land exactly on the cap from below (not over-strict).
 * Matters once `BEACON_LLM_PROVIDER` flips off `deterministic`.
 */
export function isOverAdjudicatorBudget(
  spendUsd: number,
  projectedCostUsd: number,
  capUsd: number,
): boolean {
  return spendUsd >= capUsd || spendUsd + projectedCostUsd > capUsd;
}

export async function checkBudget(
  opts: { now?: Date; projectedCostUsd?: number } = {},
): Promise<BudgetCheckResult> {
  const now = opts.now ?? new Date();
  const state = await readState(now);
  const projected = opts.projectedCostUsd ?? 0;
  if (isOverAdjudicatorBudget(state.spendUsd, projected, state.capUsd)) {
    return {
      allowed: false,
      reason: `Monthly adjudicator budget cap reached (${state.spendUsd.toFixed(4)} / ${state.capUsd} USD this ${state.monthKey}).`,
    };
  }
  return { allowed: true, remaining: state.capUsd - state.spendUsd };
}

export async function recordSpend(costUsd: number, opts: { now?: Date } = {}): Promise<void> {
  const now = opts.now ?? new Date();
  const state = await readState(now);
  state.spendUsd = round6(state.spendUsd + costUsd);
  state.calls += 1;
  state.updatedAt = now.toISOString();
  await writeState(state);
}

export async function getBudgetState(now?: Date): Promise<AdjudicatorBudgetState> {
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
