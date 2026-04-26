"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { changelogEntries, briefs, opportunities } from "@/lib/seed-data.server";
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
    tenant_id: "",
  };

  changelogEntries.push(entry);

  // Persist to disk + Supabase (fixes data loss on restart)
  await writeStore("imported-changes", changelogEntries);
  try {
    await syncChangelogEntries([entry], await currentTenantId());
  } catch (e) {
    console.error("[changelog] Supabase sync failed:", e);
  }

  // Phase 4 (2026-04-19): auto-experiment creation removed. The Z-score engine
  // in url-change-outcomes watches every URL change automatically via
  // url-watcher \u2014 no separate tracking table needed.

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

// ---------------------------------------------------------------------------
// Soft-delete (archive) — used by the /changes/dedupe review flow.
// Flips `archived: true` on the entry so display code hides it while keeping
// the record on disk (and in Supabase) for reversal.
// ---------------------------------------------------------------------------

const DATA_DIR = path.resolve(process.cwd(), ".data");

async function backupImportedChangesOnce(): Promise<void> {
  try {
    const src = path.join(DATA_DIR, "imported-changes.json");
    // One backup per day is enough — check existing backups first.
    const entries = await fs.readdir(DATA_DIR).catch(() => [] as string[]);
    const today = new Date().toISOString().slice(0, 10);
    const alreadyBacked = entries.some(
      (e) => e.startsWith("imported-changes.backup.") && e.includes(today),
    );
    if (alreadyBacked) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dest = path.join(DATA_DIR, `imported-changes.backup.${stamp}.json`);
    await fs.copyFile(src, dest);
    log.info("changelog backup created", { path: dest });
  } catch (e) {
    log.warn("changelog backup failed", { error: String(e) });
  }
}

export async function softDeleteChangelogEntry(
  id: string,
  reason: string,
): Promise<{ success: boolean; error?: string }> {
  const action = "softDeleteChangelogEntry";
  const t0 = Date.now();
  log.info("Action started", { action, params: { id, reason } });

  const entry = changelogEntries.find((c) => c.id === id);
  if (!entry) {
    log.error("Action failed", { action, durationMs: Date.now() - t0, error: "not found" });
    return { success: false, error: "Entry not found." };
  }
  if (entry.archived) {
    return { success: true };
  }

  await backupImportedChangesOnce();

  entry.archived = true;
  entry.archived_reason = reason;
  entry.archived_at = now();
  entry.updated_at = entry.archived_at;

  await writeStore("imported-changes", changelogEntries);
  try {
    await syncChangelogEntries([entry], await currentTenantId());
  } catch (e) {
    console.error("[changelog] Supabase sync failed:", e);
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function restoreChangelogEntry(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const action = "restoreChangelogEntry";
  const t0 = Date.now();
  log.info("Action started", { action, params: { id } });

  const entry = changelogEntries.find((c) => c.id === id);
  if (!entry) return { success: false, error: "Entry not found." };

  entry.archived = false;
  delete entry.archived_reason;
  delete entry.archived_at;
  entry.updated_at = now();

  await writeStore("imported-changes", changelogEntries);
  try {
    await syncChangelogEntries([entry], await currentTenantId());
  } catch (e) {
    console.error("[changelog] Supabase sync failed:", e);
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

// ---------------------------------------------------------------------------
// Mark a set of changelog entries as "dedupe_reviewed" (operator confirmed
// they are NOT duplicates). Used by the one-time "Dismiss all remaining"
// button on /changes/dedupe so the banner stays at zero forever.
// ---------------------------------------------------------------------------

export async function markDedupeReviewedBulk(
  ids: string[],
): Promise<{ success: boolean; count: number; error?: string }> {
  const action = "markDedupeReviewedBulk";
  const t0 = Date.now();
  log.info("Action started", { action, params: { count: ids.length } });

  const idSet = new Set(ids);
  const timestamp = now();
  const touched: ChangelogEntry[] = [];
  for (const e of changelogEntries) {
    if (!idSet.has(e.id)) continue;
    if (e.dedupe_reviewed) continue;
    e.dedupe_reviewed = true;
    e.dedupe_reviewed_at = timestamp;
    e.updated_at = timestamp;
    touched.push(e);
  }

  if (touched.length === 0) {
    return { success: true, count: 0 };
  }

  await writeStore("imported-changes", changelogEntries);
  try {
    await syncChangelogEntries(touched, await currentTenantId());
  } catch (e) {
    console.error("[changelog] Supabase sync failed:", e);
  }

  revalidatePath("/changes");
  revalidatePath("/changes/dedupe");
  log.info("Action completed", { action, durationMs: Date.now() - t0, count: touched.length });
  return { success: true, count: touched.length };
}

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
