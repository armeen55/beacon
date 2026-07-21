"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { getBriefs, getOpportunities } from "@/lib/seed-data.server";
import { CHECKLIST_TEMPLATES } from "@/domains/briefs/checklist-templates";
import { generateId, now } from "@/lib/actions";
import type { BriefStatus, BriefType, Priority, EffortLevel } from "@/lib/constants";
import type { Brief, ChecklistItem } from "@/domains/briefs/types";

export async function createBrief(
  formData: FormData
): Promise<{ success: boolean; error?: string; briefId?: string }> {
  const action = "createBrief";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      briefType: formData.get("brief_type"),
      hasOpportunityId: Boolean(formData.get("opportunity_id")),
    },
  });
  const title = (formData.get("title") as string)?.trim();
  const objective = (formData.get("objective") as string)?.trim();
  const briefType = formData.get("brief_type") as BriefType;
  const priority = (formData.get("priority") as Priority) || "medium";
  const effort = (formData.get("effort") as EffortLevel) || "medium";
  const targetUrl = (formData.get("target_url") as string)?.trim() || null;
  const targetCity = (formData.get("target_city") as string)?.trim() || null;
  const targetTopic = (formData.get("target_topic") as string)?.trim() || null;
  const dueDate = (formData.get("due_date") as string)?.trim() || null;
  const opportunityId = (formData.get("opportunity_id") as string) || null;

  if (!title || !objective || !briefType) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "missing title/objective/type",
    });
    return { success: false, error: "Title, objective, and type are required." };
  }

  const briefId = generateId("brief");
  const timestamp = now();

  const template = CHECKLIST_TEMPLATES[briefType] ?? [];
  const checklist: ChecklistItem[] = template.map((t) => ({
    id: generateId("chk"),
    label: t.label,
    status: "pending" as const,
    sort_order: t.sort_order,
    linked_changelog_id: null,
    completed_at: null,
    notes: null,
  }));

  const brief: Brief = {
    id: briefId,
    title,
    objective,
    opportunity_ids: opportunityId ? [opportunityId] : [],
    status: "draft",
    priority,
    brief_type: briefType,
    effort,
    target_url: targetUrl,
    target_city: targetCity,
    target_topic: targetTopic,
    checklist,
    expected_outcomes: [],
    linked_changelog_ids: [],
    related_brief_ids: [],
    prior_brief_id: null,
    blocked_reason: null,
    due_date: dueDate,
    approved_at: null,
    started_at: null,
    blocked_at: null,
    completed_at: null,
    impact_window_ends_at: null,
    retrospective: null,
    created_at: timestamp,
    updated_at: timestamp,
  };

  (await getBriefs()).push(brief);

  if (opportunityId) {
    const opp = (await getOpportunities()).find((o) => o.id === opportunityId);
    if (opp && !opp.linked_brief_ids.includes(briefId)) {
      opp.linked_brief_ids.push(briefId);
      opp.updated_at = timestamp;
    }
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true, briefId };
}

export async function updateBriefStatus(
  briefId: string,
  newStatus: BriefStatus
): Promise<{ success: boolean; error?: string }> {
  const action = "updateBriefStatus";
  const t0 = Date.now();
  log.info("Action started", { action, params: { briefId, newStatus } });
  const brief = (await getBriefs()).find((b) => b.id === briefId);
  if (!brief) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "brief not found",
    });
    return { success: false, error: "Brief not found" };
  }

  brief.status = newStatus;
  const timestamp = now();
  brief.updated_at = timestamp;

  switch (newStatus) {
    case "approved":
      if (!brief.approved_at) brief.approved_at = timestamp;
      break;
    case "in_progress":
      if (!brief.started_at) brief.started_at = timestamp;
      break;
    case "completed":
      brief.completed_at = timestamp;
      break;
    case "blocked":
      brief.blocked_at = timestamp;
      break;
  }

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
