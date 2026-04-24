"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  softDeleteChangelogEntry,
  markDedupeReviewedBulk,
} from "@/domains/changelog/actions";

/**
 * Archive a CSV summary entry in favour of a PDF granular keeper.
 * Called from the /changes/dedupe review screen when operator confirms a pair.
 */
export async function archiveDuplicate(
  archiveId: string,
  keeperId: string,
): Promise<{ success: boolean; error?: string }> {
  const action = "archiveDuplicate";
  const t0 = Date.now();
  log.info("Action started", { action, params: { archiveId, keeperId } });

  const reason = `dedupe:csv_summary_of_${keeperId}`;
  const result = await softDeleteChangelogEntry(archiveId, reason);

  revalidatePath("/changes/dedupe");
  revalidatePath("/changes");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return result;
}

/**
 * Mark a single CSV-summary entry as operator-confirmed NOT a duplicate.
 * Called from the /changes/dedupe "Different edits — keep both" button.
 *
 * Phase B (2026-04-24): before this action, "keep both" only updated local
 * React state. On refresh, dedupe.ts:174 rebuilt the pair list from
 * `!archived && !dedupe_reviewed` and the same pair reappeared. This wrapper
 * flips `dedupe_reviewed=true` via the existing bulk helper so the decision
 * persists across refreshes and the pair disappears from future runs.
 */
export async function markPairNotDuplicate(
  archiveId: string,
): Promise<{ success: boolean; error?: string }> {
  const action = "markPairNotDuplicate";
  const t0 = Date.now();
  log.info("Action started", { action, params: { archiveId } });

  const result = await markDedupeReviewedBulk([archiveId]);
  if (!result.success) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: result.error ?? "unknown",
    });
    return { success: false, error: result.error };
  }
  if (result.count === 0) {
    // Entry not found OR already dedupe_reviewed. Surface explicitly rather
    // than silent success — the client needs to know it didn't change state.
    log.warn("markPairNotDuplicate no-op", {
      action,
      archiveId,
      reason: "entry not found or already reviewed",
    });
    return {
      success: false,
      error:
        "Entry not found, or was already marked reviewed. Refresh the page.",
    };
  }

  revalidatePath("/changes/dedupe");
  revalidatePath("/changes");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

/**
 * Bulk-dismiss all remaining CSV-summary ids as "reviewed, not duplicates".
 * Exposed for the one-time "Dismiss all remaining" button on /changes/dedupe.
 * After one click, the banner on /changes stays at zero forever — operator
 * will never see the legacy CSV/PDF overlap queue again.
 */
export async function dismissAllRemainingDedupe(
  ids: string[],
): Promise<{ success: boolean; count: number; error?: string }> {
  const r = await markDedupeReviewedBulk(ids);
  revalidatePath("/changes/dedupe");
  revalidatePath("/changes");
  return r;
}
