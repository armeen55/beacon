/**
 * citability-hints (2026-07-02, master plan item 26) - PURE join of the
 * crawl-to-citation funnel (src/domains/ai-visibility/crawl-citation-funnel.ts)
 * with the deterministic citability rubric (citability-score.ts) into the
 * "make it quotable" lever: pages that rank (real demand, real GSC position)
 * but AI never quotes them (funnel stage crawled_not_cited or cited_no_clicks
 * - the item-7 funnel's own vocabulary for "not converting to citations")
 * AND whose page text scores below the citability threshold, become a
 * bounded (max 2/night) hint carrying the exact topFixes the answer-block
 * drafter should apply.
 *
 * Follows the trend-radar/spike-hints + seasonal-hints precedent exactly:
 * pure, no I/O, bounded, one hint per page (first wins), composes ADDITIVELY
 * beside the other hint families in build-today-preview.ts.
 */

import { normalizePath } from "@/domains/experiments/daily-plan-types";
import type { FunnelReport, FunnelStage } from "@/domains/ai-visibility/crawl-citation-funnel";
import { scorePageCitability, type CitabilityScore } from "./citability-score";
import type { CitationPatternBucket } from "./pattern-classifier";

/** A page below this citability score is worth strengthening (0-100 scale;
 *  below 50 means at least half the quotable buckets are missing up front). */
export const CITABILITY_SCORE_THRESHOLD = 50;

/** At most this many "make it quotable" hints reach the plan builder per
 *  night, so the lever seasons the plan instead of flooding it. */
export const MAX_CITABILITY_HINTS_PER_NIGHT = 2;

/** Funnel stages that mean "AI can see this page but is not quoting it" -
 *  the exact bottleneck this lever fixes. A never-crawled page has a
 *  different fix (internal links, item 7's own lever); a converting page
 *  needs no help. */
const TARGET_STAGES: readonly FunnelStage[] = ["crawled_not_cited", "cited_no_clicks"];

/** The note attached to a daily candidate whose page ranks but is never
 *  quoted by AI. */
export type CitabilityHintNote = {
  score: number;
  missingPatterns: CitabilityScore["missingPatterns"];
  presentPatterns: CitabilityScore["presentPatterns"];
  topFixes: string[];
  funnelStage: FunnelStage;
  /** Ready-to-append operator sentence (Beacon voice, no dashes). */
  sentence: string;
  /** The exact evidence-brief line for the daily card (deliverable 4). */
  evidenceLine: string;
};

/** Plain-language name for what's missing, used inside the evidence line so
 *  it names the ACTUAL missing patterns rather than a generic complaint.
 *  "other" never appears in missingPatterns (the rubric only scores the 5
 *  named buckets) but is included so the Record is total, never partial. */
const PATTERN_PLAIN: Record<CitationPatternBucket, string> = {
  stat_first: "a number up front",
  definition: "a plain definition",
  attributed_claim: "an attributed claim",
  list_lead: "a list-style lead",
  date_anchored: "a specific date",
  other: "the patterns AI quotes most",
};

function twoMissingPlain(missing: CitabilityScore["missingPatterns"]): string {
  const plain = missing.map((m) => PATTERN_PLAIN[m]).filter(Boolean);
  if (plain.length === 0) return "the patterns AI quotes most";
  if (plain.length === 1) return plain[0]!;
  return `${plain[0]} and ${plain[1]}`;
}

/**
 * One page's citability hint, or null when the page does not qualify: PURE.
 * Qualifies when (a) the funnel says AI can see the page but never quotes it
 * (crawled_not_cited or cited_no_clicks - never a never-crawled page, which
 * has a different fix), (b) real demand exists (the funnel's own demand
 * proxy, so this never fires on a page nobody searches for), and (c) the
 * page's own text scores below the citability threshold.
 */
export function buildCitabilityHint(input: {
  pagePath: string;
  funnelStage: FunnelStage;
  demand: number;
  pageText: string;
  minDemand?: number;
}): CitabilityHintNote | null {
  if (!TARGET_STAGES.includes(input.funnelStage)) return null;
  const minDemand = input.minDemand ?? 1; // any proven demand > 0 (the funnel already filtered to ranking pages)
  if (input.demand < minDemand) return null;
  const score = scorePageCitability(input.pageText);
  if (score.score >= CITABILITY_SCORE_THRESHOLD) return null; // already quotable enough
  if (score.missingPatterns.length === 0) return null; // nothing concrete to fix

  const missingPlain = twoMissingPlain(score.missingPatterns);
  const sentence = `AI already reaches this page but has not quoted it yet. Its text is missing ${missingPlain}, the exact patterns AI answers lift when they cite a source. ${score.topFixes[0] ?? ""}`.trim();
  const evidenceLine = `AI reads this page but never quotes it. The pages AI does quote lead with numbers and plain definitions; this one does neither.`;

  return {
    score: score.score,
    missingPatterns: score.missingPatterns,
    presentPatterns: score.presentPatterns,
    topFixes: score.topFixes,
    funnelStage: input.funnelStage,
    sentence,
    evidenceLine,
  };
}

/**
 * Funnel report + per-page text -> Map<normalized page path,
 * CitabilityHintNote>, bounded to MAX_CITABILITY_HINTS_PER_NIGHT. Pages
 * arrive ranked by the funnel's own demand-first ordering, so the bound
 * keeps the highest-demand stalled pages. One hint per page (first wins). A
 * page with no cached text is skipped (nothing to score).
 */
export function buildCitabilityHintNotes(
  funnel: Pick<FunnelReport, "stalled">,
  pageTextByPath: Map<string, string>,
  limit: number = MAX_CITABILITY_HINTS_PER_NIGHT,
): Map<string, CitabilityHintNote> {
  const out = new Map<string, CitabilityHintNote>();
  for (const page of funnel.stalled) {
    if (out.size >= limit) break;
    const key = normalizePath(page.pagePath);
    if (out.has(key)) continue;
    const text = pageTextByPath.get(key);
    if (!text) continue; // no cached crawl text - nothing to score, never guess
    const hint = buildCitabilityHint({
      pagePath: key,
      funnelStage: page.stage,
      demand: page.demand,
      pageText: text,
    });
    if (hint) out.set(key, hint);
  }
  return out;
}
