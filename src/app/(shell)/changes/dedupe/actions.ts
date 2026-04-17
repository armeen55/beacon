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
