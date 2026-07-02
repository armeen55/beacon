/**
 * refresh/refresh-store (BEACON_500 item 56) - persistence for the nightly refresh queue,
 * so the Today Demand band and the daily plan builder read the ranked fading pages + their
 * evidence briefs at $0.
 *
 * Follows the seasonal/seasonal-store sibling pattern exactly: a GLOBAL json-store (rows
 * carry tenant_id because the nightly cron fans out across tenants with no ambient request
 * context) that is Supabase-mirrored so the write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { RefreshBrief } from "./refresh-brief";

const STORE = "refresh-queue";

/** A refresh pass older than this is not shown anywhere - the numbers in a month-stale
 *  "losing N clicks a month" claim drift from the truth; nightly reruns keep this fresh. */
const REFRESH_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type RefreshQueueSummaryRow = {
  tenant_id: string;
  computed_at: string;
  /** How many pages the quarterly decay scan considered for this tenant. */
  pagesConsidered: number;
  /** Ranked worst-lost-clicks-first, already floored + capped by the nightly pass. */
  queue: RefreshBrief[];
};

/** Persist the latest refresh pass for a tenant (latest wins; other tenants untouched). An
 *  EMPTY queue is written too: "checked, nothing fading" keeps computed_at fresh and is a
 *  different truth from "never checked". */
export async function writeRefreshQueueSummary(row: RefreshQueueSummaryRow): Promise<void> {
  const rows = await readStore<RefreshQueueSummaryRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest refresh pass for the tenant, or null when absent / older than 14 days.
 *  Fail-soft -> null. */
export async function readRefreshQueueSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<RefreshQueueSummaryRow | null> {
  try {
    const rows = await readStore<RefreshQueueSummaryRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= REFRESH_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for surfaces: this tenant's ranked refresh queue, or [] when no fresh pass
 *  exists. */
export async function loadRefreshQueue(tenantId: string, now: Date = new Date()): Promise<RefreshBrief[]> {
  const row = await readRefreshQueueSummary(tenantId, now);
  return row?.queue ?? [];
}
