/**
 * seasonal/peak-calendar-store (2026-07-02, master plan item 63) - persistence
 * for the peak calendar (seasonal windows, cross-checked against DataForSEO
 * Labs historical volume where available), so the daily plan candidate feed
 * reads confirmed windows at $0 without recomputing the Labs cross-check.
 *
 * Follows the seasonal-windows sibling pattern exactly: a GLOBAL json-store
 * (rows carry tenant_id since the nightly cron fans out across tenants with no
 * ambient request context), Supabase-mirrored so the write survives Vercel's
 * read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { PeakCalendarEntry } from "./seasonality";

const STORE = "seasonal-peak-calendar";

/** A calendar pass older than this is not read anywhere - nightly reruns keep
 *  it fresh at $0 (mirrors SEASONAL_MAX_AGE_MS in seasonal-store.ts). */
const PEAK_CALENDAR_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

export type PeakCalendarSummaryRow = {
  tenant_id: string;
  computed_at: string;
  calendar: PeakCalendarEntry[];
};

/** Persist the latest peak calendar for a tenant (latest wins; other tenants
 *  untouched). An EMPTY list is written too: "checked, nothing proven yet"
 *  keeps computed_at fresh and is a different truth from "never checked". */
export async function writePeakCalendar(row: PeakCalendarSummaryRow): Promise<void> {
  const rows = await readStore<PeakCalendarSummaryRow>(STORE, []);
  const others = rows.filter((r) => r.tenant_id !== row.tenant_id);
  await writeStore(STORE, [...others, row]);
}

/** Latest peak calendar pass for the tenant, or null when absent / older than
 *  14 days. Fail-soft -> null. */
export async function readPeakCalendarSummary(
  tenantId: string,
  now: Date = new Date(),
): Promise<PeakCalendarSummaryRow | null> {
  try {
    const rows = await readStore<PeakCalendarSummaryRow>(STORE, []);
    const mine = rows
      .filter((r) => r.tenant_id === tenantId)
      .sort((a, b) => b.computed_at.localeCompare(a.computed_at));
    const latest = mine[0];
    if (!latest) return null;
    const age = now.getTime() - Date.parse(latest.computed_at);
    if (!Number.isFinite(age) || age >= PEAK_CALENDAR_MAX_AGE_MS) return null;
    return latest;
  } catch {
    return null;
  }
}

/** $0 read for surfaces: this tenant's peak calendar, or [] when no fresh pass
 *  exists. */
export async function loadPeakCalendar(tenantId: string, now: Date = new Date()): Promise<PeakCalendarEntry[]> {
  const row = await readPeakCalendarSummary(tenantId, now);
  return row?.calendar ?? [];
}
