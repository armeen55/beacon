/**
 * seasonal/seasonal-store (2026-07-02, master plan item 21) - persistence for
 * the nightly seasonality pass, so the Today Demand band and the daily plan
 * builder read detected seasonal windows at $0.
 *
 * Follows the trend-radar/spike-store sibling pattern exactly: a GLOBAL
 * json-store (rows carry tenant_id because the nightly cron fans out across
 * tenants with no ambient request context) that is Supabase-mirrored so the
 * write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { SeasonalQuery } from "./seasonality";

const STORE = "seasonal-windows";

/** A seasonal pass older than this is not shown anywhere (the archive itself
 *  is permanent, but a month-stale "prep by" claim could drift past the real
 *  deadline; nightly reruns keep this fresh at $0). */
const SEASONAL_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type SeasonalSummaryRow = {
  tenant_id: string;
  computed_at: string;
  /** How many months of archive the detector had for this tenant. */
  monthsOfHistory: number;
  seasonal: SeasonalQuery[];
};

/** Persist the latest seasonality pass for a tenant (latest wins; other
 *  tenants untouched). An EMPTY list is written too: "checked, nothing
 *  seasonal yet" keeps computed_at fresh and is a different truth from
 *  "never checked". */
export async function writeSeasonalSummary(row: SeasonalSummaryRow): Promise<void> {
  const rows = await readStore<SeasonalSummaryRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest seasonality pass for the tenant, or null when absent / older than
 *  14 days. Fail-soft -> null. */
export async function readSeasonalSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<SeasonalSummaryRow | null> {
  try {
    const rows = await readStore<SeasonalSummaryRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= SEASONAL_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for surfaces: this tenant's detected seasonal windows, or [] when
 *  no fresh pass exists. */
export async function loadSeasonalQueries(tenantId: string, now: Date = new Date()): Promise<SeasonalQuery[]> {
  const row = await readSeasonalSummary(tenantId, now);
  return row?.seasonal ?? [];
}
