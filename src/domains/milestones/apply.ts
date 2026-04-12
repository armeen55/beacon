import { randomUUID } from "node:crypto";

import {
  eventSubtitleForPeak,
  eventTitleForPeak,
} from "./compute";
import type { MilestoneEvent, MilestoneKind, MilestonePeakRow, MilestoneState } from "./types";

const MAX_EVENTS = 150;

const SILENT_FIRST_KEY: ReadonlySet<MilestoneKind> = new Set(["topic_rank_best"]);

function peakToEvent(p: MilestonePeakRow): MilestoneEvent {
  return {
    id: randomUUID(),
    kind: p.kind,
    key: p.key,
    title: eventTitleForPeak(p),
    subtitle: eventSubtitleForPeak(p),
    achievedAt: p.achievedAt,
    value: p.value,
    proofSummary: p.proofSummary,
    meta: p.meta ? { ...p.meta } : undefined,
  };
}

function isBootstrapped(s: MilestoneState): boolean {
  return s.meta?.bootstrapped === true;
}

/**
 * Pure merge: bootstrap fills peaks silently; after that, new beats append events.
 */
export function applyMilestoneSync(
  prev: MilestoneState,
  proposed: MilestonePeakRow[],
): { state: MilestoneState; newEvents: MilestoneEvent[]; dirty: boolean } {
  const state: MilestoneState = {
    meta: { ...prev.meta },
    peaks: { ...prev.peaks },
    events: [...prev.events],
  };
  const newEvents: MilestoneEvent[] = [];

  if (!isBootstrapped(prev)) {
    for (const p of proposed) {
      state.peaks[p.key] = { ...p };
    }
    state.meta = { ...state.meta, bootstrapped: true };
    return { state, newEvents: [], dirty: true };
  }

  let dirty = false;
  for (const p of proposed) {
    const peakPrev = state.peaks[p.key];
    if (!peakPrev) {
      state.peaks[p.key] = { ...p };
      dirty = true;
      if (!SILENT_FIRST_KEY.has(p.kind)) {
        newEvents.push(peakToEvent(state.peaks[p.key]!));
      }
      continue;
    }
    if (p.value > peakPrev.value) {
      state.peaks[p.key] = { ...p };
      dirty = true;
      newEvents.push(peakToEvent(state.peaks[p.key]!));
    }
  }

  if (newEvents.length) {
    state.events = [...newEvents, ...state.events].slice(0, MAX_EVENTS);
    dirty = true;
  }

  return { state, newEvents, dirty };
}
