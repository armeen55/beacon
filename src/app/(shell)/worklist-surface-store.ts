import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { TodayMovesHeroData } from "./today-moves-data";

/**
 * worklist-surface-store (2026-06-29) — a tenant-scoped stale-while-revalidate cache of
 * the fully-computed `/worklist` surface. The cold render rebuilds the demand graph from
 * Supabase (~32s) on EVERY visit — only `react.cache` (per-request), no cross-request
 * persistence — flooring the page at ~50s. This caches the final `TodayMovesHeroData` so
 * a cold render serves the last snapshot INSTANTLY and refreshes in the background.
 *
 * Honest staleness: the snapshot carries `computedAt` (the UI shows "updated N ago"), the
 * TTL bounds drift, and mutating actions (prepare / enrich-live / mark-shipped) invalidate
 * it so operator changes reflect on the next load. Tenant-scoped (see store-classification)
 * so one tenant never serves another's surface.
 */

const STORE = "worklist-surface";

/** Serve the cached snapshot instantly always; background-refresh once it's older than this. */
export const SURFACE_FRESH_MS = 15 * 60 * 1000;

export type WorklistSurfaceRow = { computedAt: string; data: TodayMovesHeroData };

export async function readWorklistSurface(): Promise<WorklistSurfaceRow | null> {
  const rows = await readStore<WorklistSurfaceRow>(STORE, []).catch(() => [] as WorklistSurfaceRow[]);
  const row = rows[0];
  return row && row.data ? row : null;
}

export async function writeWorklistSurface(data: TodayMovesHeroData, computedAtIso: string): Promise<void> {
  await writeStore<WorklistSurfaceRow>(STORE, [{ computedAt: computedAtIso, data }]).catch(() => {});
}

/** Invalidate the cache so the next /worklist load recomputes (call after a mutation). */
export async function invalidateWorklistSurface(): Promise<void> {
  await writeStore<WorklistSurfaceRow>(STORE, []).catch(() => {});
}

/** PURE: is a snapshot stale (or its timestamp unparseable)? */
export function isSurfaceStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > SURFACE_FRESH_MS;
}
