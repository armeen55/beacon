/**
 * Recommendation Lifecycle OS — Phase 3 (2026-04-27).
 *
 * Write-path helpers for the match runner. Isolated here so the runner
 * orchestrator stays readable and tests can mock at this boundary.
 *
 * File-first invariant + best-effort dual-write — same contract as the
 * Phase 1 `markRecommendedEditsAccepted` helper. A dual-write failure
 * is logged but does NOT fail the runner; the local file is the
 * canonical source for the next scan, so consistency is restored on
 * the next successful sync.
 */

import "server-only";

import { log } from "@/lib/logger";
import {
  readDotDataJson,
  writeDotDataJson,
} from "@/lib/persistence/dotdata-json";
import {
  syncChangelogEntries,
  syncRecommendedEdits,
} from "@/lib/persistence/dual-write";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendedEditRow } from "../recommended-edits-persistence";

const RECOMMENDED_EDITS_STORE = "recommended-edits";
const CHANGELOG_STORE = "imported-changes";

/**
 * Persist a set of `recommended_edits` lifecycle updates. Caller has
 * already merged each row's existing fields with the per-edit
 * `LifecycleUpdate`, so `updatedRows` are the FULL post-update rows
 * keyed by `id`.
 *
 * Reads the local file, replaces matching ids in place, writes back,
 * then dual-writes the changed rows. Idempotent.
 */
export async function persistLifecycleUpdates(
  updatedRows: ReadonlyArray<RecommendedEditRow>,
  tenantId: string,
): Promise<void> {
  if (updatedRows.length === 0) return;
  const existing =
    (await readDotDataJson<RecommendedEditRow[]>(RECOMMENDED_EDITS_STORE)) ?? [];
  const byId = new Map<string, RecommendedEditRow>();
  for (const row of existing) byId.set(row.id, row);
  for (const row of updatedRows) byId.set(row.id, row);
  await writeDotDataJson(RECOMMENDED_EDITS_STORE, [...byId.values()]);
  try {
    await syncRecommendedEdits(updatedRows as RecommendedEditRow[], tenantId);
  } catch (err) {
    log.warn("[match-runner] recommended_edits dual-write failed", {
      tenantId,
      updatedCount: updatedRows.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Stamp `live_at` onto a set of `changelog_entries` rows. Idempotent
 * — only updates rows whose current `live_at` is null/undefined,
 * preserving the FIRST-detection timestamp (re-running a scan after
 * the row is already stamped is a no-op for that row).
 *
 * The 2026-04-27 Phase 4 caveat: the verdict engine does NOT yet
 * consume `live_at`. Phase 4 will switch the baseline split to
 * `entry.live_at ?? entry.timestamp`. Until then, stamping is data
 * collection only — no attribution-math change.
 */
export async function persistChangelogLiveAt(
  updates: ReadonlyArray<{ changelogId: string; liveAt: string }>,
  changelog: ReadonlyArray<ChangelogEntry>,
  tenantId: string,
): Promise<number> {
  if (updates.length === 0) return 0;
  const updateMap = new Map<string, string>();
  for (const u of updates) updateMap.set(u.changelogId, u.liveAt);

  const existing =
    (await readDotDataJson<ChangelogEntry[]>(CHANGELOG_STORE)) ?? [];
  const stampedRows: ChangelogEntry[] = [];
  const next: ChangelogEntry[] = [];
  for (const row of existing) {
    const liveAt = updateMap.get(row.id);
    // Idempotent: skip if already stamped or row not in our update set.
    if (liveAt && (row.live_at === null || row.live_at === undefined)) {
      const stamped: ChangelogEntry = {
        ...row,
        live_at: liveAt,
        updated_at: new Date().toISOString(),
      };
      stampedRows.push(stamped);
      next.push(stamped);
    } else {
      next.push(row);
    }
  }

  if (stampedRows.length === 0) {
    // Caller's update list referenced rows that are either already
    // stamped or not in the file. Either way no write is needed.
    return 0;
  }

  await writeDotDataJson(CHANGELOG_STORE, next);
  try {
    await syncChangelogEntries(stampedRows, tenantId);
  } catch (err) {
    log.warn("[match-runner] changelog live_at dual-write failed", {
      tenantId,
      stampedCount: stampedRows.length,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return stampedRows.length;

  // Note for future phases: a separate path could narrow the
  // dual-write to JUST the live_at column rather than the full row.
  // Keeping it as a full-row upsert here matches the existing
  // `syncChangelogEntries` pass-through pattern and avoids introducing
  // a new helper. If column-narrow updates become common, generalize
  // dual-write.ts; out of Phase 3 scope.
}
