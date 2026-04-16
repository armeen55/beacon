"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { changelogEntries, briefs, opportunities } from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import { writeStore } from "@/lib/persistence/json-store";
import { syncChangelogEntries } from "@/lib/persistence/dual-write";
import type { ChangelogEntry } from "@/domains/changelog/types";
import type { SignalType, AssetType } from "@/lib/constants";
import { absoluteUrlForPath } from "@/lib/site-config";

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
    tenant_id: "",
  };

  changelogEntries.push(entry);

  // Persist to disk + Supabase (fixes data loss on restart)
  await writeStore("imported-changes", changelogEntries);
  try {
    await syncChangelogEntries([entry]);
  } catch (e) {
    console.error("[changelog] Supabase sync failed:", e);
  }

  // Auto-create experiment to track this change's impact
  try {
    const { startExperiment, persistExperiments } = await import(
      "@/domains/product/experiment-store"
    );
    const baseline = await lookupBaselineMetrics(url, topicTargeted);
    startExperiment({
      recId: changeId,
      headline: assetName,
      recType: `changelog_${signalType}`,
      targetPageUrl: url ? absoluteUrlForPath(url) : null,
      targetPagePath: url,
      watchAfter: expectedImpactWindow || "Check after 7 days",
      operatorNote: changeDescription,
      baselineCitations: baseline.citations,
      baselineMentions: baseline.mentions,
      baselineVisibility: baseline.visibility,
      trackedTopic: topicTargeted,
    });
    await persistExperiments();
  } catch (e) {
    console.warn("[auto-experiment] creation failed:", e);
  }

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
// Baseline metrics for auto-experiment
// ---------------------------------------------------------------------------

async function lookupBaselineMetrics(
  url: string | null,
  topic: string,
): Promise<{ citations: number; mentions: number; visibility: number }> {
  try {
    const { readStore: rs } = await import("@/lib/persistence/json-store");
    type DMS = { date: string; scope_type: string; scope_id: string; mention_count: number; citation_count: number; visibility_score: number };

    let citations = 0;
    if (url) {
      const { citationEvidenceIndex } = await import(
        "@/domains/pages/citation-evidence-store"
      );
      if (citationEvidenceIndex) {
        const normUrl = (url.startsWith("http") ? url : `https://placeholder${url}`)
          .replace(/\/+$/, "")
          .toLowerCase();
        const pathOnly = normUrl.replace(/^https?:\/\/[^/]+/, "");
        for (const r of citationEvidenceIndex.by_page_and_topic) {
          if (!r.is_owned) continue;
          const rPath = r.page_url.replace(/\/+$/, "").toLowerCase().replace(/^https?:\/\/[^/]+/, "");
          if (rPath === pathOnly) citations += r.total_citations;
        }
      }
    }

    // 7-day average mentions + visibility from daily-metric-snapshots
    const snapshots = rs<DMS>("daily-metric-snapshots");
    const topicLower = topic.toLowerCase();
    const matching = snapshots.filter(
      (s) => s.scope_type === "topic" && s.scope_id.toLowerCase().includes(topicLower.split(/\s+/)[0]),
    );
    const dates = [...new Set(matching.map((s) => s.date))].sort().slice(-7);
    const recent = matching.filter((s) => dates.includes(s.date));

    const mentions = recent.length > 0
      ? Math.round(recent.reduce((a, s) => a + (s.mention_count || 0), 0) / Math.max(dates.length, 1))
      : 0;
    const visibility = recent.length > 0
      ? Math.round(recent.reduce((a, s) => a + (s.visibility_score || 0), 0) / Math.max(dates.length, 1) * 10) / 10
      : 0;

    return { citations, mentions, visibility };
  } catch {
    return { citations: 0, mentions: 0, visibility: 0 };
  }
}
