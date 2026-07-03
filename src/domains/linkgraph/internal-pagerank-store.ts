import "server-only";

import { readStore, writeStore } from "@/lib/persistence/json-store";
import { log } from "@/lib/logger";
import type { InternalPageRankResult } from "./internal-pagerank";

/**
 * internal-pagerank-store (2026-07-03, BEACON_500 R18 / N23) - a tenant-scoped,
 * cross-request cache of the computed internal-authority snapshot
 * (`InternalPageRankResult`: per-page PageRank + BFS click-depth + orphan
 * status). The build reads the tenant's whole internal_links adjacency and is
 * independently useful to several surfaces (the buried-page + entity-interlink
 * triggers, a future authority column), so it is computed ONCE nightly and read
 * from here rather than recomputed per surface.
 *
 * Tenant-scoped (see store-classification) so one tenant never serves another's
 * link graph. Versioned so a shape change ignores stale snapshots. Serialization
 * is lossless (pure data: arrays of numbers/strings, no Maps/Dates/functions).
 */

const STORE = "internal-pagerank";

/** Bump when the snapshot SHAPE changes (fields consumers read). v1 is the
 *  first shape (pages[].authorityScore/clickDepth/orphaned/inboundCount). */
export const PAGERANK_SCHEMA_VERSION = 1;

/** Serve the cached snapshot instantly; a caller may background-refresh once
 *  it's older than this. */
export const PAGERANK_FRESH_MS = 24 * 60 * 60 * 1000;

/** Hard sanity ceiling - a snapshot larger than this is treated as corrupt and
 *  recomputed rather than trusted. */
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;

export type PageRankSnapshotRow = {
  schemaVersion: number;
  computedAt: string;
  data: InternalPageRankResult;
};

export async function readPageRankSnapshot(): Promise<PageRankSnapshotRow | null> {
  const rows = await readStore<PageRankSnapshotRow>(STORE, []).catch(() => [] as PageRankSnapshotRow[]);
  return rows[0] ?? null;
}

export async function writePageRankSnapshot(
  data: InternalPageRankResult,
  computedAtIso: string,
): Promise<void> {
  try {
    const row: PageRankSnapshotRow = {
      schemaVersion: PAGERANK_SCHEMA_VERSION,
      computedAt: computedAtIso,
      data,
    };
    const bytes = JSON.stringify(row).length;
    if (bytes > MAX_SNAPSHOT_BYTES) {
      log.warn("[internal-pagerank] refusing to persist oversized snapshot", { bytes });
      return;
    }
    await writeStore<PageRankSnapshotRow>(STORE, [row]);
  } catch (e) {
    log.warn("[internal-pagerank] write failed (fail-soft)", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

/** PURE: right version + the shape consumers depend on. A version mismatch or a
 *  missing `data.pages` array -> recompute, don't trust. */
export function isPageRankSnapshotValid(
  row: PageRankSnapshotRow | null,
): row is PageRankSnapshotRow {
  if (!row || row.schemaVersion !== PAGERANK_SCHEMA_VERSION) return false;
  return !!row.data && Array.isArray(row.data.pages);
}

/** PURE: is the snapshot stale (or its timestamp unparseable)? */
export function isPageRankStale(computedAtIso: string, nowMs: number): boolean {
  const t = Date.parse(computedAtIso);
  return !Number.isFinite(t) || nowMs - t > PAGERANK_FRESH_MS;
}
