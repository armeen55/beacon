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

export async function checkBudget(
  opts: { now?: Date; projectedCostUsd?: number } = {},
): Promise<BudgetCheckResult> {
  const now = opts.now ?? new Date();
  const state = await readState(now);
  const projected = opts.projectedCostUsd ?? 0;
  if (state.spendUsd + projected > state.capUsd) {
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
