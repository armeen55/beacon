"use server";

import { revalidatePath } from "next/cache";
import { briefs } from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import { briefStates, persistBriefStates } from "./store";
import type { ProposedBrief, ProposedBriefStatus } from "./types";
import type { Brief } from "@/domains/briefs/types";
import type { BriefType } from "@/lib/constants";

const PROPOSED_TO_BRIEF_TYPE: Record<string, BriefType> = {
  page_rebuild: "page_rebuild",
  new_page: "new_page",
  page_refresh: "content_update",
  faq_upgrade: "content_update",
  schema_alignment: "schema_fix",
  internal_linking: "off_page",
  crawlability_fix: "technical_fix",
  measurement_fix: "technical_fix",
  coverage_expansion: "new_page",
};

export async function acceptProposedBrief(
  proposed: ProposedBrief
): Promise<{ success: boolean; briefId?: string; error?: string }> {
  const existing = briefStates.find((s) => s.briefId === proposed.id);
  if (existing?.status === "accepted") {
    return {
      success: false,
      error: "Brief already accepted",
    };
  }

  const timestamp = now();
  const briefId = generateId("brief");

  const brief: Brief = {
    id: briefId,
    title: proposed.title,
    objective: proposed.objective,
    opportunity_ids: proposed.sourceOpportunityId
      ? [proposed.sourceOpportunityId]
      : [],
    status: "draft",
    priority:
      proposed.priority === "critical"
        ? "critical"
        : proposed.priority,
    brief_type: PROPOSED_TO_BRIEF_TYPE[proposed.briefType] ?? "content_update",
    effort: proposed.caveats.length >= 3 ? "large" : "medium",
    target_url: proposed.targetUrl,
    target_city: proposed.targetCity,
    target_topic: proposed.targetTopic,
    checklist: proposed.recommendedSteps.map((step, i) => ({
      id: `${briefId}-step-${i}`,
      label: step,
      status: "pending" as const,
      sort_order: i,
      linked_changelog_id: null,
      completed_at: null,
      notes: null,
    })),
    expected_outcomes: proposed.successCriteria.map((criteria, i) => ({
      id: `${briefId}-outcome-${i}`,
      description: criteria,
      metric_type: "mention_count" as const,
      platform: (proposed.targetPlatform === "all"
        ? "chatgpt"
        : proposed.targetPlatform) as "chatgpt",
      target_value: null,
      baseline_value: null,
      timeframe: "30 days",
      verdict: "pending" as const,
      actual_value: null,
      result_id: null,
      judged_at: null,
    })),
    linked_changelog_ids: [],
    related_brief_ids: [],
    prior_brief_id: null,
    blocked_reason:
      proposed.blockedBy.length > 0 ? proposed.blockedBy.join("; ") : null,
    due_date: null,
    approved_at: null,
    started_at: null,
    blocked_at: null,
    completed_at: null,
    impact_window_ends_at: null,
    retrospective: null,
    created_at: timestamp,
    updated_at: timestamp,
    source_system: "beacon-brief-gen",
  };

  briefs.push(brief);

  updateBriefState(proposed.id, "accepted", briefId);
  await persistBriefStates();

  revalidatePath("/", "layout");
  return { success: true, briefId };
}

export async function rejectProposedBrief(
  briefId: string
): Promise<{ success: boolean }> {
  updateBriefState(briefId, "rejected", null);
  await persistBriefStates();
  revalidatePath("/", "layout");
  return { success: true };
}

export async function archiveProposedBrief(
  briefId: string
): Promise<{ success: boolean }> {
  updateBriefState(briefId, "archived", null);
  await persistBriefStates();
  revalidatePath("/", "layout");
  return { success: true };
}

function updateBriefState(
  briefId: string,
  status: ProposedBriefStatus,
  acceptedBriefId: string | null
) {
  const existing = briefStates.findIndex((s) => s.briefId === briefId);
  const entry = {
    briefId,
    status,
    acceptedBriefId,
    updatedAt: now(),
  };

  if (existing >= 0) {
    briefStates[existing] = entry;
  } else {
    briefStates.push(entry);
  }
}
