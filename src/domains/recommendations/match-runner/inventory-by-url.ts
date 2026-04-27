/**
 * Recommendation Lifecycle OS — Phase 3 (2026-04-27).
 *
 * Pure helper. Groups `page_element_inventory` rows by URL, keeping
 * only rows from the most recent `page_snapshots.fetched_at` per URL.
 *
 * The runner needs "the current state of each owned page". Since
 * `page_element_inventory` keeps rows from every historical snapshot
 * (one row per `(source_snapshot_id, element_key)`), filtering by the
 * latest snapshot per URL is required to avoid feeding the engine
 * stale or duplicated elements.
 */

import type { PageElementInventoryRow } from "@/domains/pages/extractors/persist";
import type { PageSnapshot } from "@/domains/pages/types";

export type InventoryByUrlResult = {
  /** url → element rows from the latest snapshot only. */
  byUrl: Map<string, PageElementInventoryRow[]>;
  /** url → the latest PageSnapshot (for `fetched_at` and `id` access). */
  latestSnapshotByUrl: Map<string, PageSnapshot>;
};

export function buildInventoryByUrl(
  inventory: ReadonlyArray<PageElementInventoryRow>,
  pageSnapshots: ReadonlyArray<PageSnapshot>,
): InventoryByUrlResult {
  const latestSnapshotByUrl = new Map<string, PageSnapshot>();
  for (const snap of pageSnapshots) {
    if (!snap.url) continue;
    const existing = latestSnapshotByUrl.get(snap.url);
    if (
      !existing ||
      Date.parse(snap.fetched_at) > Date.parse(existing.fetched_at)
    ) {
      latestSnapshotByUrl.set(snap.url, snap);
    }
  }

  const byUrl = new Map<string, PageElementInventoryRow[]>();
  for (const row of inventory) {
    const snap = latestSnapshotByUrl.get(row.url);
    if (!snap) continue;
    if (row.source_snapshot_id !== snap.id) continue;
    const list = byUrl.get(row.url);
    if (list) list.push(row);
    else byUrl.set(row.url, [row]);
  }

  return { byUrl, latestSnapshotByUrl };
}
