/**
 * candidate-feed (2026-07-01, master plan item 4) - PURE mapper from the
 * per-engine gap report to the daily candidate builder's input shape. A gap
 * only becomes a candidate signal when a citing engine named one of OUR pages
 * (so we know exactly which page to strengthen); it is bounded to a few per
 * night so gaps season the plan instead of flooding it.
 */

import { MAX_ENGINE_GAP_CANDIDATES_PER_NIGHT, ENGINE_PLAIN_NAME, type EngineId } from "./engine-types";
import { promptGapSentence, type PromptEngineMatrixRow } from "./engine-gaps";

/** The note attached to a daily candidate for a page with an engine gap. */
export type EngineGapNote = {
  /** The exact tracked question the engines diverge on. */
  promptText: string;
  /** Plain engine names that already point people at this page. */
  citedEngines: string[];
  /** Plain engine names that were checked and do not point here yet. */
  missingEngines: string[];
  /** Ready-to-append operator sentence (Beacon voice, no dashes). */
  sentence: string;
};

/** Normalize an owned URL to the path key build-daily-candidates uses
 *  (origin stripped, query/hash stripped, no trailing slash, "/" for root). */
export function gapPathKey(url: string): string {
  const p = url.replace(/^https?:\/\/[^/]+/i, "").replace(/[?#].*$/, "").replace(/\/$/, "");
  return p || "/";
}

/**
 * Gap report -> Map<normalized page path, EngineGapNote>, bounded to
 * MAX_ENGINE_GAP_CANDIDATES_PER_NIGHT. Report gaps arrive widest-first, so
 * the bound keeps the biggest divergences. One note per page (first wins).
 */
export function buildEngineGapNotes(
  gaps: Array<Pick<PromptEngineMatrixRow, "promptText" | "citedEngines" | "missingEngines" | "ownedUrl">>,
  limit: number = MAX_ENGINE_GAP_CANDIDATES_PER_NIGHT,
): Map<string, EngineGapNote> {
  const out = new Map<string, EngineGapNote>();
  for (const gap of gaps) {
    if (out.size >= limit) break;
    if (!gap.ownedUrl) continue; // no owned page named -> nothing exact to strengthen
    const key = gapPathKey(gap.ownedUrl);
    if (out.has(key)) continue;
    out.set(key, {
      promptText: gap.promptText,
      citedEngines: gap.citedEngines.map((e: EngineId) => ENGINE_PLAIN_NAME[e]),
      missingEngines: gap.missingEngines.map((e: EngineId) => ENGINE_PLAIN_NAME[e]),
      sentence: promptGapSentence(gap),
    });
  }
  return out;
}
