"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  recordResponse,
  persistResponses,
  ensureRecommendationResponsesSeeded,
  type RecommendationResponseStatus,
  type DismissReason,
} from "@/domains/product/recommendation-response-store";
import { currentTenantId } from "@/lib/tenant-context";
import { autoRecordShippedChangeForRec } from "@/domains/proof-gsc/auto-record-on-ship";
import { invalidateChangesSurface } from "./changes-surface-store";

export async function respondToRecommendation(
  recId: string,
  status: RecommendationResponseStatus,
  context?: {
    targetPageUrl?: string | null;
    patternId?: string | null;
    /** Move action_type + topic — lets the ship auto-create the proof record. */
    actionType?: string | null;
    query?: string | null;
    dismissReason?: DismissReason | null;
  },
): Promise<{ success: boolean }> {
  const action = "respondToRecommendation";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      recId,
      status,
      hasTarget: Boolean(context?.targetPageUrl),
      hasPattern: Boolean(context?.patternId),
      dismissReason: context?.dismissReason ?? null,
    },
  });
  // Phase 3.5C: merge DB state into the in-memory array before mutating so
  // we don't overwrite existing rows on a cold Vercel lambda.
  await ensureRecommendationResponsesSeeded();
  recordResponse(recId, status, context);
  const tenantId = await currentTenantId();
  await persistResponses(tenantId);
  // P2-e (2026-07-10, visual audit) - every response (accepted/deferred/dismissed) changes
  // which changes are actionable, so the /changes SWR snapshot (changes-surface-store.ts) must
  // invalidate here too, the SAME fire-and-forget pattern opportunity-actions.ts and
  // today-moves-actions.ts already use. Without this, revalidatePath below only busts Next's
  // route cache; the app-level SWR snapshot could keep serving a dismissed/accepted change for
  // up to its own staleness window.
  await invalidateChangesSurface().catch(() => {});

  // Ship -> Proof BRIDGE: accepting a Move with a target URL also creates the
  // measurable shipped_changes ledger record (GSC baseline + diff-in-diff
  // controls), so measurement/hold/learning start automatically instead of the
  // ship being a measure-nothing status flip. Fail-soft + idempotent — never
  // blocks the response. Only on accept; the manual /results form still works.
  if (status === "accepted" && context?.targetPageUrl) {
    const res = await autoRecordShippedChangeForRec({
      tenantId,
      pageUrl: context.targetPageUrl,
      actionType: context.actionType ?? null,
      targetQuery: context.query ?? null,
    });
    if (res.recorded) revalidatePath("/results");
    log.info("Ship->proof bridge", { action, recId, recorded: res.recorded, reason: res.reason });
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
