import "server-only";

/**
 * 2026-06-11 (night shift, inventory #82 / audit A#29) — pre-push
 * snapshots + revert.
 *
 * Until tonight a push had NO undo: the read-modify-write path read
 * the field's previous value and threw it away. Now:
 *
 *   • executePush CAPTURES {field, previous_text} BEFORE every field
 *     write — fail-closed: if the snapshot can't be persisted, the
 *     push is refused (the safety net must exist before the change).
 *   • `buildRevertEdit` turns the newest snapshot for an edit into a
 *     synthetic edit whose proposed_text is the previous value. The
 *     revert ships through the SAME executePush — daily caps, the
 *     non-destructive guard, and the ledger all apply unchanged.
 *   • An EMPTY previous value refuses to build (restoring it would
 *     blank the field = deletion-shaped; the caps contract requires a
 *     separate explicit decision for deletions — do that one by hand).
 */

import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const SNAPSHOT_STORE = "push-snapshots";
const MAX_ROWS = 1000;

export type PushSnapshotRow = {
  id: string;
  tenant_id: string;
  edit_id: string;
  target_url: string;
  dataCollectionId: string;
  dataItemId: string;
  field: string;
  previous_text: string;
  captured_at: string;
};

export async function readPushSnapshots(): Promise<PushSnapshotRow[]> {
  return (await readStore<PushSnapshotRow>(SNAPSHOT_STORE)) ?? [];
}

/** Persist a snapshot row. THROWS on write failure — the caller treats
 *  that as a push refusal (fail-closed safety net). */
export async function appendPushSnapshot(row: PushSnapshotRow): Promise<void> {
  const all = await readPushSnapshots();
  all.push(row);
  await writeStore(SNAPSHOT_STORE, all.slice(-MAX_ROWS));
}

/** Newest snapshot for an edit (a re-pushed edit keeps history). */
export async function findLatestSnapshotForEdit(
  tenantId: string,
  editId: string,
): Promise<PushSnapshotRow | null> {
  const all = await readPushSnapshots();
  const mine = all.filter((r) => r.tenant_id === tenantId && r.edit_id === editId);
  if (mine.length === 0) return null;
  return mine.sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0]!;
}

export type BuildRevertResult =
  | { ok: true; edit: RecommendedEditRow }
  | { ok: false; reason: "empty_previous_value" };

/**
 * Synthetic edit restoring the snapshot's previous text. Ships through
 * executePush — all caps/guards apply. Pure given its inputs.
 */
export function buildRevertEdit(
  snapshot: PushSnapshotRow,
  original: RecommendedEditRow,
  now: Date,
): BuildRevertResult {
  if (snapshot.previous_text.trim() === "") {
    return { ok: false, reason: "empty_previous_value" };
  }
  const nowIso = now.toISOString();
  return {
    ok: true,
    edit: {
      ...original,
      id: `${original.id}__revert`,
      rec_id: `${original.rec_id}__revert`,
      display_label: `Revert: ${original.display_label ?? original.why}`,
      current_text: original.proposed_text,
      proposed_text: snapshot.previous_text,
      why: `Operator revert of the ${snapshot.field} push on ${snapshot.target_url} (captured ${snapshot.captured_at.slice(0, 16)}Z).`,
      implementation_status: "accepted",
      created_at: nowIso,
      updated_at: nowIso,
    },
  };
}
