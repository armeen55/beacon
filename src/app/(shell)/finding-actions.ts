"use server";

import { revalidatePath } from "next/cache";
import { updateFindingStatus } from "@/domains/scanning/findings-store";
import { updateScanSettings } from "@/domains/scanning/scan-settings";
import type { ScanSettings } from "@/domains/scanning/types";

export async function resolveFinding(
  findingId: string,
  status: string,
): Promise<{ success: boolean }> {
  const validStatuses = ["pending", "accepted", "rejected", "ignored", "expected"];
  if (!validStatuses.includes(status)) return { success: false };
  const result = await updateFindingStatus(findingId, status as "pending" | "accepted" | "rejected" | "ignored" | "expected");
  if (!result) return { success: false };
  revalidatePath("/", "layout");
  return { success: true };
}

export async function saveScanSettings(
  patch: Partial<ScanSettings>,
): Promise<{ success: boolean }> {
  await updateScanSettings(patch);
  revalidatePath("/", "layout");
  return { success: true };
}
