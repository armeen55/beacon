"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { getFindings, updateFindingStatus } from "@/domains/scanning/findings-store";
import { updateScanSettings } from "@/domains/scanning/scan-settings";
import type { ScanSettings, FindingStatus, PromotionStatus, FindingType } from "@/domains/scanning/types";
import { changelogEntries } from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import { writeStore } from "@/lib/persistence/json-store";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { SignalType, AssetType } from "@/lib/constants";
import { syncChangelogEntries } from "@/lib/persistence/dual-write";

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

// ---------------------------------------------------------------------------
// Confirm a scan finding as a real change → auto-create changelog entry
// ---------------------------------------------------------------------------

const FINDING_TO_SIGNAL: Partial<Record<FindingType, SignalType>> = {
  title_changed: "content",
  meta_changed: "content",
  h1_changed: "content",
  faq_changed: "faq",
  schema_changed: "technical",
  content_changed: "content",
  canonical_changed: "technical",
  links_changed: "technical",
  page_added: "page",
  page_removed: "page",
};

function inferAssetType(url: string): AssetType {
  const path = url.replace(/^https?:\/\/[^/]+/, "").replace(/\/+$/, "");
  if (!path || path === "/") return "homepage";
  if (/\/locations?\//i.test(path)) return "city_page";
  if (/\/services?\//i.test(path)) return "service_page";
  if (/\/projects?\//i.test(path)) return "project_page";
  return "service_page";
}

export async function confirmFindingAsChange(
  findingId: string,
): Promise<{ success: boolean; changeId?: string }> {
  const action = "confirmFindingAsChange";
  const t0 = Date.now();
  log.info("Action started", { action, params: { findingId } });

  const findings = getFindings();
  const finding = findings.find((f) => f.id === findingId);
  if (!finding) {
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: "finding not found" });
    return { success: false };
  }

  // 1. Accept the finding and promote to changelog
  await updateFindingStatus(findingId, "accepted", { promotionStatus: "changelog" });

  // 2. Create a changelog entry from the finding
  const changeId = generateId("cl");
  const timestamp = now();
  const signalType: SignalType = FINDING_TO_SIGNAL[finding.type] ?? "content";
  const assetType = finding.url ? inferAssetType(finding.url) : "homepage";
  const pagePath = finding.pagePath || (finding.url ? finding.url.replace(/^https?:\/\/[^/]+/, "") : "") || "/";

  const entry: ChangelogEntry = {
    id: changeId,
    timestamp,
    signal_type: signalType,
    asset_type: assetType,
    url: finding.url,
    asset_name: pagePath,
    change_description: finding.summary,
    topic_targeted: "",
    city_targeted: null,
    hypothesis: null,
    expected_impact_window: "7-14 days",
    brief_id: null,
    opportunity_id: null,
    notes: `Auto-detected by scan. ${finding.previousState ? `Previous: "${finding.previousState}"` : ""} ${finding.currentState ? `Current: "${finding.currentState}"` : ""}`.trim(),
    created_at: timestamp,
    updated_at: timestamp,
    source_system: "scan_detection",
  };

  // 3. Persist: add to in-memory array + write to disk + Supabase
  changelogEntries.push(entry);
  await writeStore("imported-changes", changelogEntries);
  await syncChangelogEntries([entry]);

  // 4. Link the finding to the new changelog entry
  await updateFindingStatus(findingId, "accepted", {
    promotionStatus: "changelog",
    linkedChangeId: changeId,
  });

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0, changeId });
  return { success: true, changeId };
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
