import type { MilestoneEvent, MilestoneKind, MilestoneState } from "./types";
import { isRecentEvent } from "./compute";

const MARKET_RELEVANT: ReadonlySet<MilestoneKind> = new Set([
  "direct_competitor_lead_peak",
  "corpus_owned_share_peak",
  "platform_citation_share_peak",
]);

/**
 * Prefer a milestone recorded this load; otherwise the most recent log entry
 * within `recentDays` (newest-first `state.events`).
 */
export function pickTodayMilestoneTeaser(
  state: MilestoneState,
  newEvents: MilestoneEvent[],
  recentDays = 14,
): MilestoneEvent | null {
  const newestNew = newEvents[0];
  if (newestNew && isRecentEvent(newestNew.achievedAt, recentDays + 7)) {
    return newestNew;
  }
  return state.events.find((e) => isRecentEvent(e.achievedAt, recentDays)) ?? null;
}

export function filterMarketMilestones(
  events: MilestoneEvent[],
  max = 4,
): MilestoneEvent[] {
  return events.filter((e) => MARKET_RELEVANT.has(e.kind)).slice(0, max);
}
