import "server-only";

/**
 * 2026-06-11 (night shift, inventory #82 / audit A#29) — pre-push
 * snapshots + revert.
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
 *
 * DURABILITY (2026-06-21 ship-path audit): snapshots were file-only via
 * json-store, which on Vercel writes an in-process cache LOST on lambda recycle.
 * So a snapshot "persisted" before a live write vanished the moment a different
 * lambda served the revert → findLatestSnapshotForEdit returned null and the
 * advertised rollback could not restore the prior value. Snapshots are now
 * durable in Supabase (tenant-scoped), mirroring caps.ts / wix-mappings, with a
 * file fallback so no-env local dev + the pre-migration deploy window behave as
 * before. The fail-closed contract holds: if NEITHER store persists, we throw.
 */

import { getSupabaseAdmin } from "@/lib/persistence/supabase";
import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { RecommendedEditRow } from "@/domains/recommendations/recommended-edits-persistence";

const SNAPSHOT_STORE = "push-snapshots"; // file fallback
const SNAPSHOT_TABLE = "push_snapshots"; // durable Supabase table
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

function isMissingTable(err: { code?: string } | null | undefined): boolean {
  const code = err?.code;
  return code === "42P01" || code === "PGRST205";
}

/** Map a Supabase row (snake-ish columns) back to the camelCase shape. */
function rowFromDb(r: Record<string, unknown>): PushSnapshotRow {
  return {
    id: String(r.id),
    tenant_id: String(r.tenant_id),
    edit_id: String(r.edit_id),
    target_url: String(r.target_url),
    dataCollectionId: String(r.data_collection_id ?? ""),
    dataItemId: String(r.data_item_id ?? ""),
    field: String(r.field ?? ""),
    previous_text: String(r.previous_text ?? ""),
    captured_at: String(r.captured_at ?? ""),
  };
}

/** File-backed read (fallback + local parity). */
export async function readPushSnapshots(): Promise<PushSnapshotRow[]> {
  return (await readStore<PushSnapshotRow>(SNAPSHOT_STORE)) ?? [];
}

async function appendPushSnapshotFile(row: PushSnapshotRow): Promise<void> {
  const all = await readPushSnapshots();
  all.push(row);
  await writeStore(SNAPSHOT_STORE, all.slice(-MAX_ROWS));
}

/** Persist a snapshot row. THROWS if it can't be durably saved to EITHER store
 *  — the caller treats that as a push refusal (fail-closed safety net). */
export async function appendPushSnapshot(row: PushSnapshotRow): Promise<void> {
  let admin;
  try {
    admin = getSupabaseAdmin();
  } catch {
    // No Supabase env (local dev) → file store (throws on file failure).
    await appendPushSnapshotFile(row);
    return;
  }
  try {
    const { error } = await admin.from(SNAPSHOT_TABLE).insert({
      tenant_id: row.tenant_id,
      id: row.id,
      edit_id: row.edit_id,
      target_url: row.target_url,
      data_collection_id: row.dataCollectionId,
      data_item_id: row.dataItemId,
      field: row.field,
      previous_text: row.previous_text,
      captured_at: row.captured_at,
    });
    if (error) {
      if (isMissingTable(error)) {
        await appendPushSnapshotFile(row); // pre-migration window
        return;
      }
      // A real durable-write error: try the file store; if THAT throws too, the
      // error propagates → push refused (fail-closed, no undo = no write).
      await appendPushSnapshotFile(row);
      return;
    }
    // Durable write OK — mirror to file best-effort (no-op on Vercel FS).
    try {
      await appendPushSnapshotFile(row);
    } catch {
      /* best-effort */
    }
  } catch (err) {
    // Supabase threw unexpectedly — fall back to file; rethrow if file fails too.
    await appendPushSnapshotFile(row);
    void err;
  }
}

/** Newest snapshot for an edit (a re-pushed edit keeps history). Durable read
 *  with a file fallback so a revert finds the snapshot across lambda recycles. */
export async function findLatestSnapshotForEdit(
  tenantId: string,
  editId: string,
): Promise<PushSnapshotRow | null> {
  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin
      .from(SNAPSHOT_TABLE)
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("edit_id", editId)
      .order("captured_at", { ascending: false })
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      return rowFromDb(data[0] as Record<string, unknown>);
    }
    if (error && !isMissingTable(error)) {
      // Non-missing-table read error: fall through to the file store.
    }
  } catch {
    // No Supabase env → file fallback.
  }
  const all = await readPushSnapshots();
  const mine = all.filter((r) => r.tenant_id === tenantId && r.edit_id === editId);
  if (mine.length === 0) return null;
  return mine.sort((a, b) => b.captured_at.localeCompare(a.captured_at))[0]!;
}

export type BuildRevertResult =
  | { ok: true; edit: RecommendedEditRow }
  | { ok: false; reason: "empty_previous_value" };

/** The marker suffix buildRevertEdit stamps on a revert's ids. */
export const REVERT_EDIT_SUFFIX = "__revert";

/** True when an edit is a buildRevertEdit-produced snapshot restore (both
 *  ids carry the marker suffix; buildRevertEdit is the only producer of
 *  that shape). The push service uses this to relax ONLY the shrink
 *  heuristic (a restored body is legitimately shorter than the merged
 *  live value), never the empty-value refusal. */
export function isSnapshotRevertEdit(
  edit: Pick<RecommendedEditRow, "id" | "rec_id">,
): boolean {
  return (
    edit.id.endsWith(REVERT_EDIT_SUFFIX) && edit.rec_id.endsWith(REVERT_EDIT_SUFFIX)
  );
}

/**
 * Synthetic edit restoring the snapshot's previous text. Ships through
 * executePush, so all caps/guards apply. Pure given its inputs.
 *
 * BEACON_500 item 2 (2026-07-01): the revert now targets the SNAPSHOT's
 * field explicitly (`field:<field>`) instead of inheriting the original
 * card's target. This is what makes a BODY-section rollback correct: a
 * body push card has no field target of its own (its action type routed
 * it through the merge path), so a revert inheriting that shape would
 * re-run the merge and PREPEND the old body instead of restoring it.
 * With the explicit field target the revert flows through the plain
 * field-write route and writes the exact prior value back. Stores
 * product seoData snapshots keep the original card's routing (they never
 * ship through the CMS field route).
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
  const isStoresSeoData =
    snapshot.dataCollectionId === "Stores/Products" && snapshot.field === "seoData";
  return {
    ok: true,
    edit: {
      ...original,
      id: `${original.id}${REVERT_EDIT_SUFFIX}`,
      rec_id: `${original.rec_id}${REVERT_EDIT_SUFFIX}`,
      display_label: `Revert: ${original.display_label ?? original.why}`,
      ...(isStoresSeoData
        ? {}
        : { target_element_key: `field:${snapshot.field}` }),
      current_text: original.proposed_text,
      proposed_text: snapshot.previous_text,
      why: `Operator revert of the ${snapshot.field} push on ${snapshot.target_url} (captured ${snapshot.captured_at.slice(0, 16)}Z).`,
      implementation_status: "accepted",
      created_at: nowIso,
      updated_at: nowIso,
    },
  };
}
