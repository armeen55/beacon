/**
 * language-gap/language-gap-hints (2026-07-02, master plan item 24) - PURE
 * mapper from the language-gap matrix to the daily plan builder's hint shape,
 * following the trend-radar/spike-hints and seasonal/seasonal-hints
 * precedent exactly: a gap only becomes a hint when it names a real page and
 * a real impression number, and the feed is bounded so language gaps season
 * the plan instead of flooding it.
 */

import { normalizePath } from "@/domains/experiments/daily-plan-types";
import type { LanguageGap } from "./language-gaps";

/** At most this many language-gap hints reach the plan builder per night. */
export const MAX_LANGUAGE_GAP_HINTS_PER_NIGHT = 2;

/** The note attached to a daily candidate whose page has a language gap. */
export type LanguageGapHintNote = {
  gapKind: LanguageGap["gapKind"];
  impressions: number;
  topVariants: string[];
  /** Ready-to-append operator sentence (Beacon voice, no dashes). */
  sentence: string;
};

/**
 * Gaps -> Map<normalized page path, LanguageGapHintNote>, bounded. Gaps
 * arrive ranked (biggest impressions first, from buildLanguageGaps), so the
 * bound keeps the biggest movers. One hint per page (first wins, matching
 * buildLanguageGaps' own one-finding-per-page contract).
 */
export function buildLanguageGapHintNotes(
  gaps: LanguageGap[],
  limit: number = MAX_LANGUAGE_GAP_HINTS_PER_NIGHT,
): Map<string, LanguageGapHintNote> {
  const out = new Map<string, LanguageGapHintNote>();
  for (const g of gaps) {
    if (out.size >= limit) break;
    if (!g.page) continue;
    const key = normalizePath(g.page);
    if (out.has(key)) continue;
    out.set(key, {
      gapKind: g.gapKind,
      impressions: g.impressions,
      topVariants: g.topVariants,
      sentence: g.sentence,
    });
  }
  return out;
}
