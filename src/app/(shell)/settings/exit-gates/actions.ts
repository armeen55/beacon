"use server";

import { revalidatePath } from "next/cache";
import {
  updateExitGate,
  type ExitGateKey,
  type ExitGateStatus,
} from "@/lib/exit-gates-store";

export async function setExitGateStatus(
  key: ExitGateKey,
  status: ExitGateStatus,
): Promise<void> {
  await updateExitGate(key, { status });
  revalidatePath("/settings");
  revalidatePath("/settings/exit-gates");
}

export async function saveExitGateNote(key: ExitGateKey, note: string): Promise<void> {
  await updateExitGate(key, { note });
  revalidatePath("/settings");
  revalidatePath("/settings/exit-gates");
}
