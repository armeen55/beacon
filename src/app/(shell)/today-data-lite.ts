/**
 * today-data-lite (2026-07-01, FINAL PREMIUM PLAN item 101).
 *
 * The legacy /today loader (`today-data.ts`, ~3,100 LOC) was deleted: the
 * live war-room page renders via `loadTodayV2GateData` + `loadTodayView`,
 * and the cached `loadTodayPageData` wrapper had zero callers. These are
 * the only pieces the live V2 loader (`today-v2-data.ts`) still consumes,
 * extracted verbatim:
 *
 *   - `hurtingTrendSuffix`          (pure copy helper)
 *   - `buildTodayLifecycleSummary`  (recommended_edits lifecycle rollup)
 *   - `TodayPageData`               (type alias over `TodayClientProps`)
 */

import { getRepository } from "@/lib/persistence/repositories";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { UrlChangeOutcome } from "@/domains/attribution/url-change-outcome";
import { buildTodayLiveChanges } from "@/domains/today/live-changes-data";
import type {
  TodayClientProps,
  TodayLifecycleQueueItem,
  TodayLifecycleSummary,
} from "./today-shared-types";

export type {
  TodayLifecycleQueueItem,
  TodayLifecycleSummary,
} from "./today-shared-types";

export type TodayPageData = Omit<
  TodayClientProps,
  | "onRespondToRec"
  | "onStartExperiment"
>;

/**
 * T-WorseningSuffix (2026-05-08), direction-aware hurting trend suffix.
 *
 * Pre-T-WorseningSuffix, the hurting action card on /today appended
 * " · worsening" whenever `transitions > 1`. The transitions counter
 * (see `url_change_outcomes.transitions`) increments on ANY material
 * recorder update, including the demotion path where a hurting row
 * recovers. Calling that "worsening" was a direction-blind read of a
 * count, not a trend signal.
 *
 * Until the recorder persists a verdict_history (z + verdict per
 * transition), there is no safe way to infer trend direction from
 * the existing fields alone. Returning "" keeps the rationale honest:
 * we say "hurting for Nd" without claiming to know whether it's
 * accelerating or recovering.
 *
 * When verdict_history lands, this helper becomes the one place to
 * compute "improving" / "worsening" / "holding" by comparing the most
 * recent two stamps' z-magnitudes.
 *
 * Pure. No I/O.
 */
export function hurtingTrendSuffix(_args: { transitions: number }): string {
  return "";
}

/**
 * Phase 6A.7 (2026-04-28), compute the Today lifecycle summary
 * (status-strip counts + implementation queue) from
 * `recommended_edits`. Non-fatal: any read failure returns the
 * zero-shape summary so Today still renders.
 */
export async function buildTodayLifecycleSummary(
  repo: ReturnType<ReturnType<typeof getRepository>["forTenant"]>,
  // T-LiveChanges (2026-05-08), passed in so the same repo read isn't
  // duplicated. Both already loaded by the caller upstream.
  changelogEntries: ReadonlyArray<ChangelogEntry>,
  urlChangeOutcomes: ReadonlyArray<UrlChangeOutcome>,
  now: Date,
): Promise<TodayLifecycleSummary> {
  const empty: TodayLifecycleSummary = {
    counts: {
      liveVerified: 0,
      pendingImplementation: 0,
      needsReview: 0,
      notFoundAfter7d: 0,
    },
    queue: [],
    liveChanges: [],
  };
  let edits;
  try {
    edits = await repo.getRecommendedEdits();
  } catch (err) {
    console.error("[today] recommended_edits read failed (non-fatal)", err);
    return empty;
  }
  const counts = {
    liveVerified: 0,
    pendingImplementation: 0,
    needsReview: 0,
    notFoundAfter7d: 0,
  };
  const acceptedQueue: TodayLifecycleQueueItem[] = [];
  for (const edit of edits) {
    const status = edit.implementation_status;
    if (status === "verified_live" || status === "verified_live_modified") {
      counts.liveVerified += 1;
    } else if (status === "accepted") {
      counts.pendingImplementation += 1;
      acceptedQueue.push({
        id: edit.id,
        rec_id: edit.rec_id,
        action_type: edit.action_type,
        target_url: edit.target_url ?? null,
        display_label: edit.display_label ?? null,
        proposed_text_preview: edit.proposed_text
          ? edit.proposed_text.slice(0, 140)
          : null,
        updated_at: edit.updated_at,
        // Phase 6A.8 (2026-04-28), flag rows whose generator emitted a
        // placeholder answer ("Draft answer (operator: rewrite)..."). UI
        // surfaces a "needs rewrite" badge so the operator knows the FAQ
        // can't ship as-is.
        needsRewrite: edit.proposed_text
          ? edit.proposed_text.includes("Draft answer (operator: rewrite)")
          : false,
      });
    } else if (
      status === "needs_review" ||
      status === "partially_implemented" ||
      status === "wrong_page"
    ) {
      counts.needsReview += 1;
    } else if (status === "not_found_after_7d") {
      counts.notFoundAfter7d += 1;
    }
    // dismissed / recommended / undefined intentionally not surfaced.
  }
  acceptedQueue.sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  // T-LiveChanges (2026-05-08), surface the actual verified_live rows
  // (not just their count). Joins each verified_live edit with its
  // matching changelog row by (source_rec_id, action_type,
  // target_element_key) and with the matching url_change_outcomes row
  // by changelog id. Picks dynamic-state customer-safe copy per
  // current verdict / pre-verdict / very-recent (no countdown).
  const liveChanges = buildTodayLiveChanges({
    recommendedEdits: edits,
    changelogEntries,
    urlChangeOutcomes,
    now,
  });

  return {
    counts,
    // Phase 6A.8 (2026-04-28), UI shows top 3; the implementation-queue
    // card renders a "+N more pending" deep-link to /changes when more
    // exist. Capped here (rather than in the component) so /today's
    // server payload stays small.
    queue: acceptedQueue.slice(0, 3),
    liveChanges,
  };
}
