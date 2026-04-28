/**
 * Phase 6B.1 (2026-04-28) — synthesize a ChangelogEntry-shaped record
 * from a `recommended_edits` row that has no real changelog entry.
 *
 * Why:
 *   /changes' classifier consumes ChangelogEntry rows. Pre-6B.1, an
 *   accepted edit with NO changelog row was invisible to /changes
 *   (the join key didn't resolve). Los Altos was the canonical
 *   victim: 5 accepted edits, 0 changelog rows, /changes Pending tab
 *   showed 0.
 *
 *   Rather than backfilling the changelog (separate phase), we
 *   synthesize a ChangelogEntry shape from the edit fields at render
 *   time. The classifier then buckets it as `pending_implementation`
 *   via the existing rule (linked edit `accepted`, no `live_at`).
 *   No data write. The synthetic row exists only in the request
 *   render path.
 *
 * Synthetic row identity:
 *   - `id` = the edit's deterministic id (`rec_id__action_type__target_element_key`).
 *     This guarantees idempotency: two render passes produce the same
 *     synthetic row for the same edit, so React keys stay stable.
 *   - `source_system` = "lifecycle_pending" (internal sentinel; not a
 *     persisted value).
 *   - `live_at` = null (by definition — that's why it's pending).
 *   - `archived` = false (the source edit isn't archived; archived
 *     edits flip to `dismissed` status and are excluded upstream).
 *
 * Pure module, no I/O.
 */

import type { ChangelogEntry } from "@/domains/changelog/types";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

/** The internal sentinel `source_system` value used by synthetic
 *  pending rows. Exposed so callers/tests can identify them without
 *  hard-coding the string. */
export const LIFECYCLE_PENDING_SOURCE_SYSTEM = "lifecycle_pending";

/**
 * Synthesize a ChangelogEntry from a pending `recommended_edits` row.
 * The output is shaped exactly like a real changelog entry — same
 * fields, same nullability — so downstream consumers (classifier,
 * scorecard renderer, attribution copy resolver) treat it
 * indistinguishably.
 */
export function synthesizePendingChangelog(
  edit: RecommendedEditRow,
): ChangelogEntry {
  const description = (() => {
    if (edit.proposed_text && edit.proposed_text.trim().length > 0) {
      return edit.proposed_text.trim().slice(0, 240);
    }
    return edit.action_type;
  })();
  const assetName = edit.display_label ?? edit.action_type;
  return {
    id: edit.id,
    timestamp: edit.updated_at,
    signal_type: "content",
    asset_type: "service_page",
    url: edit.target_url ?? null,
    asset_name: assetName,
    change_description: description,
    topic_targeted: edit.rec_id,
    city_targeted: null,
    hypothesis: edit.why?.slice(0, 240) ?? null,
    expected_impact_window: null,
    brief_id: null,
    opportunity_id: null,
    notes: null,
    created_at: edit.created_at,
    updated_at: edit.updated_at,
    source_system: LIFECYCLE_PENDING_SOURCE_SYSTEM,
    archived: false,
    source_rec_id: edit.rec_id,
    action_type: edit.action_type,
    target_element_key: edit.target_element_key ?? undefined,
    live_at: null,
    tenant_id: edit.tenant_id,
  };
}

/**
 * Given the full set of real changelog entries + a set of edits to
 * synthesize for, return only the synthetic rows for edits that don't
 * already have a matching changelog entry. Idempotent: re-running
 * with the same inputs produces the same output (same `id`s).
 *
 * The "matching changelog entry" check uses the edit's deterministic
 * `id` AND the canonical join key as a fallback (in case the changelog
 * row uses a different id but the same join triple).
 *
 * Caller decides which edits to synthesize. Typically:
 *   - pending_implementation edits (accepted, no live_at)
 *   - needs_review / partially_implemented / wrong_page edits
 *
 * Verified-live edits are NOT synthesized — they always have a real
 * changelog row by construction (the runner stamps live_at).
 */
export function buildSyntheticChangelogRows(input: {
  changelogEntries: readonly ChangelogEntry[];
  editsToSynthesize: readonly RecommendedEditRow[];
}): ChangelogEntry[] {
  const seenIds = new Set(input.changelogEntries.map((c) => c.id));
  const seenJoinKeys = new Set(
    input.changelogEntries
      .map((c) => {
        if (
          c.source_rec_id &&
          c.action_type &&
          c.target_element_key
        ) {
          return `${c.source_rec_id}__${c.action_type}__${c.target_element_key}`;
        }
        return null;
      })
      .filter((k): k is string => k !== null),
  );
  const synthetic: ChangelogEntry[] = [];
  for (const edit of input.editsToSynthesize) {
    if (seenIds.has(edit.id)) continue;
    const joinKey =
      edit.target_element_key !== null
        ? `${edit.rec_id}__${edit.action_type}__${edit.target_element_key}`
        : null;
    if (joinKey && seenJoinKeys.has(joinKey)) continue;
    synthetic.push(synthesizePendingChangelog(edit));
  }
  return synthetic;
}

/**
 * Pre-6B.1 alias retained for tests written before the rename. New
 * call sites should use `buildSyntheticChangelogRows` directly.
 *
 * @deprecated Use `buildSyntheticChangelogRows`.
 */
export function buildSyntheticPendingRows(input: {
  changelogEntries: readonly ChangelogEntry[];
  pendingEdits: readonly RecommendedEditRow[];
}): ChangelogEntry[] {
  return buildSyntheticChangelogRows({
    changelogEntries: input.changelogEntries,
    editsToSynthesize: input.pendingEdits,
  });
}
