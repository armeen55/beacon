"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { changelogJoinKey, indexEditsByJoinKey } from "@/domains/attribution/lifecycle-classification";
import {
  editLifecycleStatus,
  markRecommendedEditsAsShipped,
} from "@/domains/recommendations/recommended-edits-persistence";

/**
 * W2 Step 2.4 (2026-05-01) — per-row "Mark shipped" affordance on /changes.
 *
 * Mirrors `markRecommendationShipped` on /recommendations, but operates on
 * a single changelog row. The /changes scorecard already carries the
 * `(source_rec_id, action_type, target_element_key)` triple needed to
 * resolve to the linked `recommended_edits` row via `changelogJoinKey`.
 *
 * Why two surfaces? An operator triages rec acceptance on /recommendations
 * and tracks ship status on /changes — both flows need the override
 * affordance. Sharing the same persistence helper keeps the lifecycle
 * truth in one place.
 *
 * Returns `flipped` count so the client can show "Marked live" feedback
 * and revalidate the row's pill.
 */
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

  const tenantId = await currentTenantId();
  const repo = getRepository().forTenant(tenantId);

  // Resolve the changelog entry → linked recommended_edits row via the
  // canonical join key. We re-build the join inside the action (instead
  // of trusting a client-provided edit id) so the lifecycle invariant
  // holds even when called from a stale UI that shipped before a row
  // was reclassified.
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
    return {
      success: false,
      error: `Failed to read lifecycle data: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }

  const entry = changelogEntries.find((e) => e.id === args.changelogId);
  if (!entry) {
    return {
      success: false,
      error: "Changelog entry not found.",
    };
  }

  const joinKey = changelogJoinKey(entry);
  if (!joinKey) {
    // Legacy / free-form changelog rows have no edit linkage. Nothing
    // for "Mark shipped" to flip — the row is already in
    // `imported_legacy` or `scan_confirmed` and the lifecycle classifier
    // owns its tab. Surface an honest error rather than silently
    // succeeding.
    return {
      success: false,
      error:
        "This changelog entry has no linked recommended edit, so there's nothing to mark as shipped.",
    };
  }

  const editsByKey = indexEditsByJoinKey(recommendedEdits);
  const edit = editsByKey.get(joinKey);
  if (!edit) {
    return {
      success: false,
      error: "No matching recommended edit row found for this changelog entry.",
    };
  }

  const status = editLifecycleStatus(edit);
  // M4 (operator audit, 2026-05-05) — refuse `recommended`. The UI
  // already hides the button on recommended rows, but a stale tab or
  // direct API call must not be allowed to skip the Accept step. Mark
  // Shipped is "operator confirms a previously-accepted edit is live
  // on the page"; acceptance happens on /recommendations and is a
  // separate operator decision.
  if (status === "recommended") {
    log.info("markChangelogEditShipped: refused — edit not yet accepted", {
      changelogId: args.changelogId,
      editId: edit.id,
      status,
    });
    return {
      success: false,
      error:
        "Accept the recommendation first. Mark Shipped only confirms an already-accepted change is live on the page; it doesn't accept the recommendation for you.",
    };
  }
  if (status !== "accepted") {
    log.info("markChangelogEditShipped: edit already past verified_live", {
      changelogId: args.changelogId,
      editId: edit.id,
      status,
    });
    return {
      success: true,
      flipped: 0,
      skipped: 1,
    };
  }

  try {
    const result = await markRecommendedEditsAsShipped({
      editIds: [edit.id],
      tenantId,
    });
    log.info("Action completed", {
      action,
      durationMs: Date.now() - t0,
      params: {
        changelogId: args.changelogId,
        editId: edit.id,
        flipped: result.flipped,
        skipped: result.skipped,
      },
    });
    revalidatePath("/changes");
    revalidatePath("/recommendations");
    revalidatePath("/", "layout");
    return {
      success: true,
      flipped: result.flipped,
      skipped: result.skipped,
    };
  } catch (err) {
    log.error("markChangelogEditShipped: persistence flip failed", {
      changelogId: args.changelogId,
      editId: edit.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      error: `Failed to mark edit shipped: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}
