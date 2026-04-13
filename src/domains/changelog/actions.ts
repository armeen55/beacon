"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { changelogEntries, briefs, opportunities } from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { SignalType, AssetType } from "@/lib/constants";

export async function createChangelogEntry(
  formData: FormData
): Promise<{ success: boolean; error?: string; changeId?: string }> {
  const action = "createChangelogEntry";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      signalType: formData.get("signal_type"),
      assetType: formData.get("asset_type"),
      hasBriefId: Boolean(formData.get("brief_id")),
    },
  });
  const assetName = (formData.get("asset_name") as string)?.trim();
  const changeDescription = (formData.get("change_description") as string)?.trim();
  const signalType = formData.get("signal_type") as SignalType;
  const assetType = formData.get("asset_type") as AssetType;
  const url = (formData.get("url") as string)?.trim() || null;
  const topicTargeted = (formData.get("topic_targeted") as string)?.trim();
  const cityTargeted = (formData.get("city_targeted") as string)?.trim() || null;
  const hypothesis = (formData.get("hypothesis") as string)?.trim() || null;
  const expectedImpactWindow =
    (formData.get("expected_impact_window") as string) || null;
  const briefId = (formData.get("brief_id") as string) || null;
  const opportunityId = (formData.get("opportunity_id") as string) || null;

  if (!assetName || !changeDescription || !signalType || !assetType || !topicTargeted) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "missing required fields",
    });
    return { success: false, error: "Fill in all required fields." };
  }

  const changeId = generateId("cl");
  const timestamp = now();

  const entry: ChangelogEntry = {
    id: changeId,
    timestamp,
    signal_type: signalType,
    asset_type: assetType,
    url,
    asset_name: assetName,
    change_description: changeDescription,
    topic_targeted: topicTargeted,
    city_targeted: cityTargeted,
    hypothesis,
    expected_impact_window: expectedImpactWindow,
    brief_id: briefId,
    opportunity_id: opportunityId,
    notes: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  changelogEntries.push(entry);

  if (briefId) {
    const brief = briefs.find((b) => b.id === briefId);
    if (brief && !brief.linked_changelog_ids.includes(changeId)) {
      brief.linked_changelog_ids.push(changeId);
      brief.updated_at = timestamp;
    }
  }

  if (opportunityId) {
    const opp = opportunities.find((o) => o.id === opportunityId);
    if (opp && !opp.linked_changelog_ids.includes(changeId)) {
      opp.linked_changelog_ids.push(changeId);
      opp.updated_at = timestamp;
    }
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, changeId };
}
