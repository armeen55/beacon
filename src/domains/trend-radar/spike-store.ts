/**
 * trend-radar/spike-store (2026-07-02, master plan item 14) - persistence for
 * the nightly query-spike pass, so the Today Demand band and the daily plan
 * builder read this week's spikes at $0.
 *
 * Follows the gap-store / pipeline-health-store sibling pattern exactly: a
 * GLOBAL json-store (rows carry tenant_id because the nightly cron fans out
 * across tenants with no ambient request context) that is Supabase-mirrored so
 * the write survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { QuerySpike } from "./query-spikes";

const STORE = "trend-query-spikes";

/** A spike list older than this is not shown anywhere (a week-old "this week"
 *  claim would be a lie; honest staleness beats stale urgency). */
const SPIKES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type QuerySpikeSummaryRow = {
  tenant_id: string;
  computed_at: string;
  /** The newest finalized GSC day the week counted back from (null when the
   *  pass ran on empty data). */
  anchor_date: string | null;
  spikes: QuerySpike[];
};

/** Persist the latest spike pass for a tenant (latest wins; other tenants
 *  untouched). An EMPTY list is written too: "checked, nothing spiking" keeps
 *  computed_at fresh and is a different truth from "never checked". */
export async function writeQuerySpikeSummary(row: QuerySpikeSummaryRow): Promise<void> {
  const rows = await readStore<QuerySpikeSummaryRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest spike pass for the tenant, or null when absent / older than 7 days.
 *  Fail-soft -> null. */
export async function readQuerySpikeSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<QuerySpikeSummaryRow | null> {
  try {
    const rows = await readStore<QuerySpikeSummaryRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= SPIKES_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for surfaces: this week's ranked spikes, or [] when no fresh pass. */
export async function loadQuerySpikes(tenantId: string, now: Date = new Date()): Promise<QuerySpike[]> {
  const row = await readQuerySpikeSummary(tenantId, now);
  return row?.spikes ?? [];
}
