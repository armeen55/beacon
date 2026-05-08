import { cache } from "react";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import {
  syncCandidateLinks,
  syncEventDecisions,
} from "@/lib/persistence/dual-write";
import type { CandidateLink, TruthLabel, EventDecision } from "./types";

type State = {
  candidateLinks: CandidateLink[] | null;
  truthLabels: TruthLabel[] | null;
  eventDecisions: EventDecision[] | null;
};

const _state: State = {
  candidateLinks: null,
  truthLabels: null,
  eventDecisions: null,
};

const ensureLoaded = cache(async (): Promise<void> => {
  if (_state.candidateLinks !== null) return;
  const repo = getRepository();
  const [cl, tl, ed] = await Promise.all([
    repo.getCandidateLinks(),
    repo.getTruthLabels(),
    repo.getEventDecisions(),
  ]);
  _state.candidateLinks = cl;
  _state.truthLabels = tl;
  _state.eventDecisions = ed;
});

export const getCandidateLinks = cache(
  async (): Promise<CandidateLink[]> => {
    await ensureLoaded();
    return _state.candidateLinks!;
  },
);

export const getTruthLabels = cache(async (): Promise<TruthLabel[]> => {
  await ensureLoaded();
  return _state.truthLabels!;
});

export const getEventDecisions = cache(async (): Promise<EventDecision[]> => {
  await ensureLoaded();
  return _state.eventDecisions!;
});

export async function persistCandidateLinks(tenantId: string): Promise<void> {
  const candidateLinks = await getCandidateLinks();
  await writeStore("candidate-links", candidateLinks);
  await syncCandidateLinks(candidateLinks, tenantId);
}

export async function persistTruthLabels(): Promise<void> {
  await writeStore("truth-labels", await getTruthLabels());
}

export async function persistEventDecisions(tenantId: string): Promise<void> {
  const eventDecisions = await getEventDecisions();
  await writeStore("event-decisions", eventDecisions);
  await syncEventDecisions(eventDecisions, tenantId);
}

export function _resetAttributionStoreForTests(): void {
  _state.candidateLinks = null;
  _state.truthLabels = null;
  _state.eventDecisions = null;
}
