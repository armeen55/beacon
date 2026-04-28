/**
 * Phase 6A.2 (2026-04-28) — /changes lifecycle tab classification.
 *
 * Pure, side-effect-free classifier that buckets a changelog entry
 * (plus its optional joined `recommended_edits` row) into the tab it
 * belongs in on `/changes`. Decoupled from any UI / loader so the rules
 * are testable in isolation and reusable elsewhere.
 *
 * Truth-class glossary (locked here, surfaced in the UI):
 *
 *   live_verified           — Beacon recommended it, operator accepted, human
 *                             implemented on the site, the next scan saw it
 *                             live. The H2 on whole-home-remodel is the only
 *                             example as of 2026-04-28.
 *   pending_implementation  — Operator accepted the underlying rec but the
 *                             match engine has not yet seen the edit on the
 *                             page. Action: ship it.
 *   needs_review            — Match engine returned an ambiguous verdict —
 *                             one of needs_review / partially_implemented /
 *                             wrong_page. Action: triage.
 *   imported_legacy         — Pre-pivot history imported from Profound CSV /
 *                             PDF rebuild. Read-only audit trail.
 *   scan_confirmed          — Operator clicked Confirm on a scan diff under
 *                             /today. The scanner caught the change and the
 *                             operator confirmed it as intentional, but it
 *                             was not Beacon-recommended. Distinct provenance
 *                             from `live_verified`.
 *   unclassified            — Doesn't fit any of the above (e.g. legacy rows
 *                             from before the source_system field was added).
 *                             Surfaces only in the "All" tab.
 *
 * Archived rows (`archived: true`) are NOT a tab. The /changes loader is
 * already responsible for filtering them BEFORE rows reach this classifier
 * (see src/app/(shell)/changes/page.tsx:108: `!c.archived`). Any archived
 * row that does reach this function is treated as `unclassified` so a
 * caller bug can never silently surface an archived row in a default tab.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

export type LifecycleTabClass =
  | "live_verified"
  | "pending_implementation"
  | "needs_review"
  | "imported_legacy"
  | "scan_confirmed"
  | "unclassified";

/** Tabs visible in the UI. `all` is a synthetic tab (every non-archived row). */
export type LifecycleTab = LifecycleTabClass | "all";

/**
 * Build the join key used to look up a changelog entry's matching
 * `recommended_edits` row. Returns `null` when any of the three
 * components is missing — legacy rows + free-form changelog entries
 * have no edit linkage and never join.
 */
export function changelogJoinKey(
  entry: Pick<ChangelogEntry, "source_rec_id" | "action_type" | "target_element_key">,
): string | null {
  if (!entry.source_rec_id || !entry.action_type || !entry.target_element_key) {
    return null;
  }
  return `${entry.source_rec_id}__${entry.action_type}__${entry.target_element_key}`;
}

/**
 * Build the same join key from the recommended_edit side. Should match
 * `changelogJoinKey` for any (changelog, edit) pair created by
 * `acceptRecommendation`'s per-edit fan-out.
 */
export function recommendedEditJoinKey(
  edit: Pick<RecommendedEditRow, "rec_id" | "action_type" | "target_element_key">,
): string | null {
  if (!edit.rec_id || !edit.action_type || !edit.target_element_key) return null;
  return `${edit.rec_id}__${edit.action_type}__${edit.target_element_key}`;
}

/**
 * Build a Map<joinKey, RecommendedEditRow> for use during a single
 * /changes render. Pure helper — keeps the page loader thin.
 */
export function indexEditsByJoinKey(
  edits: readonly RecommendedEditRow[],
): Map<string, RecommendedEditRow> {
  const map = new Map<string, RecommendedEditRow>();
  for (const edit of edits) {
    const key = recommendedEditJoinKey(edit);
    if (key) map.set(key, edit);
  }
  return map;
}

/**
 * Decide which tab a changelog entry belongs in.
 *
 * Priority order matters — the first matching rule wins. This mirrors the
 * operator's mental model of "what is the most-true thing I should call
 * this row":
 *
 *   1. Live verified  — strongest claim, and it's mechanical: live_at is set.
 *   2. Needs review   — engine returned an ambiguous match for the linked edit.
 *   3. Pending impl   — operator accepted, engine has not yet matched.
 *   4. Scan confirmed — operator confirmed a scan diff (no Beacon rec).
 *   5. Imported legacy — Profound-era history.
 *   6. Unclassified   — fall-through; only surfaces in the All tab.
 *
 * Dismissed / not_found_after_7d / ineligible edits are intentionally
 * dropped to `unclassified`. They are operator/engine-decided "won't
 * happen" states; no default tab should highlight them.
 */
