"use server";

/**
 * stage-in-wix-actions (BEACON_500 item 15, 2026-07-02) - the operator-gated
 * server actions behind the "Stage in Wix" button on the daily card and the
 * worklist MoveCard. THIN by design: gate -> delegate to the single staging
 * entry point (stageChangeForRecord) -> revalidate. Every safety rail (Ritz
 * hard-block, armed-required, daily cap, fail-closed snapshot, QA backstop)
 * lives in the push domain, not here. Tenant always from trusted server
 * context; the client supplies only ids + the operator's inline tweak.
 */

import { revalidatePath } from "next/cache";
import { isOperatorModeServer } from "@/lib/operator-mode";
import {
  stageChangeForRecord,
  type StageChangeReceipt,
} from "@/domains/push/stage-change";

export type StageInWixResult = StageChangeReceipt;

const NOT_ALLOWED: StageInWixResult = {
  staged: false,
  receiptLine:
    "Only the operator can stage changes in Wix, so copy and paste this one yourself.",
  reason: "operator_mode_required",
};

function failClosed(e: unknown): StageInWixResult {
  return {
    staged: false,
    receiptLine:
      "Something went wrong staging this in Wix, so copy and paste it yourself.",
    reason: e instanceof Error ? e.message.slice(0, 160) : "stage_failed",
  };
}

/** Stage ONE accepted daily-plan pick in Wix (the paste flow stays the fallback). */
export async function stageDailyPickInWixAction(input: {
  planId: string;
  experimentId: string;
  editedText?: string;
}): Promise<StageInWixResult> {
  if (!(await isOperatorModeServer())) return NOT_ALLOWED;
  try {
    const receipt = await stageChangeForRecord({
      kind: "daily_pick",
      planId: input.planId,
      experimentId: input.experimentId,
      editedText: input.editedText,
    });
    if (receipt.staged) {
      revalidatePath("/worklist");
      revalidatePath("/");
    }
    return receipt;
  } catch (e) {
    return failClosed(e);
  }
}

/** Stage ONE worklist move in Wix (resolves the move to its pushable edit). */
export async function stageMoveInWixAction(input: {
  moveId: string;
}): Promise<StageInWixResult> {
  if (!(await isOperatorModeServer())) return NOT_ALLOWED;
  try {
    const receipt = await stageChangeForRecord({ kind: "move", moveId: input.moveId });
    if (receipt.staged) {
      revalidatePath("/worklist");
      revalidatePath("/");
      revalidatePath("/recommendations");
      revalidatePath("/changes");
    }
    return receipt;
  } catch (e) {
    return failClosed(e);
  }
}
