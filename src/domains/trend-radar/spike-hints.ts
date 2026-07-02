/**
 * trend-radar/spike-hints (2026-07-02, master plan item 14) - PURE mapper from
 * this week's query spikes to the daily plan builder's hint shape, following
 * the engineGapsByUrl precedent (ai-visibility/candidate-feed) exactly: a spike
 * only becomes a hint when its best page is known AND that page verifiably
 * LACKS a fresh on-page answer for the spiking search (the caller supplies the
 * deterministic gap test, e.g. proposeAnswerGap over crawl facts), and the feed
 * is bounded so spikes season the plan instead of flooding it.
 */

import { normalizePath } from "@/domains/experiments/daily-plan-types";
import type { QuerySpike } from "./query-spikes";

/** At most this many spike hints reach the plan builder per night. */
export const MAX_SPIKE_HINTS_PER_NIGHT = 3;

/** The note attached to a daily candidate whose page has a spiking search. */
export type SpikeHintNote = {
  query: string;
  thisWeek: number;
  typicalWeek: number;
  ratio: number | null;
  /** Ready-to-append operator sentence (Beacon voice, no dashes). */
  sentence: string;
};

/**
 * Spikes -> Map<normalized page path, SpikeHintNote>, bounded. Spikes arrive
 * ranked (biggest first), so the bound keeps the biggest movers. One hint per
 * page (first wins). `lacksFreshAnswer(topPageUrl, query)` must return true
 * only when the page verifiably has NO answer for the spiking search; a page
 * we cannot verify gets no hint (never fabricate urgency).
 */
export function buildSpikeHintNotes(
  spikes: QuerySpike[],
  lacksFreshAnswer: (topPageUrl: string, query: string) => boolean,
  limit: number = MAX_SPIKE_HINTS_PER_NIGHT,
): Map<string, SpikeHintNote> {
  const out = new Map<string, SpikeHintNote>();
  for (const s of spikes) {
    if (out.size >= limit) break;
    if (!s.topPage) continue; // no page named -> nothing exact to strengthen
    const key = normalizePath(s.topPage);
    if (out.has(key)) continue;
    if (!lacksFreshAnswer(s.topPage, s.query)) continue;
    out.set(key, {
      query: s.query,
      thisWeek: s.thisWeek,
      typicalWeek: s.typicalWeek,
      ratio: s.ratio,
      sentence: s.sentence,
    });
  }
  return out;
}
