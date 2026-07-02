/**
 * seasonal/event-calendar-store (BEACON_500 item 69) - persistence for the
 * tenant's event calendar. Follows the seasonal-windows/peak-calendar/
 * family-profiles sibling pattern exactly: a GLOBAL json-store (rows carry
 * tenant_id, so a derive pass can run per-tenant with no ambient request
 * context, same rationale as every other store in this domain), Supabase-
 * mirrored so an operator's edit survives Vercel's read-only filesystem.
 *
 * Registered in store-classification.ts (GLOBAL_STORES) + json-store.ts
 * (SUPABASE_MIRRORED_STORES).
 *
 * Operator-facing CRUD (add/edit/delete) lives here too, alongside the
 * derive-and-merge path the seasonality pass calls after building fresh
 * family profiles.
 */

import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { mergeDerivedEntries, type EventCalendarEntry } from "./event-calendar";

const STORE = "event-calendar";

export type EventCalendarRow = {
  tenant_id: string;
  entries: EventCalendarEntry[];
  updatedAt: string;
};

async function readAllRows(): Promise<EventCalendarRow[]> {
  try {
    return (await readStore<EventCalendarRow>(STORE, [])) ?? [];
  } catch {
    return [];
  }
}

/** This tenant's full calendar, or [] when the tenant has none yet. Fail-soft. */
export async function loadEventCalendar(tenantId: string): Promise<EventCalendarEntry[]> {
  if (!tenantId) return [];
  const rows = await readAllRows();
  return rows.find((r) => r.tenant_id === tenantId)?.entries ?? [];
}

/** Replace this tenant's whole calendar (latest wins; other tenants
 *  untouched). Used by the operator-facing add/edit/delete actions, which
 *  read-modify-write the full list. */
export async function saveEventCalendar(tenantId: string, entries: EventCalendarEntry[], now: Date = new Date()): Promise<void> {
  if (!tenantId) return;
  const rows = await readAllRows();
  const others = rows.filter((r) => r.tenant_id !== tenantId);
  await writeStore(STORE, [...others, { tenant_id: tenantId, entries, updatedAt: now.toISOString() }]);
}

/**
 * Merge freshly-derived entries (from the family demand profile pass) into
 * the tenant's stored calendar, WITHOUT touching any entry the operator
 * already has (mergeDerivedEntries never overwrites an existing id). Called
 * after each family-demand-profile pass; a no-op when nothing new derives.
 */
export async function mergeDerivedEventsIntoCalendar(
  tenantId: string,
  freshlyDerived: readonly EventCalendarEntry[],
  now: Date = new Date(),
): Promise<EventCalendarEntry[]> {
  if (!tenantId) return [];
  const existing = await loadEventCalendar(tenantId);
  const merged = mergeDerivedEntries(existing, freshlyDerived);
  if (merged.length !== existing.length) {
    await saveEventCalendar(tenantId, merged, now);
  }
  return merged;
}

/** Add or replace one entry by id (operator add/edit). Fail-soft -> false. */
export async function upsertEventCalendarEntry(tenantId: string, entry: EventCalendarEntry, now: Date = new Date()): Promise<boolean> {
  if (!tenantId || !entry.id) return false;
  try {
    const existing = await loadEventCalendar(tenantId);
    const others = existing.filter((e) => e.id !== entry.id);
    await saveEventCalendar(tenantId, [...others, entry], now);
    return true;
  } catch {
    return false;
  }
}

/** Remove one entry by id (operator delete). Fail-soft -> false. */
export async function deleteEventCalendarEntry(tenantId: string, entryId: string, now: Date = new Date()): Promise<boolean> {
  if (!tenantId || !entryId) return false;
  try {
    const existing = await loadEventCalendar(tenantId);
    const remaining = existing.filter((e) => e.id !== entryId);
    if (remaining.length === existing.length) return false; // nothing to delete
    await saveEventCalendar(tenantId, remaining, now);
    return true;
  } catch {
    return false;
  }
}
