"use server";

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import { currentTenantId } from "@/lib/tenant-context";
import { updateFactoryBatchItemStatus, loadLatestFactoryBatch } from "@/domains/page-factory/batch-store";
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { invalidateDemandGraph } from "@/domains/demand-graph/graph-snapshot-store";

/**
 * page-factory-batch-actions (BEACON 500 item 62) - the operator's approve/skip
 * on the weekly page-factory review card. Mirrors execution-actions.ts's
 * "Mark applied" contract EXACTLY: Beacon never publishes on its own.
 *
 *   - approveFactoryBatchItemAction: marks the item "approved" (paste-ready,
 *     ready to publish by hand or via the operator's own Wix flow). NO write.
 *   - skipFactoryBatchItemAction: marks the item "skipped" - never redrafted
 *     from this batch (a future week's factory run may still re-propose the
 *     same entity/attribute if it still clears the demand floor).
 *   - confirmFactoryPagePublishedAction: the operator explicitly confirms they
 *     published the page live (same "I did this manually" contract as
 *     markMoveAppliedAction) - THIS is what starts measurement, via the
 *     existing ship->proof bridge with its own auto-selected comparison pages.
 */

export type FactoryBatchActionResult = { ok: false; reason: string } | { ok: true };

export async function approveFactoryBatchItemAction(args: { weekOf: string; slug: string }): Promise<FactoryBatchActionResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  const tenantId = await currentTenantId();
  const ok = await updateFactoryBatchItemStatus({ tenantId, weekOf: args.weekOf, slug: args.slug, status: "approved" });
  if (!ok) return { ok: false, reason: "Could not find that page in this week's batch." };
  revalidatePath("/worklist");
  return { ok: true };
}

export async function skipFactoryBatchItemAction(args: { weekOf: string; slug: string }): Promise<FactoryBatchActionResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  const tenantId = await currentTenantId();
  const ok = await updateFactoryBatchItemStatus({ tenantId, weekOf: args.weekOf, slug: args.slug, status: "skipped" });
  if (!ok) return { ok: false, reason: "Could not find that page in this week's batch." };
  revalidatePath("/worklist");
  return { ok: true };
}

export type ConfirmPublishedResult =
  | { ok: false; reason: string }
  | { ok: true; recorded: boolean; reason: string };

/**
 * The operator confirms they published this drafted page live at `targetUrl`
 * (Beacon did not publish it - see the module doc). Records the page's
 * targetUrl + flips it to "published" + starts measurement through the
 * EXISTING ship->proof bridge (its own auto-selected comparison-page set),
 * exactly like markMoveAppliedAction. Fail-soft: a measurement-enrollment
 * failure never blocks the status flip (the operator's confirmation is the
 * source of truth; measurement can be retried later by the auto-measure pass).
 */
export async function confirmFactoryPagePublishedAction(args: {
  weekOf: string;
  slug: string;
  targetUrl: string;
}): Promise<ConfirmPublishedResult> {
  if (!(await isOperatorModeServer())) return { ok: false, reason: "Operator mode only." };
  const targetUrl = args.targetUrl.trim();
  if (!targetUrl) return { ok: false, reason: "Enter the live page URL first." };

  const tenantId = await currentTenantId();
  const batch = await loadLatestFactoryBatch(tenantId).catch(() => null);
  const item = batch?.weekOf === args.weekOf ? batch.items.find((i) => i.slug === args.slug) : null;
  if (!item) return { ok: false, reason: "Could not find that page in this week's batch." };

  await updateFactoryBatchItemStatus({ tenantId, weekOf: args.weekOf, slug: args.slug, status: "published", targetUrl });

  let recorded = false;
  let reason = "recorded";
  try {
    const res = await autoRecordShippedChangeForRec({
      tenantId,
      pageUrl: targetUrl,
      actionType: "create_page",
      targetQuery: item.matchedKeyword ?? item.title,
      verifiedLive: true,
      notes: "Published from the weekly page factory batch",
    });
    recorded = res.recorded;
    reason = res.reason;
  } catch (e) {
    reason = `error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200);
  }

  await invalidateDemandGraph("page factory page published → new owned page enters the graph").catch(() => {});
  revalidatePath("/");
  revalidatePath("/worklist");
  return { ok: true, recorded, reason };
}
