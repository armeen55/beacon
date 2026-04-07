"use server";

import { revalidatePath } from "next/cache";
import { results } from "@/lib/seed-data.server";
import { generateId, now } from "@/lib/actions";
import {
  candidateLinks,
  truthLabels,
  persistCandidateLinks,
  persistTruthLabels,
} from "./store";
import type { TruthRelation } from "./types";

export async function confirmCandidate(
  resultId: string,
  changeId: string
): Promise<{ success: boolean; error?: string }> {
  const result = results.find((r) => r.id === resultId);
  if (!result) return { success: false, error: "Result not found" };

  if (!result.attributed_changelog_ids.includes(changeId)) {
    result.attributed_changelog_ids.push(changeId);
  }

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
    });
  }

  await persistCandidateLinks();
  revalidatePath("/", "layout");
  return { success: true };
}

export async function rejectCandidate(
  resultId: string,
  changeId: string
): Promise<{ success: boolean; error?: string }> {
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
    });
  }

  await persistCandidateLinks();
  revalidatePath(`/results/${resultId}`);
  return { success: true };
}

export async function addTruthLabel(
  resultId: string,
  changeId: string,
  relation: TruthRelation,
  notes?: string
): Promise<{ success: boolean }> {
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
  return { success: true };
}
