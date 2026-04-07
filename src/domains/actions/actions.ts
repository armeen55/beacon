"use server";

import { revalidatePath } from "next/cache";
import { now } from "@/lib/actions";
import { actionStates, persistActionStates } from "./store";
import type { OperatorState } from "./types";

export async function updateActionState(
  actionId: string,
  state: OperatorState,
  operatorNote?: string,
  linkedFollowUpChangeIds?: string[]
): Promise<{ success: boolean }> {
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
  return { success: true };
}
