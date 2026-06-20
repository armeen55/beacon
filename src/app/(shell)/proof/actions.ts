"use server";

/**
 * GSC Proof ledger — server actions (Phase 5, Path B). Operator-gated.
 *
 * recordShippedChangeAction: the manual "Record shipped change" path. Captures a
 * GSC baseline + control set for an approved/reviewed page and starts measuring.
 * Works even when Wix publishing is manual (it's the operator confirming they
 * shipped it). Never publishes anything.
 *
 * recomputeProofLedgerAction: re-measure + persist every recorded change's
 * 7/14/28-day outcome from fresh GSC (on-demand; no cron).
 */

import { revalidatePath } from "next/cache";

import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { loadProofPlan } from "@/domains/recommendation-intelligence/page-surgeon/bridge";
import { canonicalizeCitationUrl } from "@/domains/citation-lifecycle/canonicalize-url";
import {
  recordShippedChange,
  captureChangeMeta,
  measureRecord,
} from "@/domains/proof-gsc/run-measurement";
import {
  loadShippedChanges,
  upsertShippedChange,
} from "@/domains/proof-gsc/shipped-change-store";

export type ProofLedgerActionResponse = { success: boolean; error?: string };

export async function recordShippedChangeAction(args: {
  pageUrl: string;
}): Promise<ProofLedgerActionResponse> {
  if (!isOperatorModeServer()) return { success: false, error: "Operator only." };
  const pageUrl = args?.pageUrl?.trim();
  if (!pageUrl) return { success: false, error: "Missing page." };

  try {
    const tenantId = await currentTenantId();
    const plan = await loadProofPlan(tenantId).catch(() => []);
    const row = plan.find((r) => r.pageUrl === pageUrl) ?? null;

    const meta = await captureChangeMeta(tenantId, pageUrl);
    const origin = (() => {
      try {
        return new URL(meta.canonPage).origin;
      } catch {
        return "";
      }
    })();
    // Proof-plan controls are PATHS; resolve to canonical URLs on the same host.
    const controlPages = (row?.controlPaths ?? [])
      .map((p) => canonicalizeCitationUrl(origin + p) ?? `${origin}${p}`)
      .filter((u) => u && u !== meta.canonPage);

    const record = await recordShippedChange({
      tenantId,
      page: meta.canonPage,
      path: meta.path,
      actionType: meta.headlineAction ?? row?.headlineAction ?? "change",
      before: meta.before,
      after: meta.after,
      targetQueries: meta.targetQueries,
      controlPages,
    });
    await upsertShippedChange(record);

    revalidatePath("/proof");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to record the shipped change.",
    };
  }
}

export async function recomputeProofLedgerAction(): Promise<ProofLedgerActionResponse> {
  if (!isOperatorModeServer()) return { success: false, error: "Operator only." };
  try {
    const tenantId = await currentTenantId();
    const records = await loadShippedChanges();
    for (const r of records) {
      const measured = await measureRecord(tenantId, r);
      await upsertShippedChange(measured);
    }
    revalidatePath("/proof");
    revalidatePath("/changes");
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to recompute.",
    };
  }
}
