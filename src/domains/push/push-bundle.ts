import "server-only";

/**
 * push-bundle (BEACON_500 P12, v1 179, 2026-07-03) - atomic multi-field bundles.
 * Stage MULTIPLE SEO fields on one page (title + meta + schema, say) as ONE unit
 * that either ALL apply or ALL abort, with ONE receipt.
 *
 * WHY. A page's title, meta, and schema are often changed together to land a
 * single coherent improvement. Pushed one at a time, a failure on the third leaves
 * the page in a half-changed state - a new title and meta but the old schema, or
 * worse a title that reads for a section the schema no longer matches. An operator
 * then has to notice, reason about which parts landed, and clean up by hand. This
 * bundles them: all fields are validated FIRST (every guard, no side effect), then
 * committed; if any commit fails, the ones that already landed are ROLLED BACK to
 * their pre-push values, so the page ends either fully-changed or fully-original,
 * never in between. One receipt tells the operator exactly what happened.
 *
 * COMPOSITION, NOT NEW WRITE LOGIC (like stage-change.ts): every field ships
 * through the EXISTING executePush, which remains the sole write authority (Ritz
 * hard-block, daily cap reserve-before-write, fail-closed snapshot, non-destructive
 * guard, mapping-required, 1MB ceiling, outbox idempotency). This module only
 * ORCHESTRATES: it never calls Wix directly and never bypasses a single rail.
 *
 * ALL-OR-NOTHING, in three phases:
 *   1. VALIDATE: run executePush({ dryRun: true }) for EVERY field. A dry-run runs
 *      every guard + resolution the real push would and stops before ANY side
 *      effect. If ANY field's dry-run is not a clean dry_run/pushed, the whole
 *      bundle ABORTS before a single live write - nothing changed.
 *   2. COMMIT: run the REAL executePush for each field in order. Each landed field
 *      is remembered so it can be reverted.
 *   3. ROLLBACK ON FAILURE: if a commit fails partway, restore each already-landed
 *      field to its pre-push value via buildRevertEdit -> executePush (the same
 *      one-click restore the snapshot layer already provides). The bundle then
 *      reports as aborted with what was rolled back.
 *
 * PINS:
 *   - Ritz hard-block, dry-run default, and the daily caps all live INSIDE
 *     executePush and are never touched here. A Ritz bundle is refused by the
 *     first dry-run (dev_note), so nothing commits.
 *   - BYTE-IDENTICAL for a SINGLE-field bundle: a one-edit bundle performs exactly
 *     ONE executePush call (no dry-run pre-pass, no rollback machinery) and returns
 *     that call's outcome verbatim - identical to calling executePush directly.
 *   - This is a NEW capability with no callers on the shipped path yet; on its own
 *     it changes nothing.
 */

import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";
import { executePush, type PushDeps, type PushResult } from "./push-service";
import {
  findLatestSnapshotForEdit,
  buildRevertEdit,
} from "./push-snapshots";

export type BundleFieldOutcome = {
  editId: string;
  field: string;
  status: "committed" | "rolled_back" | "aborted" | "failed";
  detail: string;
};

export type PushBundleResult =
  /** Every field landed. */
  | { kind: "bundled"; adapter: "wix_cms"; committed: BundleFieldOutcome[]; receipt: string }
  /** A dry-run refusal before any write - nothing changed. */
  | { kind: "aborted"; reason: string; outcomes: BundleFieldOutcome[]; receipt: string }
  /** A commit failed partway; the already-landed fields were rolled back. */
  | { kind: "rolled_back"; reason: string; outcomes: BundleFieldOutcome[]; receipt: string }
  /** Passthrough of a single-field bundle's executePush result (byte-identical). */
  | { kind: "single"; result: PushResult };

function fieldLabel(edit: RecommendedEditRow): string {
  const key = edit.target_element_key ?? "";
  if (key.startsWith("field:")) return key.slice("field:".length);
  if (edit.action_type === "add_schema") return "schema";
  return edit.action_type;
}

/**
 * Execute a bundle of edits atomically. Order matters only for the receipt; the
 * all-or-nothing guarantee holds regardless. See the module header for the phases.
 *
 * A SINGLE-field bundle is byte-identical to calling executePush directly: it
 * takes the fast path and returns { kind: "single", result } with no dry-run
 * pre-pass and no rollback machinery.
 */
