import "server-only";

/**
 * Sprint 6A.2c (2026-04-26) — append-only audit log of Specific Edit
 * LLM provider calls.
 *
 * Mirrors the page-intent adjudicator history (`adjudicator-history.ts`)
 * but lives under a separate store key — `llm-history-specific-edits` —
 * so the two pipelines stay independently auditable. The two share the
 * `llm-budget.json` monthly cap (`adjudicator-budget.ts`) per the
 * Sprint 6A.2 plan's Option A.
 *
 * Hard rules (locked by tests):
 *   - Append-only. The store is a flat array of entries; old entries
 *     roll off when the cap is exceeded.
 *   - Status one of {"live_call", "empty_or_error", "budget_blocked"}.
 *     - live_call:       provider produced a non-empty bundle
 *     - empty_or_error:  provider produced an empty bundle (or the
 *                        provider call threw; runProviderAndPersist
 *                        catches and treats as empty)
 *     - budget_blocked:  pre-call budget gate refused; provider not
 *                        invoked
 *   - costUsd is the bundle's totalCostUsd (0 for budget-blocked).
 *   - tenantId stamped on every entry.
 *
 * Pure / no provider-call surface here. Persistence layer at
 * `recommended-edits-persistence.ts` is the only caller.
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE_NAME = "llm-history-specific-edits";

/** Cap — keep the last 2000 entries on disk; older roll off. Matches
 *  the adjudicator-history cap so dashboards / debugging can compare
 *  windows side-by-side. */
const HISTORY_CAP = 2000;

export type SpecificEditLLMHistoryEntry = {
  timestamp: string;
  tenantId: string;
  recId: string;
  evidenceHash: string;
  /** "openai" today; "anthropic" reserved for a future phase. */
  providerName: "openai";
  /** Specific model id (e.g. "gpt-5-mini"). Null when status is
   *  budget_blocked (no model committed-to). */
  model: string | null;
  /** USD spent on this call. 0 for budget_blocked + empty_or_error. */
  costUsd: number;
  /** Number of edits the bundle ultimately produced. 0 for non-live. */
  acceptedCount: number;
  status: "live_call" | "empty_or_error" | "budget_blocked";
  /** Free-form context: budget reason, error message excerpt, etc. */
  errorMessage?: string;
};

/**
 * Append one entry to the LLM history. Best-effort — failures here are
 * logged but not re-thrown; persistence is the more important side
 * effect of the caller's flow.
 */
export async function appendSpecificEditLLMHistory(
  entry: SpecificEditLLMHistoryEntry,
): Promise<void> {
  const rows = await readStore<SpecificEditLLMHistoryEntry>(STORE_NAME);
  rows.push(entry);
  if (rows.length > HISTORY_CAP) {
    rows.splice(0, rows.length - HISTORY_CAP);
  }
  await writeStore<SpecificEditLLMHistoryEntry>(STORE_NAME, rows);
}

/** Pure read for diagnostics / debugging. */
export async function readSpecificEditLLMHistory(): Promise<
  SpecificEditLLMHistoryEntry[]
> {
  return readStore<SpecificEditLLMHistoryEntry>(STORE_NAME);
}
