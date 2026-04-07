import { readStore, writeStore } from "@/lib/persistence/json-store";
import type { CandidateLink, TruthLabel } from "./types";

export const candidateLinks: CandidateLink[] = readStore<CandidateLink>("candidate-links");
export const truthLabels: TruthLabel[] = readStore<TruthLabel>("truth-labels");

export async function persistCandidateLinks(): Promise<void> {
  await writeStore("candidate-links", candidateLinks);
}

export async function persistTruthLabels(): Promise<void> {
  await writeStore("truth-labels", truthLabels);
}
