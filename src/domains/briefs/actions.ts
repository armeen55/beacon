"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { briefs, opportunities } from "@/lib/seed-data.server";
import { CHECKLIST_TEMPLATES } from "@/domains/briefs/checklist-templates";
import { generateId, now } from "@/lib/actions";
import type { BriefStatus, BriefType, Priority, EffortLevel, OutcomeVerdict } from "@/lib/constants";
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

  briefs.push(brief);

  if (opportunityId) {
    const opp = opportunities.find((o) => o.id === opportunityId);
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
  const brief = briefs.find((b) => b.id === briefId);
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

export async function toggleChecklistItem(
  briefId: string,
  itemId: string
): Promise<{ success: boolean }> {
  const action = "toggleChecklistItem";
  const t0 = Date.now();
  log.info("Action started", { action, params: { briefId, itemId } });
  const brief = briefs.find((b) => b.id === briefId);
  if (!brief) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "brief not found",
    });
    return { success: false };
  }

  const item = brief.checklist.find((c) => c.id === itemId);
  if (!item) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "item not found",
    });
    return { success: false };
  }

  if (item.status === "done") {
    item.status = "pending";
    item.completed_at = null;
  } else {
    item.status = "done";
    item.completed_at = now();
  }
  brief.updated_at = now();

  revalidatePath(`/briefs/${briefId}`);
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function addChecklistItem(
  briefId: string,
  label: string
): Promise<{ success: boolean }> {
  const action = "addChecklistItem";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { briefId, labelLength: label.length },
  });
  const brief = briefs.find((b) => b.id === briefId);
  if (!brief) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "brief not found",
    });
    return { success: false };
  }
  if (!label.trim()) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "empty label",
    });
    return { success: false };
  }

  const maxOrder = brief.checklist.reduce(
    (max, c) => Math.max(max, c.sort_order),
    0
  );

  brief.checklist.push({
    id: generateId("chk"),
    label: label.trim(),
    status: "pending",
    sort_order: maxOrder + 1,
    linked_changelog_id: null,
    completed_at: null,
    notes: null,
  });
  brief.updated_at = now();

  revalidatePath(`/briefs/${briefId}`);
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function judgeOutcome(
  briefId: string,
  outcomeId: string,
  verdict: OutcomeVerdict,
  actualValue?: number
): Promise<{ success: boolean }> {
  const action = "judgeOutcome";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { briefId, outcomeId, verdict },
  });
  const brief = briefs.find((b) => b.id === briefId);
  if (!brief) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "brief not found",
    });
    return { success: false };
  }

  const outcome = brief.expected_outcomes.find((o) => o.id === outcomeId);
  if (!outcome) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "outcome not found",
    });
    return { success: false };
  }

  outcome.verdict = verdict;
  outcome.judged_at = verdict === "pending" ? null : now();
  if (actualValue !== undefined && !isNaN(actualValue)) {
    outcome.actual_value = actualValue;
  }
  brief.updated_at = now();

  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
