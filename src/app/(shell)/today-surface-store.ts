import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { TodayComposite } from "./today-view-data";

/**
 * today-surface-store (FINAL PREMIUM PLAN item 93) - a tenant-scoped stale-while-revalidate
 * cache of the composed Today slice (TodayComposite), the same pattern as the /changes
 * surface. Serve the last snapshot INSTANTLY (the UI can show "updated N ago" from
 * computedAt), refresh in the background once it is older than the TTL, and invalidate on
 * mutations that change what Today shows (plan accept/apply/skip, prepare, curation).
 * Mirrored to Supabase json_store_blobs (see json-store SUPABASE_MIRRORED_STORES) so hosted
 * lambdas share the warm snapshot across instances - that is what makes "warm under 2s"
 * true in production, not just on a warm lambda.
 */

const STORE = "today-surface";

/** Serve the cached snapshot instantly always; background-refresh once older than this. */
export const TODAY_SURFACE_FRESH_MS = 10 * 60 * 1000;

export type TodaySurfaceRow = { computedAt: string; data: TodayComposite };

/**
 * Sibling fix (2026-07-10 hygiene batch) - `opts.tenantId`, the same purpose as
 * changes-surface-store's: today-view-data.ts's after() background rebuild (and the
 * nightly refreshTodaySurface entry) already resolve the tenant they mean explicitly -
 * thread that SAME tenant into the read/write instead of falling back to json-store's
 * ambient currentTenantSlug() resolution, which is not guaranteed correct outside the
 * render's request scope inside after(). Optional only for backward compatibility.
 */
export async function readTodaySurface(tenantId?: string): Promise<TodaySurfaceRow | null> {
  const rows = await readStore<TodaySurfaceRow>(STORE, [], { tenantId }).catch(() => [] as TodaySurfaceRow[]);
  const row = rows[0];
  return row && row.data ? row : null;
}

export async function writeTodaySurface(data: TodayComposite, computedAtIso: string, tenantId?: string): Promise<void> {
  await writeStore<TodaySurfaceRow>(STORE, [{ computedAt: computedAtIso, data }], { tenantId }).catch(() => {});
}

/**
 * Mark Today stale while preserving its last-known-good snapshot. The next
 * request serves that snapshot immediately and replaces it in the background;
 * user actions must never turn a warm page back into a cold loading screen.
 */
export async function invalidateTodaySurface(tenantId?: string): Promise<void> {
  const existing = await readTodaySurface(tenantId).catch(() => null);
  if (existing) {
    await writeStore<TodaySurfaceRow>(
      STORE,
      [{ ...existing, computedAt: new Date(0).toISOString() }],
      tenantId ? { tenantId } : {},
    ).catch(() => {});
  }
  const { invalidateCustomerSurface } = await import("./customer-surface-store");
  await invalidateCustomerSurface(tenantId).catch(() => {});
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isTodaySurfaceStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > TODAY_SURFACE_FRESH_MS;
}
