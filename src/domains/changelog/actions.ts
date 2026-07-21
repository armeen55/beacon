"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import {
  getChangelogEntries,
  getBriefs,
  getOpportunities,
} from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import { writeStore } from "@/lib/persistence/json-store";
import { syncChangelogEntries } from "@/lib/persistence/dual-write";
import { currentTenantId } from "@/lib/tenant-context";
import type { ChangelogEntry, HypothesisSource } from "@/domains/changelog/types";
import type { SignalType, AssetType } from "@/lib/constants";
import { absoluteUrlForPath } from "@/lib/site-config";
import { promises as fs } from "node:fs";
import path from "node:path";

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
  // v7 Commit 5 (2026-04-23): Accept from /recommendations passes a
  // serialized brief here so the full edit list + page brief travels
  // with the changelog entry for review on /changes.
  const notes = (formData.get("notes") as string)?.trim() || null;

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
  const tenantId = await currentTenantId();

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
    notes,
    created_at: timestamp,
    updated_at: timestamp,
    tenant_id: tenantId,
  };

  const changelogEntries = await getChangelogEntries();
  changelogEntries.push(entry);

  // Persist to disk + Supabase (fixes data loss on restart)
  await writeStore("imported-changes", changelogEntries);
  try {
    await syncChangelogEntries([entry], tenantId);
  } catch (e) {
    console.error("[changelog] Supabase sync failed:", e);
  }

  // Phase 4 (2026-04-19): auto-experiment creation removed. The Z-score engine
  // in url-change-outcomes watches every URL change automatically via
  // url-watcher \u2014 no separate tracking table needed.

  if (briefId) {
    const brief = (await getBriefs()).find((b) => b.id === briefId);
    if (brief && !brief.linked_changelog_ids.includes(changeId)) {
      brief.linked_changelog_ids.push(changeId);
      brief.updated_at = timestamp;
    }
  }

  if (opportunityId) {
    const opp = (await getOpportunities()).find((o) => o.id === opportunityId);
    if (opp && !opp.linked_changelog_ids.includes(changeId)) {
      opp.linked_changelog_ids.push(changeId);
      opp.updated_at = timestamp;
    }
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, changeId };
}

// softDeleteChangelogEntry + markDedupeReviewedBulk (and their private
// backupImportedChangesOnce helper) removed 2026-07-21
// (CORE 100K): their only callers were the deleted /changes/dedupe UI.

// ---------------------------------------------------------------------------
// Update hypothesis on an existing changelog entry (edit from detail page).
// ---------------------------------------------------------------------------

export async function updateChangelogHypothesis(
  id: string,
  hypothesis: string | null,
  source: HypothesisSource = "operator",
): Promise<{ success: boolean; error?: string }> {
  const action = "updateChangelogHypothesis";
  const t0 = Date.now();
  log.info("Action started", { action, params: { id, source } });

  const changelogEntries = await getChangelogEntries();
  const entry = changelogEntries.find((c) => c.id === id);
  if (!entry) return { success: false, error: "Entry not found." };

  const cleaned = hypothesis?.trim() || null;
  entry.hypothesis = cleaned;
  entry.hypothesis_source = cleaned ? source : undefined;
  entry.updated_at = now();

  await writeStore("imported-changes", changelogEntries);
  try {
    await syncChangelogEntries([entry], await currentTenantId());
  } catch (e) {
    console.error("[changelog] Supabase sync failed:", e);
  }

  revalidatePath(`/changes/${id}`);
  revalidatePath("/changes");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
