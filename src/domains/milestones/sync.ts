import "server-only";

import type { Result } from "@/domains/results/types";
import type { CitationEvidenceIndex } from "@/domains/pages/types";
import type { CompetitorRankEntry } from "@/lib/performance-timeseries";
import { readStore, writeStore } from "@/lib/persistence/json-store";

import { collectAllProposedPeaks } from "./compute";
import type { MilestoneEvent, MilestoneState } from "./types";
import { applyMilestoneSync } from "./apply";

const STORE = "milestone-state";

function cloneState(raw: MilestoneState): MilestoneState {
  return {
    meta: raw.meta ? { ...raw.meta } : {},
    peaks: { ...raw.peaks },
    events: [...raw.events],
  };
}

async function readState(): Promise<MilestoneState> {
  const rows = await readStore<MilestoneState>(STORE, []);
  if (!rows.length) {
    return { peaks: {}, events: [], meta: {} };
  }
  return cloneState(rows[0]!);
}

async function persistState(state: MilestoneState): Promise<void> {
  await writeStore(STORE, [state]);
}

/**
 * Recompute peaks from current workspace inputs, update persisted state, and
 * return new milestone events (empty on first-ever bootstrap — avoids noisy
 * backfill “celebrations”).
 */
export async function syncMilestonesFromWorkspace(input: {
  results: Result[];
  citationIndex: CitationEvidenceIndex | null;
  siteDomain: string;
  competitorRank: CompetitorRankEntry[] | null;
}): Promise<{ state: MilestoneState; newEvents: MilestoneEvent[] }> {
  const proposed = collectAllProposedPeaks(
    input.results,
    input.citationIndex,
    input.siteDomain,
    input.competitorRank,
  );

  const prev = await readState();
  const { state, newEvents, dirty } = applyMilestoneSync(prev, proposed);
  if (dirty) await persistState(state);
  return { state, newEvents };
}

/** Read-only snapshot for pages that should not mutate state twice in one request. */
export async function getMilestoneState(): Promise<MilestoneState> {
  return await readState();
}
