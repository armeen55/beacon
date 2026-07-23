"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { getRepository } from "@/lib/persistence/repositories";
import {
  editLifecycleStatus,
  markRecommendedEditsAsShipped,
} from "@/domains/recommendations/recommended-edits-persistence";
import { markProposalApplied } from "@/domains/decision/proposal-store";
import { invalidateCoreSurfaces } from "../surface-release";

/**
 * changes/actions (CORE 100K cutover, 2026-07-22) — the manual "Mark implemented"
 * action. Publishing authority is MANUAL and server-enforced: the kernel never
 * writes a live page and never flips this itself. The operator confirms they
 * applied a Ready change; we record it as applied so the pre-ship queue drops it
 * (its measurement then lives in the proof ledger).
 */
export type MarkProposalImplementedResponse = {
  success: boolean;
  error?: string;
};

export async function markProposalImplementedAction(args: {
  proposalId: string;
}): Promise<MarkProposalImplementedResponse> {
  const action = "markProposalImplemented";
  const t0 = Date.now();
  log.info("Action started", { action, params: { proposalId: args.proposalId } });

  // Same server-side publish authority the actual push path carries: a stale or
  // hand-crafted client request cannot mark work live merely because it reached
  // the server action.
  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to mark this change implemented." };
  }
  if (!args.proposalId) {
    return { success: false, error: "No change was specified." };
  }

  const tenantId = await currentTenantId();
  try {
    const ok = await markProposalApplied(tenantId, args.proposalId);
    if (!ok) {
      return { success: false, error: "I couldn't find that change to mark it implemented." };
    }
    await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
    revalidatePath("/", "layout");
    log.info("Action completed", { action, durationMs: Date.now() - t0, params: { proposalId: args.proposalId } });
    return { success: true };
  } catch (err) {
    log.error("markProposalImplemented: failed", {
      proposalId: args.proposalId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: `Failed to mark implemented: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/**
 * Results-timeline "Mark shipped" — confirms a previously-accepted recommended
 * edit is live on the page, flipping its lifecycle to verified-live. Server-side
 * publish authority is enforced (a stale UI cannot skip Accept). Distinct from
 * the Changes-queue "Mark implemented" above: this operates on the persisted
 * recommended_edits row linked to a changelog entry that Results renders.
 */
function changelogJoinKey(entry: {
  source_rec_id?: string | null;
  action_type?: string | null;
  target_element_key?: string | null;
}): string | null {
  if (!entry.source_rec_id || !entry.action_type || !entry.target_element_key) return null;
  return `${entry.source_rec_id}__${entry.action_type}__${entry.target_element_key}`;
}

function indexEditsByJoinKey<
  T extends { rec_id?: string | null; action_type?: string | null; target_element_key?: string | null },
>(edits: readonly T[]): Map<string, T> {
  const map = new Map<string, T>();
  for (const edit of edits) {
    if (!edit.rec_id || !edit.action_type || !edit.target_element_key) continue;
    map.set(`${edit.rec_id}__${edit.action_type}__${edit.target_element_key}`, edit);
  }
  return map;
}

export type MarkChangelogEditShippedResponse = {
  success: boolean;
  error?: string;
  flipped?: number;
  skipped?: number;
};

export async function markChangelogEditShipped(args: {
  changelogId: string;
}): Promise<MarkChangelogEditShippedResponse> {
  const action = "markChangelogEditShipped";
  const t0 = Date.now();
  log.info("Action started", { action, params: { changelogId: args.changelogId } });

  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to mark this change live." };
  }

  const tenantId = await currentTenantId();
  const repo = getRepository().forTenant(tenantId);

  let changelogEntries;
  let recommendedEdits;
  try {
    [changelogEntries, recommendedEdits] = await Promise.all([
      repo.getChangelogEntries(),
      repo.getRecommendedEdits(),
    ]);
  } catch (err) {
    log.error("markChangelogEditShipped: read failed", {
      changelogId: args.changelogId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: `Failed to read lifecycle data: ${err instanceof Error ? err.message : String(err)}` };
  }

  const entry = changelogEntries.find((e) => e.id === args.changelogId);
  if (!entry) return { success: false, error: "Changelog entry not found." };

  const joinKey = changelogJoinKey(entry);
  if (!joinKey) {
    return {
      success: false,
      error: "This changelog entry has no linked recommended edit, so there's nothing to mark as shipped.",
    };
  }

  const edit = indexEditsByJoinKey(recommendedEdits).get(joinKey);
  if (!edit) {
    return { success: false, error: "No matching recommended edit row found for this changelog entry." };
  }

  const status = editLifecycleStatus(edit);
  if (status === "recommended") {
    return {
      success: false,
      error:
        "Accept the recommendation first. Mark Shipped only confirms an already-accepted change is live on the page; it doesn't accept the recommendation for you.",
    };
  }
  if (status !== "accepted") return { success: true, flipped: 0, skipped: 1 };

  try {
    const result = await markRecommendedEditsAsShipped({ editIds: [edit.id], tenantId });
    log.info("Action completed", { action, durationMs: Date.now() - t0, params: { changelogId: args.changelogId, flipped: result.flipped } });
    if (result.flipped > 0) await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
    revalidatePath("/", "layout");
    return { success: true, flipped: result.flipped, skipped: result.skipped };
  } catch (err) {
    log.error("markChangelogEditShipped: persistence flip failed", {
      changelogId: args.changelogId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { success: false, error: `Failed to mark edit shipped: ${err instanceof Error ? err.message : String(err)}` };
  }
}
