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

export async function readTodaySurface(): Promise<TodaySurfaceRow | null> {
  const rows = await readStore<TodaySurfaceRow>(STORE, []).catch(() => [] as TodaySurfaceRow[]);
  const row = rows[0];
  return row && row.data ? row : null;
}

export async function writeTodaySurface(data: TodayComposite, computedAtIso: string): Promise<void> {
  await writeStore<TodaySurfaceRow>(STORE, [{ computedAt: computedAtIso, data }]).catch(() => {});
}

/** Invalidate so the next Today load recomputes (call after a mutation that changes Today). */
export async function invalidateTodaySurface(): Promise<void> {
  await writeStore<TodaySurfaceRow>(STORE, []).catch(() => {});
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isTodaySurfaceStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > TODAY_SURFACE_FRESH_MS;
}
