import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { CandidateLink, TruthLabel, EventDecision } from "./types";

export const candidateLinks: CandidateLink[] = readStore<CandidateLink>("candidate-links");
export const truthLabels: TruthLabel[] = readStore<TruthLabel>("truth-labels");
export const eventDecisions: EventDecision[] = readStore<EventDecision>("event-decisions");

export async function persistCandidateLinks(): Promise<void> {
  await writeStore("candidate-links", candidateLinks);
}

export async function persistTruthLabels(): Promise<void> {
  await writeStore("truth-labels", truthLabels);
}

export async function persistEventDecisions(): Promise<void> {
  await writeStore("event-decisions", eventDecisions);
}
