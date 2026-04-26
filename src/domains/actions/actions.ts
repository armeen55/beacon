"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { now } from "@/lib/actions";
import { getActionStates, persistActionStates } from "./store";
import type { OperatorState } from "./types";

export async function updateActionState(
  actionId: string,
  state: OperatorState,
  operatorNote?: string,
  linkedFollowUpChangeIds?: string[]
): Promise<{ success: boolean }> {
  const action = "updateActionState";
  const t0 = Date.now();
  log.info("Action started", { action, params: { actionId, state } });
  const actionStates = await getActionStates();
  const existing = actionStates.find((s) => s.actionId === actionId);

  if (existing) {
    existing.state = state;
    existing.updatedAt = now();
    if (operatorNote !== undefined) existing.operatorNote = operatorNote;
    if (linkedFollowUpChangeIds !== undefined) {
      existing.linkedFollowUpChangeIds = linkedFollowUpChangeIds;
    }
  } else {
    actionStates.push({
      actionId,
      state,
      operatorNote: operatorNote ?? null,
      linkedFollowUpChangeIds: linkedFollowUpChangeIds ?? [],
      updatedAt: now(),
    });
  }

  await persistActionStates();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
