"use server";

import { revalidatePath } from "next/cache";
import {
  startExperiment,
  updateExperimentStatus,
  updateExperimentNote,
  persistExperiments,
  type ExperimentStatus,
} from "@/domains/product/experiment-store";
import { recordOutcome, persistOutcomes } from "@/domains/product/outcome-store";

export async function startExperimentAction(opts: {
  recId: string;
  headline: string;
  recType: string;
  targetPageUrl: string | null;
  targetPagePath: string | null;
  watchAfter: string;
  operatorNote: string;
  baselineCitations: number | null;
  replicationSourceChangeId?: string | null;
  replicationPatternId?: string | null;
  replicationEvidenceTier?: "observed" | "mixed" | "inferred";
}): Promise<{ success: boolean; experimentId: string }> {
  const exp = startExperiment(opts);
  await persistExperiments();

  if (opts.replicationSourceChangeId || opts.replicationPatternId) {
    recordOutcome({
      action_type: "experiment_started",
      action_detail: `Replication track started: ${opts.headline}`,
      rec_id: opts.recId,
      experiment_id: exp.id,
      change_id: opts.replicationSourceChangeId ?? null,
      target_page: opts.targetPageUrl,
      target_topic: null,
      verdict: null,
      citation_delta: null,
      confidence: opts.replicationEvidenceTier ?? null,
      source_signal_tier:
        opts.replicationEvidenceTier === "inferred" ? "inferred" : "explicit",
      pattern_id: opts.replicationPatternId ?? null,
    });
    persistOutcomes().catch(() => {});
  }

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
