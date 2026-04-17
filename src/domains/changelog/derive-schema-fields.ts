/**
 * Phase 1 — Post-deploy schema-diff auto-classifier.
 *
 * Given a URL's current and previous page snapshots, derive the structured
 * schema-experiment fields to stamp onto a ChangelogEntry so downstream
 * attribution can match on schema type deltas instead of free-text.
 *
 * Classification buckets (strict precedence — the plan's exactly-three rule):
 *   1. `schema_added`         — at least one @type appeared in `schema_types`
 *   2. `schema_removed`       — at least one @type disappeared (and none added)
 *   3. `schema_content_edited` — same @types, `schema_hash` changed
 *   4. null                   — nothing to classify (no schema change at all)
 *
 * The `visible_copy_changed` flag records whether `content_hash` ALSO moved.
 * That flag tells the attributor to down-weight `c_scope` because the
 * schema effect can't be cleanly isolated from a simultaneous copy edit.
 *
 * Pure function — no I/O, no side effects, no async.
 */

import type {
  ChangelogEntry,
  SchemaChangeType,
} from "@/domains/changelog/types";
import type { PageSnapshot } from "@/domains/pages/types";

/**
 * Structured fields derived from a schema-only snapshot diff. Every field
 * is a stampable member of `ChangelogEntry`. When the helper returns null,
 * the caller should NOT stamp any of these fields — the diff contains no
 * schema signal to attribute.
 */
export type DerivedSchemaFields = Pick<
  ChangelogEntry,
  | "change_family"
  | "change_type"
  | "schema_types_before"
  | "schema_types_after"
  | "schema_types_added"
  | "schema_types_removed"
  | "schema_hash_before"
  | "schema_hash_after"
  | "visible_copy_changed"
  | "page_scope"
>;

export function deriveSchemaChangelogFields(opts: {
  currentSnapshot: PageSnapshot;
  previousSnapshot: PageSnapshot | null;
}): DerivedSchemaFields | null {
  const { currentSnapshot: cur, previousSnapshot: prev } = opts;
  if (!prev) return null;

  const beforeTypes = [...(prev.schema_types ?? [])];
  const afterTypes = [...(cur.schema_types ?? [])];
  const before = new Set(beforeTypes);
  const after = new Set(afterTypes);

  const added = [...after].filter((t) => !before.has(t)).sort();
  const removed = [...before].filter((t) => !after.has(t)).sort();

  const schemaHashBefore = prev.schema_hash ?? "";
  const schemaHashAfter = cur.schema_hash ?? "";
  const schemaHashChanged = schemaHashBefore !== schemaHashAfter;

  // Precedence — first matching rule wins. schema_content_edited must NOT
  // subsume schema_added/removed; the distinction is the whole point.
  let changeType: SchemaChangeType | null = null;
  if (added.length > 0) {
    changeType = "schema_added";
  } else if (removed.length > 0) {
    changeType = "schema_removed";
  } else if (schemaHashChanged) {
    changeType = "schema_content_edited";
  } else {
    return null;
  }

  const contentHashBefore = prev.content_hash ?? "";
  const contentHashAfter = cur.content_hash ?? "";
  const visibleCopyChanged = contentHashBefore !== contentHashAfter;

  return {
    change_family: "schema_experiment",
    change_type: changeType,
    schema_types_before: [...beforeTypes].sort(),
    schema_types_after: [...afterTypes].sort(),
    schema_types_added: added,
    schema_types_removed: removed,
    schema_hash_before: schemaHashBefore,
    schema_hash_after: schemaHashAfter,
    visible_copy_changed: visibleCopyChanged,
    page_scope: "single_url",
  };
}
