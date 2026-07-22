"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import {
  editLifecycleStatus,
  markRecommendedEditsAsShipped,
} from "@/domains/recommendations/recommended-edits-persistence";
import { loadChangesView } from "../changes-data";
import { invalidateCoreSurfaces } from "../surface-release";
import type { TodayMove } from "../today-moves-data";

/**
 * Inline changelog-to-edit join (Core 100K: the attribution/lifecycle-classification module
 * that owned these helpers was retired). A changelog row links to its recommended_edit by
 * the (rec id, action type, target element) triple both sides carry; a row missing any leg
 * has no linkage (legacy / free-form) and resolves to null.
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

/**
 * W2-B (2026-07-10) - PAYLOAD: the on-demand detail fetch behind the collapsed
 * /changes board. The default board ships only SlimTodayMove summaries (see
 * changes-data.ts); when a row's detail opens, the client calls this to get the
 * FULL TodayMove dossier for that one row. $0 and read-only: it reads the SAME
 * request-cached SWR snapshot the page render served (full dossiers are persisted
 * in the surface; only the client payload is slimmed). Null when the move is not
 * in the snapshot (e.g. a cold surface still building) - the client falls back to
 * the row's own canonical-change detail, honestly degraded.
 */
export async function loadMoveDetailAction(sourceId: string): Promise<TodayMove | null> {
  if (!sourceId) return null;
  try {
    const view = await loadChangesView();
    return view.movesById[sourceId] ?? null;
  } catch {
    return null; // fail-soft: detail loading must never crash the board
  }
}

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

  // This action changes attribution truth from accepted to verified-live. It
  // must carry the same tenant publish authority as the actual push path; a
  // stale or hand-crafted client request cannot mark work live merely because
  // it reached the server action.
  if (!(await canPublishForCurrentTenant())) {
    return { success: false, error: "You do not have permission to mark this change live." };
  }

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
    // W2 truth-up: shipping a change must age-stamp the tenant-scoped core surface
    // caches too, not only Next's route cache - otherwise the ranked list serves
    // the pre-ship state for up to the 15-min TTL. Matches the surface-cache
    // contract ("ship a change invalidates it") and every other ship path.
    if (result.flipped > 0) await invalidateCoreSurfaces().catch(() => {});
    revalidatePath("/changes");
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
