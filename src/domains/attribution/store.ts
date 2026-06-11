import { cache } from "react";

import { writeStore } from "@/lib/persistence/json-store";
import { getRepository } from "@/lib/persistence/repositories";
import { currentTenantId } from "@/lib/tenant-context";
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

// Night-shift fix (2026-06-11): 7th instance of the process-global
// cache class — first tenant pinned attribution state for everyone in
// a warm process; candidate_links + attribution_decisions reads pulled
// EVERY tenant's rows on hosted. Per-tenant Map; the two table reads
// route through forTenant (truth-labels stays ambient-disk).
const _stateByTenant = new Map<string, State>();

async function loadStateForTenant(tenantId: string): Promise<State> {
  const repo = getRepository();
  const [cl, tl, ed] = await Promise.all([
    repo.forTenant(tenantId).getCandidateLinks(),
    repo.getTruthLabels(),
    repo.forTenant(tenantId).getEventDecisions(),
  ]);
  return { candidateLinks: cl, truthLabels: tl, eventDecisions: ed };
}

const ensureLoaded = cache(async (): Promise<State> => {
  const tenantId = await currentTenantId();
  const cached = _stateByTenant.get(tenantId);
  if (cached) return cached;
  const loaded = await loadStateForTenant(tenantId);
  _stateByTenant.set(tenantId, loaded);
  return loaded;
});

export const getCandidateLinks = cache(
  async (): Promise<CandidateLink[]> => {
    return (await ensureLoaded()).candidateLinks!;
  },
);

export const getTruthLabels = cache(async (): Promise<TruthLabel[]> => {
  return (await ensureLoaded()).truthLabels!;
});

export const getEventDecisions = cache(async (): Promise<EventDecision[]> => {
  return (await ensureLoaded()).eventDecisions!;
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
  _stateByTenant.clear();
}
