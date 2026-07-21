"use server";

/**
 * Revert-push server action for the customer push receipt (Changes surface).
 * Relocated out of the retired /diagnostics/wix surface (2026-07-20 diagnostics
 * amputation) because the customer PushReceipt component is its only surviving
 * consumer. No new revert path: same snapshot -> buildRevertEdit -> executePush
 * flow as before.
 */

import { revalidatePath } from "next/cache";

import { canPublishForCurrentTenant } from "@/lib/auth/can-publish";
import { currentTenantId } from "@/lib/tenant-context";

export async function revertPushFromForm(formData: FormData): Promise<void> {
  if (!(await canPublishForCurrentTenant())) return;
  const editId = String(formData.get("edit_id") ?? "");
  if (editId === "") return;
  const tenantId = await currentTenantId();

  const { getRepository } = await import("@/lib/persistence/repositories");
  const edits = await getRepository().forTenant(tenantId).getRecommendedEdits();
  const original = edits.find((e) => e.id === editId);
  if (!original) return;

  const { findLatestSnapshotForEdit, buildRevertEdit } = await import(
    "@/domains/push/push-snapshots"
  );
  const snapshot = await findLatestSnapshotForEdit(tenantId, editId);
  if (!snapshot) return;
  const revert = buildRevertEdit(snapshot, original, new Date());
  if (!revert.ok) return;

  const { executePush } = await import("@/domains/push/push-service");
  // Surface the revert outcome: a REFUSED revert (daily cap / non-destructive
  // guard / freeze) must not fail silently. This action returns void (form
  // contract), so log loudly rather than swallow.
  const pushResult = await executePush({ tenantId, edit: revert.edit });
  if (pushResult.kind === "refused") {
    console.warn(
      `[revert-push] revert push REFUSED for edit ${editId}: ${pushResult.reason}`,
    );
  } else {
    console.log(`[revert-push] revert push for edit ${editId}: ${pushResult.kind}`);
  }
  revalidatePath("/changes");
}