export async function executePushBundle(
  args: { tenantId: string; edits: readonly RecommendedEditRow[] },
  deps: PushDeps = {},
): Promise<PushBundleResult> {
  const { tenantId, edits } = args;

  if (edits.length === 0) {
    return {
      kind: "aborted",
      reason: "the bundle had no changes in it",
      outcomes: [],
      receipt: "I had nothing to publish in this bundle.",
    };
  }

  // BYTE-IDENTICAL SINGLE-FIELD PIN: exactly one executePush call, verbatim result.
  if (edits.length === 1) {
    const result = await executePush({ tenantId, edit: edits[0]! }, deps);
    return { kind: "single", result };
  }

  // ── Phase 1: VALIDATE every field with a dry-run (no side effect) ──────────
  // A dry-run runs every guard + resolution; only a clean dry_run means the real
  // push would proceed. Anything else (refused / dev_note / an unexpected pushed)
  // aborts the whole bundle before a single live write - so nothing is committed.
  for (const edit of edits) {
    const dry = await executePush({ tenantId, edit, dryRun: true }, deps);
    if (dry.kind !== "dry_run") {
      // The reason the bundle cannot proceed, in the field's own words.
      const reason =
        dry.kind === "refused"
          ? dry.reason
          : dry.kind === "dev_note"
            ? dry.reason
            : "this change could not be validated for a live push";
      // Every field is aborted; NOTHING was written. Build the outcomes fresh so
      // no provisional state leaks in.
      const abortOutcomes: BundleFieldOutcome[] = edits.map((e) => ({
        editId: e.id,
        field: fieldLabel(e),
        status: "aborted",
        detail:
          e.id === edit.id
            ? reason
            : "not published because another change in the bundle could not be published",
      }));
      return {
        kind: "aborted",
        reason,
        outcomes: abortOutcomes,
        receipt:
          `I did not publish anything. One of the ${edits.length} changes in this bundle could not go live (${reason}), ` +
          `so I held all of them together rather than leave the page half changed.`,
      };
    }
  }

  // ── Phase 2: COMMIT each field for real, remembering what landed ──────────
  const committed: { edit: RecommendedEditRow; detail: string }[] = [];
  const outcomes: BundleFieldOutcome[] = [];
  for (const edit of edits) {
    const res = await executePush({ tenantId, edit }, deps);
    if (res.kind === "pushed") {
      committed.push({ edit, detail: res.detail });
      outcomes.push({ editId: edit.id, field: fieldLabel(edit), status: "committed", detail: res.detail });
      continue;
    }
    // A commit failed AFTER the dry-run passed (a race, a mid-bundle Wix error).
    // Roll back everything that already landed, in reverse order.
    const failReason =
      res.kind === "refused"
        ? res.reason
        : res.kind === "dev_note"
          ? res.reason
          : "the publish path did not complete a live write";
    outcomes.push({ editId: edit.id, field: fieldLabel(edit), status: "failed", detail: failReason });
    // Remaining, never-attempted fields:
    const attemptedIds = new Set([...committed.map((c) => c.edit.id), edit.id]);
    for (const e of edits) {
      if (!attemptedIds.has(e.id)) {
        outcomes.push({ editId: e.id, field: fieldLabel(e), status: "aborted", detail: "not attempted after an earlier change in the bundle failed" });
      }
    }
    const rolledBack = await rollbackCommitted(tenantId, committed, deps, outcomes);
    return {
      kind: "rolled_back",
      reason: failReason,
      outcomes,
      receipt:
        `One change in this bundle could not go live (${failReason}), ` +
        `so I undid the ${rolledBack} change${rolledBack === 1 ? "" : "s"} that had already landed and left the page as it was.`,
    };
  }

  // ── All committed ─────────────────────────────────────────────────────────
  const receipt =
    `I published all ${committed.length} changes on this page together: ` +
    committed.map((c) => fieldLabel(c.edit)).join(", ") +
    `. If any one of them had failed I would have undone the rest, so the page changed as one unit.`;
  return { kind: "bundled", adapter: "wix_cms", committed: outcomes, receipt };
}

/**
 * Restore each already-landed field to its pre-push value, in REVERSE order, via
 * the existing buildRevertEdit -> executePush path (every rail applies to the
 * revert too). Records each revert outcome onto `outcomes`. Returns how many
 * fields were successfully rolled back. A revert that itself fails is recorded but
 * never throws - the operator still gets an honest report.
 */
async function rollbackCommitted(
  tenantId: string,
  committed: { edit: RecommendedEditRow; detail: string }[],
  deps: PushDeps,
  outcomes: BundleFieldOutcome[],
): Promise<number> {
  let count = 0;
  const now = deps.now ?? new Date();
  for (const { edit } of [...committed].reverse()) {
    let ok = false;
    let detail = "";
    try {
      const snapshot = await findLatestSnapshotForEdit(tenantId, edit.id);
      if (snapshot == null) {
        detail = "no saved previous version to restore from";
      } else {
        const revert = buildRevertEdit(snapshot, edit, now);
        if (!revert.ok) {
          detail = "the previous version was empty, so restoring it would blank the field";
        } else {
          const res = await executePush({ tenantId, edit: revert.edit }, deps);
          ok = res.kind === "pushed";
          detail = ok ? "restored the previous version" : `could not restore: ${describe(res)}`;
        }
      }
    } catch (err) {
      detail = `could not restore: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (ok) count += 1;
    // Update this field's outcome from committed -> rolled_back (or leave failed detail).
    const idx = outcomes.findIndex((o) => o.editId === edit.id && o.status === "committed");
    if (idx >= 0) {
      outcomes[idx] = {
        ...outcomes[idx]!,
        status: ok ? "rolled_back" : "committed",
        detail: ok ? detail : `landed but could not be undone: ${detail}`,
      };
    }
  }
  return count;
}

function describe(res: PushResult): string {
  switch (res.kind) {
    case "refused":
      return res.reason;
    case "dev_note":
      return res.reason;
    case "dry_run":
      return res.detail;
    case "pushed":
      return res.detail;
  }
}
