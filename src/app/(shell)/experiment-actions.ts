"use server";

import { revalidatePath } from "next/cache";
import {
  startExperiment,
  updateExperimentStatus,
  updateExperimentNote,
  persistExperiments,
  type ExperimentStatus,
} from "@/domains/product/experiment-store";

export async function startExperimentAction(opts: {
  recId: string;
  headline: string;
  recType: string;
  targetPageUrl: string | null;
  targetPagePath: string | null;
  watchAfter: string;
  operatorNote: string;
  baselineCitations: number | null;
}): Promise<{ success: boolean; experimentId: string }> {
  const exp = startExperiment(opts);
  await persistExperiments();
  revalidatePath("/", "layout");
  return { success: true, experimentId: exp.id };
}

export async function updateExperimentAction(
  id: string,
  status: ExperimentStatus,
): Promise<{ success: boolean }> {
  updateExperimentStatus(id, status);
  await persistExperiments();
  revalidatePath("/", "layout");
  return { success: true };
}

export async function updateExperimentNoteAction(
  id: string,
  note: string,
): Promise<{ success: boolean }> {
  updateExperimentNote(id, note);
  await persistExperiments();
  revalidatePath("/", "layout");
  return { success: true };
}
