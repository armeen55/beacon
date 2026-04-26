"use server";

import { revalidatePath } from "next/cache";
import { log } from "@/lib/logger";
import { getResults } from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import {
  getCandidateLinks,
  getTruthLabels,
  getEventDecisions,
  persistCandidateLinks,
  persistTruthLabels,
  persistEventDecisions,
} from "./store";
import type { TruthRelation, CauseType, OperatorConfidence } from "./types";

export async function confirmCandidate(
  resultId: string,
  changeId: string
): Promise<{ success: boolean; error?: string }> {
  const action = "confirmCandidate";
  const t0 = Date.now();
  log.info("Action started", { action, params: { resultId, changeId } });
  const result = (await getResults()).find((r) => r.id === resultId);
  if (!result) {
    log.error("Action failed", {
      action,
      durationMs: Date.now() - t0,
      error: "result not found",
    });
    return { success: false, error: "Result not found" };
  }

  if (!result.attributed_changelog_ids.includes(changeId)) {
    result.attributed_changelog_ids.push(changeId);
  }

  const candidateLinks = await getCandidateLinks();
  const existing = candidateLinks.find(
    (cl) => cl.result_id === resultId && cl.change_id === changeId
  );

  if (existing) {
    existing.status = "confirmed";
    existing.reviewed_at = now();
  } else {
    candidateLinks.push({
      id: generateId("cl"),
      result_id: resultId,
      change_id: changeId,
      status: "confirmed",
      attribution: null!,
      created_at: now(),
      reviewed_at: now(),
      tenant_id: "",
    });
  }

  await persistCandidateLinks();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function rejectCandidate(
  resultId: string,
  changeId: string
): Promise<{ success: boolean; error?: string }> {
  const action = "rejectCandidate";
  const t0 = Date.now();
  log.info("Action started", { action, params: { resultId, changeId } });
  const candidateLinks = await getCandidateLinks();
  const existing = candidateLinks.find(
    (cl) => cl.result_id === resultId && cl.change_id === changeId
  );

  if (existing) {
    existing.status = "rejected";
    existing.reviewed_at = now();
  } else {
    candidateLinks.push({
      id: generateId("cl"),
      result_id: resultId,
      change_id: changeId,
      status: "rejected",
      attribution: null!,
      created_at: now(),
      reviewed_at: now(),
      tenant_id: "",
    });
  }

  await persistCandidateLinks();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function rejectAllCandidates(
  resultId: string,
  changeIds: string[]
): Promise<{ success: boolean }> {
  const action = "rejectAllCandidates";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: { resultId, changeIdCount: changeIds.length },
  });
  const candidateLinks = await getCandidateLinks();
  for (const changeId of changeIds) {
    const existing = candidateLinks.find(
      (cl) => cl.result_id === resultId && cl.change_id === changeId
    );
    if (existing) {
      existing.status = "rejected";
      existing.reviewed_at = now();
    } else {
      candidateLinks.push({
        id: generateId("cl"),
        result_id: resultId,
        change_id: changeId,
        status: "rejected",
        attribution: null!,
        created_at: now(),
        reviewed_at: now(),
        tenant_id: "",
      });
    }
  }

  await persistCandidateLinks();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function addTruthLabel(
  resultId: string,
  changeId: string,
  relation: TruthRelation,
  notes?: string
): Promise<{ success: boolean }> {
  const action = "addTruthLabel";
  const t0 = Date.now();
  log.info("Action started", { action, params: { resultId, changeId, relation } });
  const truthLabels = await getTruthLabels();
  const existing = truthLabels.find(
    (tl) => tl.result_id === resultId && tl.change_id === changeId
  );

  if (existing) {
    existing.relation = relation;
    existing.labeled_at = now();
    existing.notes = notes?.trim() || null;
  } else {
    truthLabels.push({
      id: generateId("truth"),
      result_id: resultId,
      change_id: changeId,
      relation,
      labeled_at: now(),
      notes: notes?.trim() || null,
    });
  }

  await persistTruthLabels();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}

export async function lockDecision(
  eventId: string,
  resultId: string,
  causeType: CauseType,
  primaryChangeId: string | null,
  operatorConfidence: OperatorConfidence,
  operatorNote: string | null,
  allCandidateChangeIds: string[]
): Promise<{ success: boolean }> {
  const action = "lockDecision";
  const t0 = Date.now();
  log.info("Action started", {
    action,
    params: {
      eventId,
      resultId,
      causeType,
      candidateCount: allCandidateChangeIds.length,
    },
  });
  const eventDecisions = await getEventDecisions();
  const candidateLinks = await getCandidateLinks();
  const existing = eventDecisions.find((d) => d.event_id === eventId);

  const rejectedIds = allCandidateChangeIds.filter((id) => id !== primaryChangeId);

  if (existing) {
    existing.cause_type = causeType;
    existing.primary_change_id = primaryChangeId;
    existing.operator_confidence = operatorConfidence;
    existing.operator_note = operatorNote?.trim() || null;
    existing.rejected_change_ids = rejectedIds;
    existing.decided_at = now();
  } else {
    eventDecisions.push({
      id: generateId("ed"),
      event_id: eventId,
      result_id: resultId,
      cause_type: causeType,
      primary_change_id: primaryChangeId,
      operator_confidence: operatorConfidence,
      operator_note: operatorNote?.trim() || null,
      rejected_change_ids: rejectedIds,
      decided_at: now(),
      tenant_id: "",
    });
  }

  if (causeType === "change" && primaryChangeId) {
    const result = (await getResults()).find((r) => r.id === resultId);
    if (result && !result.attributed_changelog_ids.includes(primaryChangeId)) {
      result.attributed_changelog_ids.push(primaryChangeId);
    }

    const existingLink = candidateLinks.find(
      (cl) => cl.result_id === resultId && cl.change_id === primaryChangeId
    );
    if (existingLink) {
      existingLink.status = "confirmed";
      existingLink.reviewed_at = now();
    } else {
      candidateLinks.push({
        id: generateId("cl"),
        result_id: resultId,
        change_id: primaryChangeId,
        status: "confirmed",
        attribution: null!,
        created_at: now(),
        reviewed_at: now(),
        tenant_id: "",
      });
    }
  }

  for (const changeId of rejectedIds) {
    const existingLink = candidateLinks.find(
      (cl) => cl.result_id === resultId && cl.change_id === changeId
    );
    if (existingLink) {
      existingLink.status = "rejected";
      existingLink.reviewed_at = now();
    } else {
      candidateLinks.push({
        id: generateId("cl"),
        result_id: resultId,
        change_id: changeId,
        status: "rejected",
        attribution: null!,
        created_at: now(),
        reviewed_at: now(),
        tenant_id: "",
      });
    }
  }

  await persistEventDecisions();
  await persistCandidateLinks();
  revalidatePath("/", "layout");
  log.info("Action completed", { action, durationMs: Date.now() - t0 });
  return { success: true };
}
