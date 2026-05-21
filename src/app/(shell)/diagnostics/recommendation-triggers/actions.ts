"use server";

/**
 * Slice 4.5.D.α₁c (2026-05-20) — operator-only live-write gesture.
 *
 * Wires the only UI-reachable code path to `promoteEligibleCandidates
 * ({ dryRun: false })`. Three independent gates in sequence:
 *   1. `isOperatorModeServer()` || `NODE_ENV === "test"` → else `notFound()`.
 *   2. `isPromotionLiveWriteEnabled()` → else redirect blocked_live_write_disabled.
 *   3. `formData.get("confirmation") === "PROMOTE"` (strict) → else redirect
 *      blocked_confirmation_missing.
 * On writer throw: redirect `error&msg=...` (200-char truncate). On success:
 * `revalidatePath` + redirect with promoted/skipped/mapped counts + optional
 * sync_warning (200-char truncate).
 *
 * Hard contract (pinned by `recommendation-intelligence-promotion-live-
 * write-guards` + `recommendation-intelligence-no-queue-write`):
 * imports `promoteEligibleCandidates` from the α₁b writer ONLY; NO
 * `recommended-edits-persistence` direct import; NO `runProviderAndPersist`;
 * NO Supabase write shape; this file is the SOLE caller of the writer with
 * `dryRun: false`.
 */

import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { log } from "@/lib/logger";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { isPromotionLiveWriteEnabled } from "@/lib/promotion-live-write";
import { currentTenantId } from "@/lib/tenant-context";
import { promoteEligibleCandidates } from "@/domains/recommendation-intelligence/promotion-writer";

const DIAG_PATH = "/diagnostics/recommendation-triggers";

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

export async function promoteEligibleCandidatesAction(
  formData: FormData,
): Promise<never> {
  // Gate 1: operator mode.
  if (!(isOperatorModeServer() || process.env.NODE_ENV === "test")) {
    notFound();
  }

  // Gate 2: env-flag live-write enable (defense in depth vs forged POST).
  if (!isPromotionLiveWriteEnabled()) {
    log.warn(
      "[promoteEligibleCandidatesAction] live-write disabled by env",
    );
    redirect(`${DIAG_PATH}?action_result=blocked_live_write_disabled`);
  }

  // Gate 3: confirmation phrase (strict uppercase exact match).
  const confirmation = formData.get("confirmation");
  if (typeof confirmation !== "string" || confirmation !== "PROMOTE") {
    redirect(`${DIAG_PATH}?action_result=blocked_confirmation_missing`);
  }

  // Tenant resolution.
  let tenantId: string;
  try {
    tenantId = await currentTenantId();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[promoteEligibleCandidatesAction] tenant resolve failed", {
      error: msg,
    });
    redirect(`${DIAG_PATH}?action_result=blocked_no_tenant`);
  }

  // All gates passed — call the α₁b writer with `dryRun: false`.
  let result: Awaited<ReturnType<typeof promoteEligibleCandidates>>;
  try {
    result = await promoteEligibleCandidates({ tenantId, dryRun: false });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.warn("[promoteEligibleCandidatesAction] writer threw", {
      tenantId,
      error: msg,
    });
    const safeMsg = encodeURIComponent(truncate(msg, 200));
    redirect(`${DIAG_PATH}?action_result=error&msg=${safeMsg}`);
  }

  revalidatePath(DIAG_PATH);

  const params = new URLSearchParams({
    action_result: "promoted",
    promoted_count: String(result.promoted_count),
    skipped_count: String(result.skipped_count),
    mapped_row_count: String(result.mapped_rows.length),
  });
  if (result.sync_warning != null && result.sync_warning.length > 0) {
    params.set("sync_warning", truncate(result.sync_warning, 200));
  }
  redirect(`${DIAG_PATH}?${params.toString()}`);
}
