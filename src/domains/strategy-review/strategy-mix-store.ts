import "server-only";

/**
 * strategy-review/strategy-mix-store (2026-07-02, master plan item 51) - persistence for
 * the weekly strategy review's proposed lever mix + focus families, so the coming week's
 * plan builder and the Monday recap band read the freshest signed memo at $0.
 *
 * Follows the trend-radar/spike-store + seasonal/seasonal-store sibling pattern exactly: a
 * GLOBAL json-store (rows carry tenant_id because the Sunday-night cron fans out across
 * tenants with no ambient request context) that is Supabase-mirrored so the write survives
 * Vercel's read-only filesystem. UNLIKE those "latest wins" stores, this one is an
 * APPEND-ONLY history capped at the last MAX_HISTORY_WEEKS per tenant - "never mutate
 * history" applies here just like the proof ledger; a past week's memo is never rewritten,
 * only superseded by a newer append.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";

const STORE = "strategy-mix-history";

/** Keep at most this many weeks of history per tenant (append-only, oldest dropped). */
export const MAX_HISTORY_WEEKS = 12;

export type StrategyLeverWeight = { family: string; weight: number; reason: string };
export type StrategyFocusFamily = { family: string; reason: string };

export type StrategyMixRecord = {
  tenant_id: string;
  /** ISO date (Monday) the mix applies to - also the natural idempotency key
   *  alongside tenant_id: one review per tenant per week. */
  weekOf: string;
  leverMix: StrategyLeverWeight[];
  focusFamilies: StrategyFocusFamily[];
  /** The signed memo, plain business English, dash-stripped, <= 900 chars. */
  memo: string;
  /** ISO timestamp the review actually ran and wrote this record. */
  appliedAt: string;
  /** "llm" when a real review produced this mix; "fail_open" when the LLM pass
   *  failed and the PREVIOUS week's mix was carried forward unchanged (still an
   *  explicit, visible record - never a silent gap in the history). */
  source: "llm" | "fail_open";
};

async function readAll(): Promise<StrategyMixRecord[]> {
  try {
    return (await readStore<StrategyMixRecord>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

/** Full history for a tenant, oldest first. Fail-soft -> []. */
export async function loadStrategyMixHistory(tenantId: string): Promise<StrategyMixRecord[]> {
  const rows = await readAll();
  return rows.filter((r) => r.tenant_id === tenantId).sort((a, b) => a.weekOf.localeCompare(b.weekOf));
}

/** The most recent record for a tenant, or null when none exists yet. Fail-soft -> null. */
export async function loadLatestStrategyMix(tenantId: string): Promise<StrategyMixRecord | null> {
  const history = await loadStrategyMixHistory(tenantId);
  return history.length > 0 ? history[history.length - 1]! : null;
}

/** True when a record for this tenant + week already exists (the per-week idempotency
 *  guard the cron route checks before running a second review the same Sunday). */
export async function hasStrategyMixForWeek(tenantId: string, weekOf: string): Promise<boolean> {
  const rows = await readAll();
  return rows.some((r) => r.tenant_id === tenantId && r.weekOf === weekOf);
}

/**
 * Append one record, once per (tenant, weekOf). Additive-only + capped: never overwrites or
 * removes an existing week's record; trims the tenant's own history to the last
 * MAX_HISTORY_WEEKS entries (oldest dropped first), leaving every OTHER tenant's rows
 * untouched. No-op (returns false) when a record for this tenant+week already exists -
 * "never mutate history" means a second Sunday run for the same week is refused, not
 * silently overwritten.
 */
export async function appendStrategyMixRecord(record: StrategyMixRecord): Promise<boolean> {
  try {
    const rows = await readAll();
    if (rows.some((r) => r.tenant_id === record.tenant_id && r.weekOf === record.weekOf)) return false;
    const mine = rows.filter((r) => r.tenant_id === record.tenant_id);
    const others = rows.filter((r) => r.tenant_id !== record.tenant_id);
    const trimmed = [...mine, record].sort((a, b) => a.weekOf.localeCompare(b.weekOf)).slice(-MAX_HISTORY_WEEKS);
    await writeStore(STORE, [...others, ...trimmed]);
    return true;
  } catch {
    return false;
  }
}
