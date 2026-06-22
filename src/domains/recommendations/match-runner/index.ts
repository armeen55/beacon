/**
 * Recommendation Lifecycle OS — Phase 3 (2026-04-27).
 *
 * Match runner orchestrator. Wired into `runWebsiteScan` after the
 * scan dual-write block (orchestrate-scan.ts). GATED by
 * `BEACON_LIFECYCLE_ENABLED` — when OFF the runner is a no-op.
 *
 * Pipeline:
 *   1. Reconciliation pre-pass (Phase 1 caveat fix — Option 2):
 *      flip `recommended_edits.implementation_status` for any rows
 *      whose parent rec already has accepted-evidence in
 *      `recommendation_responses` or `changelog_entries`.
 *   2. Build per-URL inventory map keyed to the latest snapshot.
 *   3. For each candidate edit (status ∈ accepted | needs_review |
 *      wrong_page | partially_implemented | not_found_after_7d |
 *      verified_live | verified_live_modified):
 *        - run `matchAcceptedEdit` against the target URL's inventory
 *        - compute the diff via `computeLifecycleUpdate`
 *        - on verified_live*, stage `live_at` stamp for the matching
 *          changelog entry
 *   4. Persist the recommended_edits diffs (file-first + dual-write).
 *   5. Persist the changelog `live_at` stamps (idempotent — skip
 *      already-stamped rows).
 *
 * Phase 3 deliberately does NOT change attribution math. The verdict
 * engine continues to read `entry.timestamp` until Phase 4.
 */

import "server-only";

import { log } from "@/lib/logger";
import { isLifecycleEnabled } from "@/lib/flags";
import { getRepository } from "@/lib/persistence/repositories";
import {
  editLifecycleStatus,
  markRecommendedEditsAccepted,
  type RecommendedEditRow,
} from "../recommended-edits-persistence";
import {
  matchAcceptedEdit,
  type OtherUrlInventory,
} from "../match-engine";
import {
  computeAcceptedAtMs,
  computeReconciliationFlips,
} from "./reconcile";
import { computeLifecycleUpdate } from "./transitions";
import { buildInventoryByUrl } from "./inventory-by-url";
import {
  persistChangelogLiveAt,
  persistLifecycleUpdates,
} from "./persist";

export type RunLifecycleMatchResult = {
  /** False when the flag is off OR a precondition prevented a run. */
  ranSuccessfully: boolean;
  /** Why the runner did not run, when ranSuccessfully is false. */
  skippedReason?: "flag_disabled" | "no_edits" | "error";
  /** Count of edits flipped from `recommended` → `accepted` by the reconciliation pre-pass. */
  reconciled: number;
  /** Count of candidate edits the matcher evaluated. */
  evaluated: number;
  /** Count of `recommended_edits` rows whose lifecycle fields actually changed. */
  updated: number;
  /** Count of `changelog_entries` rows that received a fresh `live_at` stamp. */
  liveAtStamped: number;
  /**
   * Phase 3.1 (2026-04-27): count of edits for which
   * `computeAcceptedAtMs` returned `null` — no stable accept-time
   * source available. The 7-day `not_found_after_7d` promotion was
   * skipped for these edits; they remain `accepted` until the
   * operator materializes a stable source (changelog entry,
   * accepted recommendation_response, or `created_at`).
   */
  noStableAcceptTimestamp: number;
  /** Free-text error message if the runner threw. */
  error?: string;
};

/**
 * Run the match engine against the latest scan output for a single
 * tenant. Safe to call from `runWebsiteScan` after dual-write.
 *
 * Hard rules:
 *   - `isLifecycleEnabled() === false` → byte-identical no-op return.
 *     ZERO repo reads. ZERO writes. ZERO log lines except a single
 *     `info` breadcrumb when `now` is supplied (test mode) so the
 *     no-op path is observable in tests.
 *   - The reconciler runs BEFORE the matcher every time — handles
 *     past Accept failures + future best-effort drift.
 *   - All writes go through the persist helpers (file-first +
 *     best-effort dual-write).
 */