export function classifyChangelogRow(input: {
  entry: ChangelogEntry;
  edit?: RecommendedEditRow | null;
}): LifecycleTabClass {
  const { entry, edit } = input;

  // Defensive guard — archived rows must never appear in a default tab.
  if (entry.archived) return "unclassified";

  // Rule 1 — live verified.
  // Either a live_at on the changelog row OR the linked edit reached
  // verified_live*. We accept either signal so legacy rows that get a
  // live_at from an out-of-band source still classify correctly.
  if (entry.live_at) return "live_verified";
  if (
    edit &&
    (edit.implementation_status === "verified_live" ||
      edit.implementation_status === "verified_live_modified")
  ) {
    return "live_verified";
  }

  // Rule 2 — needs review.
  if (
    edit &&
    (edit.implementation_status === "needs_review" ||
      edit.implementation_status === "partially_implemented" ||
      edit.implementation_status === "wrong_page")
  ) {
    return "needs_review";
  }

  // Rule 3 — pending implementation.
  // Operator accepted the rec but no live_at yet. Both the changelog
  // row's live_at AND the edit's implementation_status must say "not
  // yet" — this rule fires only when the linked edit is `accepted`.
  if (edit && edit.implementation_status === "accepted") {
    return "pending_implementation";
  }

  // Rule 4 — scan confirmed (no Beacon rec, operator confirmed a diff).
  if (entry.source_system === "scan_detection" || entry.source_system === "scan_promoted") {
    return "scan_confirmed";
  }

  // Rule 5 — imported legacy.
  if (
    entry.source_system === "pdf_changelog_rebuild" ||
    entry.source_system === "import" ||
    !!entry.import_batch_id
  ) {
    return "imported_legacy";
  }

  // Rule 6 — unclassified fall-through.
  // Includes:
  //   - dismissed / not_found_after_7d / ineligible edits
  //   - edits that have no linked changelog row (rare)
  //   - older rows pre-source_system field
  return "unclassified";
}

/**
 * Apply the classifier to many entries in one pass and pre-compute the
 * counts shown next to each tab chip. Returned arrays preserve input
 * order — callers can rely on this for stable tab content.
 */
export function classifyAll(input: {
  entries: readonly ChangelogEntry[];
  editsByJoinKey: ReadonlyMap<string, RecommendedEditRow>;
}): {
  /** Per-row classification, parallel to `entries`. */
  classOf: Map<string, LifecycleTabClass>;
  /** Tab counts including the synthetic `all` total. */
  counts: Record<LifecycleTab, number>;
  /** Convenience: rows grouped by tab in original order. */
  byTab: Record<LifecycleTabClass, ChangelogEntry[]>;
} {
  const classOf = new Map<string, LifecycleTabClass>();
  const counts: Record<LifecycleTab, number> = {
    all: 0,
    live_verified: 0,
    pending_implementation: 0,
    needs_review: 0,
    imported_legacy: 0,
    scan_confirmed: 0,
    unclassified: 0,
  };
  const byTab: Record<LifecycleTabClass, ChangelogEntry[]> = {
    live_verified: [],
    pending_implementation: [],
    needs_review: [],
    imported_legacy: [],
    scan_confirmed: [],
    unclassified: [],
  };

  for (const entry of input.entries) {
    const joinKey = changelogJoinKey(entry);
    const edit = joinKey ? input.editsByJoinKey.get(joinKey) ?? null : null;
    const cls = classifyChangelogRow({ entry, edit });
    classOf.set(entry.id, cls);
    counts[cls] += 1;
    byTab[cls].push(entry);
    counts.all += 1;
  }

  return { classOf, counts, byTab };
}

/** Human-readable tab labels (UI uses these directly). */
export const LIFECYCLE_TAB_LABEL: Record<LifecycleTab, string> = {
  live_verified: "Live verified",
  pending_implementation: "Pending implementation",
  needs_review: "Needs review",
  imported_legacy: "Imported legacy",
  scan_confirmed: "Scan-confirmed",
  unclassified: "Other",
  all: "All",
};

/**
 * Default tab order on /changes. `live_verified` is first so the
 * operator lands on lifecycle truth, not legacy noise.
 */
export const LIFECYCLE_TAB_ORDER: LifecycleTab[] = [
  "live_verified",
  "pending_implementation",
  "needs_review",
  "imported_legacy",
  "scan_confirmed",
  "all",
];

/**
 * Default tab when the page first loads. Currently `live_verified`.
 * Defined here (not in the client) so tests can pin it.
 */
export const DEFAULT_LIFECYCLE_TAB: LifecycleTab = "live_verified";
