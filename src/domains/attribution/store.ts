import { readStore, writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import {
  syncCandidateLinks,
  syncEventDecisions,
} from "@/lib/persistence/dual-write";
import type { CandidateLink, TruthLabel, EventDecision } from "./types";

const repo = getRepository();

export const candidateLinks: CandidateLink[] = await repo.getCandidateLinks();
export const truthLabels: TruthLabel[] = readStore<TruthLabel>("truth-labels");
export const eventDecisions: EventDecision[] = await repo.getEventDecisions();

export async function persistCandidateLinks(): Promise<void> {
  await writeStore("candidate-links", candidateLinks);
  await syncCandidateLinks(candidateLinks);
}

export async function persistTruthLabels(): Promise<void> {
  await writeStore("truth-labels", truthLabels);
}

export async function persistEventDecisions(): Promise<void> {
  await writeStore("event-decisions", eventDecisions);
  await syncEventDecisions(eventDecisions);
}