export async function runLifecycleMatchAgainstScan(opts: {
  tenantId: string;
  now?: Date;
}): Promise<RunLifecycleMatchResult> {
  if (!isLifecycleEnabled()) {
    return {
      ranSuccessfully: false,
      skippedReason: "flag_disabled",
      reconciled: 0,
      evaluated: 0,
      updated: 0,
      liveAtStamped: 0,
      noStableAcceptTimestamp: 0,
    };
  }

  const now = opts.now ?? new Date();
  const t0 = Date.now();
  const repo = getRepository().forTenant(opts.tenantId);

  try {
    // ── 1. Load all inputs in parallel ────────────────────────────────
    const [allEdits, responses, changelog, pageSnapshots, inventory] =
      await Promise.all([
        repo.getRecommendedEdits(),
        repo.getRecommendationResponses(),
        repo.getChangelogEntries(),
        repo.getPageSnapshots(),
        repo.getPageElementInventory(),
      ]);

    if (allEdits.length === 0) {
      log.info("[match-runner] no recommended_edits — early exit", {
        tenantId: opts.tenantId,
      });
      return {
        ranSuccessfully: true,
        skippedReason: "no_edits",
        reconciled: 0,
        evaluated: 0,
        updated: 0,
        liveAtStamped: 0,
        noStableAcceptTimestamp: 0,
      };
    }

    // ── 2. Reconciliation pre-pass ────────────────────────────────────
    const reconcileIds = computeReconciliationFlips({
      edits: allEdits,
      responses,
      changelog,
    });
    let reconciledCount = 0;
    if (reconcileIds.length > 0) {
      const r = await markRecommendedEditsAccepted({
        editIds: reconcileIds,
        tenantId: opts.tenantId,
        now,
      });
      reconciledCount = r.flipped;
      log.info("[match-runner] reconciled recommended → accepted", {
        tenantId: opts.tenantId,
        flipped: r.flipped,
        skipped: r.skipped,
      });
    }

    // Re-read edits when the reconciler made changes so the matcher
    // sees the freshest status. Single re-read keeps the repo behind
    // a clear data-fetch boundary.
    const editsForMatching =
      reconciledCount > 0 ? await repo.getRecommendedEdits() : allEdits;

    // ── 3. Build per-URL inventory ────────────────────────────────────
    const { byUrl, latestSnapshotByUrl } = buildInventoryByUrl(
      inventory,
      pageSnapshots,
    );

    // Pre-compute the wrong-page candidate list once. The pure engine
    // skips same-URL aliases via `pathMatches`, so we can pass the
    // entire universe minus the immediate target every time.
    const otherUrlInventoriesAll: OtherUrlInventory[] = [];
    for (const [url, rows] of byUrl.entries()) {
      otherUrlInventoriesAll.push({ url, rows });
    }

    // ── 4. Filter candidates + run matcher per edit ───────────────────
    const candidates = editsForMatching.filter((e) => {
      const status = editLifecycleStatus(e);
      // Skip terminal-immutable + un-actionable states.
      return status !== "recommended" && status !== "dismissed";
    });

    const updatedRows: RecommendedEditRow[] = [];
    const liveAtUpdates: { changelogId: string; liveAt: string }[] = [];
    let noStableAcceptTimestampCount = 0;

    for (const edit of candidates) {
      const targetUrl = edit.target_url;
      const currentInventory = byUrl.get(targetUrl) ?? [];
      const otherUrlInventories = otherUrlInventoriesAll.filter(
        (o) => o.url !== targetUrl,
      );

      const match = matchAcceptedEdit({
        edit,
        currentInventory,
        otherUrlInventories,
      });

      // Phase 3.1: computeAcceptedAtMs returns null when no stable
      // accept-time source exists (no exact-matching changelog, no
      // accepted recommendation_response, no created_at). Pass null
      // through to transitions — `not_found_after_7d` promotion is
      // skipped in that case. Emit a structured per-edit warning so
      // the operator can detect drift.
      const acceptedAtMs = computeAcceptedAtMs(edit, responses, changelog);
      const ageMs = acceptedAtMs === null ? null : now.getTime() - acceptedAtMs;
      if (acceptedAtMs === null) {
        noStableAcceptTimestampCount += 1;
        log.warn("[match-runner] no stable accept-time — skipping 7-day promotion", {
          tenantId: opts.tenantId,
          editId: edit.id,
          recId: edit.rec_id,
          actionType: edit.action_type,
          targetElementKey: edit.target_element_key,
          currentStatus: editLifecycleStatus(edit),
        });
      }
      const targetSnap = latestSnapshotByUrl.get(targetUrl) ?? null;

      const update = computeLifecycleUpdate({
        currentStatus: editLifecycleStatus(edit),
        match,
        ageMs,
        scanFetchedAt: targetSnap?.fetched_at ?? null,
        scanSnapshotId: targetSnap?.id ?? null,
      });
      if (update === null) continue;

      const updatedRow: RecommendedEditRow = {
        ...edit,
        ...update,
        updated_at: now.toISOString(),
      };
      updatedRows.push(updatedRow);

      // Stamp `live_at` on the matching changelog entry whenever this
      // edit transitions to verified_live*. Match by source_rec_id
      // AND target_element_key so a multi-edit rec stamps the right
      // child entry only.
      if (
        update.implementation_status === "verified_live" ||
        update.implementation_status === "verified_live_modified"
      ) {
        if (targetSnap) {
          for (const cl of changelog) {
            if (cl.source_rec_id !== edit.rec_id) continue;
            // Match on action_type too (mirrors reconcile.ts's 3-tuple join), so a
            // multi-action rec with a null element_key doesn't over-stamp live_at
            // onto unrelated legs. Legacy rows with no action_type still pass.
            if (cl.action_type !== undefined && cl.action_type !== edit.action_type) {
              continue;
            }
            if (
              edit.target_element_key !== null &&
              cl.target_element_key !== undefined &&
              cl.target_element_key !== edit.target_element_key
            ) {
              continue;
            }
            if (cl.live_at !== null && cl.live_at !== undefined) continue;
            liveAtUpdates.push({
              changelogId: cl.id,
              liveAt: targetSnap.fetched_at,
            });
          }
        }
      }
    }

    // ── 5. Persist (file-first + best-effort dual-write) ──────────────
    if (updatedRows.length > 0) {
      await persistLifecycleUpdates(updatedRows, opts.tenantId);
    }
    let liveAtStampedCount = 0;
    if (liveAtUpdates.length > 0) {
      liveAtStampedCount = await persistChangelogLiveAt(
        liveAtUpdates,
        changelog,
        opts.tenantId,
      );
    }

    log.info("[match-runner] completed", {
      tenantId: opts.tenantId,
      durationMs: Date.now() - t0,
      reconciled: reconciledCount,
      evaluated: candidates.length,
      updated: updatedRows.length,
      liveAtStamped: liveAtStampedCount,
      noStableAcceptTimestamp: noStableAcceptTimestampCount,
    });

    return {
      ranSuccessfully: true,
      reconciled: reconciledCount,
      evaluated: candidates.length,
      updated: updatedRows.length,
      liveAtStamped: liveAtStampedCount,
      noStableAcceptTimestamp: noStableAcceptTimestampCount,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error("[match-runner] failed", {
      tenantId: opts.tenantId,
      error: msg,
    });
    return {
      ranSuccessfully: false,
      skippedReason: "error",
      reconciled: 0,
      evaluated: 0,
      updated: 0,
      liveAtStamped: 0,
      noStableAcceptTimestamp: 0,
      error: msg,
    };
  }
}

// Re-exports for tests + future callers.
export { computeAcceptedAtMs, computeReconciliationFlips } from "./reconcile";
export { computeLifecycleUpdate, type LifecycleUpdate } from "./transitions";
export { buildInventoryByUrl, type InventoryByUrlResult } from "./inventory-by-url";
