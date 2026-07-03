/**
 * pooled-verdict-store (2026-07-02, master plan item 34) - persistence for the pooled batch
 * verdicts computed by pooled-verdict-runner.ts, so /results (and, later, the learning/prior
 * readers - not wired this cycle, see the runner's doc comment) can read the latest pool for a
 * tenant without recomputing it on every page load.
 *
 * Follows the algorithm-weather-store.ts / aa-calibration-store.ts sibling pattern exactly: a
 * GLOBAL json-store (rows carry tenant_id because the nightly cron fans out across tenants with
 * no ambient request context) that is Supabase-mirrored so the write survives Vercel's read-only
 * filesystem. Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 *
 * COMPUTED-ONLY posture (mission hard rule): this store NEVER mutates a per-page
 * shipped_change_proof record. It is its own, independent artifact - one row per (tenant,
 * planId, actionFamily), latest-computed-wins.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { ExperimentFamily } from "@/domains/experiments/experiment-eligibility";
import type { PooledVerdict } from "./pooled-verdict";

const STORE = "pooled-verdicts";

/** A detection older than this is not shown as "current" on /results - the runner recomputes
 *  every measure pass anyway, so a stale row only lingers if the runner stops firing, and a
 *  months-old batch line would confuse rather than help. */
export const POOLED_VERDICT_MAX_AGE_MS = 45 * 24 * 60 * 60 * 1000;

export type PooledVerdictRow = {
  tenant_id: string;
  plan_id: string;
  plan_date: string;
  action_family: ExperimentFamily;
  computed_at: string;
  n: number;
  pooled_lift_pct: number;
  standard_error: number;
  z_score: number;
  permutation_p: number;
  verdict: PooledVerdict;
  sentence: string | null;
  /** The exact pages that fed the pool, for an operator-facing "which pages" expander later. */
  pages: string[];
};

function rowKey(tenantId: string, planId: string, actionFamily: string): string {
  return `${tenantId}::${planId}::${actionFamily}`;
}

/** Upsert one pooled verdict row (latest computation for this (tenant, plan, lever) wins). */
export async function upsertPooledVerdict(row: PooledVerdictRow): Promise<void> {
  const rows = await readStore<PooledVerdictRow>(STORE, []);
  const key = rowKey(row.tenant_id, row.plan_id, row.action_family);
  const others = rows.filter((r) => rowKey(r.tenant_id, r.plan_id, r.action_family) !== key);
  await writeStore(STORE, [...others, row]);
}

/** All fresh (not stale) pooled verdicts for a tenant, newest computed first. Fail-soft -> []. */
export async function loadPooledVerdicts(
  tenantId: string,
  now: Date = new Date(),
): Promise<PooledVerdictRow[]> {
  try {
    const rows = await readStore<PooledVerdictRow>(STORE, []);
    return rows
      .filter((r) => r.tenant_id === tenantId)
      .filter((r) => {
        const age = now.getTime() - Date.parse(r.computed_at);
        return Number.isFinite(age) && age < POOLED_VERDICT_MAX_AGE_MS;
      })
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
  } catch {
    return [];
  }
}

/** The single freshest pooled verdict for a tenant (for a compact single-line surface like
 *  /results's batch line), or null when none exist / all are stale. Fail-soft -> null. */
export async function loadLatestPooledVerdict(
  tenantId: string,
  now: Date = new Date(),
): Promise<PooledVerdictRow | null> {
  const rows = await loadPooledVerdicts(tenantId, now);
  return rows[0] ?? null;
}
