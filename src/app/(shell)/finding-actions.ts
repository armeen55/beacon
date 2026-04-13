"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { updateFindingStatus } from "@/domains/scanning/findings-store";
import { updateScanSettings } from "@/domains/scanning/scan-settings";
import type { ScanSettings, FindingStatus, PromotionStatus } from "@/domains/scanning/types";

export async function resolveFinding(
  findingId: string,
  status: string,
  opts?: {
    resolutionNote?: string;
    suppressDays?: number;
  },
): Promise<{ success: boolean; consequence?: string }> {
  const action = "resolveFinding";
  const t0 = Date.now();
  log.info("Action started", { action, params: { findingId, status } });
  const validStatuses: FindingStatus[] = ["pending", "accepted", "rejected", "ignored", "expected"];
  if (!validStatuses.includes(status as FindingStatus)) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "invalid status",
    });
    return { success: false };
  }

  const suppressDays = status === "expected" ? (opts?.suppressDays ?? 14) : 0;

  const result = await updateFindingStatus(
    findingId,
    status as FindingStatus,
    {
      resolutionNote: opts?.resolutionNote ?? null,
      suppressDays,
    },
  );
  if (!result) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "updateFindingStatus returned false",
    });
    return { success: false };
  }

  let consequence = "";
  switch (status) {
    case "accepted":
      consequence = "Marked as trusted. You can promote this to the changelog or keep as a verified finding.";
      break;
    case "expected":
      consequence = `Suppressed for ${suppressDays} days. Similar findings on this page won't re-appear during that window.`;
      break;
    case "ignored":
      consequence = "Dismissed. This stays in history but won't affect recommendations.";
      break;
    case "rejected":
      consequence = "Marked as false positive. Future similar detections for this page will be de-prioritized.";
      break;
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, consequence };
}

export async function promoteFinding(
  findingId: string,
  promotionStatus: string,
): Promise<{ success: boolean }> {
  const action = "promoteFinding";
  const t0 = Date.now();
  log.info("Action started", { action, params: { findingId, promotionStatus } });
  const validPromotions: PromotionStatus[] = ["none", "changelog", "secondary_note", "history_only"];
  if (!validPromotions.includes(promotionStatus as PromotionStatus)) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "invalid promotionStatus",
    });
    return { success: false };
  }

  const result = await updateFindingStatus(findingId, "accepted", {
    promotionStatus: promotionStatus as PromotionStatus,
  });
  if (!result) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "updateFindingStatus returned false",
    });
    return { success: false };
  }
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function saveScanSettings(
  patch: Partial<ScanSettings>,
): Promise<{ success: boolean }> {
  const action = "saveScanSettings";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { keys: Object.keys(patch) },
  });
  await updateScanSettings(patch);
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
