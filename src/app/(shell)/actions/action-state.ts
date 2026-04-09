"use server";

import { revalidatePath } from "next/cache";
import { actionStates, persistActionStates } from "@/domains/actions/store";
import type { OperatorState } from "@/domains/actions/types";

export async function updateActionState(
  actionId: string,
  state: OperatorState,
  note?: string | null
): Promise<{ success: boolean }> {
  const existing = actionStates.find((s) => s.actionId === actionId);

  if (existing) {
    existing.state = state;
    if (note !== undefined) existing.operatorNote = note?.trim() || null;
    existing.updatedAt = new Date().toISOString();
  } else {
    actionStates.push({
      actionId,
      state,
      operatorNote: note?.trim() || null,
      linkedFollowUpChangeIds: [],
      updatedAt: new Date().toISOString(),
    });
  }

  await persistActionStates();
  revalidatePath("/", "layout");
  return { success: true };
}

export async function batchUpdateActionState(
  actionIds: string[],
  state: OperatorState
): Promise<{ success: boolean }> {
  const now = new Date().toISOString();

  for (const actionId of actionIds) {
    const existing = actionStates.find((s) => s.actionId === actionId);
    if (existing) {
      existing.state = state;
      existing.updatedAt = now;
    } else {
      actionStates.push({
        actionId,
        state,
        operatorNote: null,
        linkedFollowUpChangeIds: [],
        updatedAt: now,
      });
    }
  }

  await persistActionStates();
  revalidatePath("/", "layout");
  return { success: true };
}
