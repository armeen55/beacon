import type { MilestoneEvent, MilestoneKind, MilestoneState } from "./types";
import { isRecentEvent } from "./compute";

const MARKET_RELEVANT: ReadonlySet<MilestoneKind> = new Set([
  "direct_competitor_lead_peak",
  "corpus_owned_share_peak",
  "platform_citation_share_peak",
]);

const WEEKLY_MINOR_CAP = 3;

/**
 * Prefer a milestone recorded this load; otherwise the most recent log entry
 * within `recentDays` (newest-first `state.events`).
 *
 * Noise cap: when 3+ minor events fired in the past 7 days, only surface
 * a major milestone. If all are minor, suppress (operator can view on Changes).
 */
export function pickTodayMilestoneTeaser(
  state: MilestoneState,
  newEvents: MilestoneEvent[],
  recentDays = 14,
): MilestoneEvent | null {
  const newestNew = newEvents[0];
  if (newestNew && isRecentEvent(newestNew.achievedAt, recentDays + 7)) {
    return applyNoiseCap(newestNew, state.events);
  }
  const candidate = state.events.find((e) => isRecentEvent(e.achievedAt, recentDays)) ?? null;
  return candidate ? applyNoiseCap(candidate, state.events) : null;
}

function applyNoiseCap(
  candidate: MilestoneEvent,
  allEvents: MilestoneEvent[],
): MilestoneEvent | null {
  if (candidate.magnitude === "major") return candidate;
  const recentMinors = allEvents.filter(
    (e) => e.magnitude !== "major" && isRecentEvent(e.achievedAt, 7),
  ).length;
  if (recentMinors >= WEEKLY_MINOR_CAP) {
    const majorFallback = allEvents.find(
      (e) => e.magnitude === "major" && isRecentEvent(e.achievedAt, 14),
    );
    return majorFallback ?? null;
  }
  return candidate;
}

export function filterMarketMilestones(
  events: MilestoneEvent[],
  max = 4,
): MilestoneEvent[] {
  return events.filter((e) => MARKET_RELEVANT.has(e.kind)).slice(0, max);
}
