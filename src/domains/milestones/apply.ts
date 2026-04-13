import { randomUUID } from "node:crypto";

import {
  eventSubtitleForPeak,
  eventTitleForPeak,
} from "./compute";
import type { MilestoneEvent, MilestoneKind, MilestoneMagnitude, MilestonePeakRow, MilestoneState } from "./types";

const MAX_EVENTS = 150;

const SILENT_FIRST_KEY: ReadonlySet<MilestoneKind> = new Set(["topic_rank_best"]);

const FIRST_TIME_KINDS: ReadonlySet<MilestoneKind> = new Set([
  "topic_first_top3",
  "topic_first_rank1",
]);

export function classifyMagnitude(
  kind: MilestoneKind,
  newValue: number,
  prevValue: number | null,
): MilestoneMagnitude {
  if (FIRST_TIME_KINDS.has(kind)) return "major";
  if (prevValue === null || prevValue <= 0) return "major";
  const ratio = (newValue - prevValue) / prevValue;
  return ratio >= 0.2 ? "major" : "minor";
}

function calendarDay(iso: string): string {
  return iso.slice(0, 10);
}

function peakToEvent(
  p: MilestonePeakRow,
  prevValue: number | null,
): MilestoneEvent {
  return {
    id: randomUUID(),
    kind: p.kind,
    key: p.key,
    title: eventTitleForPeak(p),
    subtitle: eventSubtitleForPeak(p),
    achievedAt: p.achievedAt,
    value: p.value,
    proofSummary: p.proofSummary,
    magnitude: classifyMagnitude(p.kind, p.value, prevValue),
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
        newEvents.push(peakToEvent(state.peaks[p.key]!, null));
      }
      continue;
    }
    if (p.value > peakPrev.value) {
      const prevVal = peakPrev.value;
      state.peaks[p.key] = { ...p };
      dirty = true;
      const sameDayExists = state.events.some(
        (e) => e.key === p.key && calendarDay(e.achievedAt) === calendarDay(p.achievedAt),
      );
      if (!sameDayExists) {
        newEvents.push(peakToEvent(state.peaks[p.key]!, prevVal));
      }
    }
  }

  if (newEvents.length) {
    state.events = [...newEvents, ...state.events].slice(0, MAX_EVENTS);
    dirty = true;
  }

  return { state, newEvents, dirty };
}
