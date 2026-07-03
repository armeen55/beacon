/**
 * term-coverage (2026-07-03, BEACON_500 R18 / P7, v1 411 - term-coverage grade).
 *
 * PURE / no I/O / no LLM. For an owned page that targets a query, scores how much
 * of the DEMAND-BACKED subtopic set the page actually covers:
 *
 *   - the shared section topics the SERP winners agree on (R11 N20's
 *     CommonalityBrief.sharedHeadings - "competitors ranking above you all cover
 *     visa fees, processing time, and required documents"), and
 *   - the demand-ranked sub-questions people ask that this page owns (R11 N30's
 *     question universe, filtered to this page's topic).
 *
 * Coverage = share of those expected subtopics the page's stored extracts
 * (headings + FAQ questions + body sample) actually cover, by the SAME
 * distinguishing-token match the question universe's coverageFor uses (strict
 * smaller-side subset, so "a section covering visa fees" only counts when the
 * page really has one). The 3 highest-demand MISSING subtopics are named for the
 * directive.
 *
 * The grade only becomes a directive when the page is in the ranking band where
 * coverage is the plausible lever - ranking 5-15 (already relevant, not yet
 * winning) with real demand. A #1 page needs no lecture; a #60 page has bigger
 * problems than a missing subsection. That gating lives in the trigger; this
 * core just scores and names gaps honestly.
 *
 * CONTRACT (pinned by tests): zero expected subtopics (no winner consensus AND no
 * owned sub-questions) yields coverage = null (unknown, never 0% off no data) and
 * no missing terms - a page is never graded against an empty rubric.
 */

import { topicTokens } from "@/domains/evidence/relevance-gate";

/** One expected subtopic the page should cover, with its demand weight so the
 *  named gaps are the ones that matter most. */
export type ExpectedSubtopic = {
  /** Human label, shown verbatim in the directive ("visa fees"). */
  label: string;
  /** "consensus" = SERP winners agree on it; "question" = real demand asks it. */
  source: "consensus" | "question";
  /** Demand weight for ranking the missing gaps (winner-vote count for
   *  consensus, demandScore for a question). Higher = named first. */
  weight: number;
};

/** The owned page's stored extracts to grade against (page_snapshots projection:
 *  h2/h3 headings, stored FAQ questions, body_paragraph_sample + card_texts). */
export type CoveragePageExtract = {
  headings: string[];
  faqQuestions: string[];
  bodyText: string | null;
};

export type CoverageGrade = {
  /** 0..1 share of expected subtopics covered, or null when the rubric is empty
   *  (no consensus and no owned questions - unknown, never graded as 0). */
  coverage: number | null;
  /** Count of expected subtopics that fed the grade. */
  expectedCount: number;
  /** Count actually covered by the page's extracts. */
  coveredCount: number;
  /** The highest-demand MISSING subtopic labels, capped (for the directive). */
  missingTopLabels: string[];
  /** Every missing subtopic (unbounded), demand-ranked - for callers that want
   *  the full gap list (e.g. an operator diagnostic). */
  missingAll: ExpectedSubtopic[];
};

/** How many missing subtopics to name in the customer directive. */
export const MAX_NAMED_GAPS = 3;

/**
 * Does the page's extracts cover this expected subtopic? A dedicated structural
 * item (heading / stored FAQ question) whose distinguishing tokens are a strict
 * superset of the subtopic's tokens counts as covered (mirrors the question
 * universe's structuralMatch); failing that, the subtopic's distinguishing
 * tokens ALL appearing in the combined body+headings text counts as covered
 * (a mention, weaker but real). A subtopic with no distinguishing tokens can
 * never be scored (returns false but is excluded from the rubric upstream).
 */
export function subtopicCovered(
  subtopicLabel: string,
  extract: CoveragePageExtract,
): boolean {
  const subTok = new Set(topicTokens(subtopicLabel));
  if (subTok.size === 0) return false;

  const structural = [...(extract.headings ?? []), ...(extract.faqQuestions ?? [])].filter(Boolean);
  for (const item of structural) {
    const iTok = new Set(topicTokens(item));
    if (iTok.size === 0) continue;
    let shared = 0;
    for (const t of subTok) if (iTok.has(t)) shared += 1;
    if (shared === subTok.size) return true; // a section owns it
  }

  // Body-mention fallback: all distinguishing tokens present somewhere on the page.
  const combined = [structural.join(" "), extract.bodyText ?? ""].join(" ");
  const combinedTok = new Set(topicTokens(combined));
  if (combinedTok.size === 0) return false;
  let covered = 0;
  for (const t of subTok) if (combinedTok.has(t)) covered += 1;
  return covered === subTok.size;
}

/**
 * Grade a page's coverage of an expected-subtopic rubric. Pure.
 *
 * Subtopics with no distinguishing tokens (all-generic labels) are dropped from
 * the rubric BEFORE scoring so they can neither inflate nor deflate the grade.
 * Near-duplicate subtopics (same distinguishing-token set) collapse to the
 * highest-weight one so "visa fees" and "the visa fee" are not double-counted.
 */
export function gradeCoverage(
  expected: readonly ExpectedSubtopic[],
  extract: CoveragePageExtract,
): CoverageGrade {
  // Normalize + dedupe the rubric by distinguishing-token signature.
  const byKey = new Map<string, ExpectedSubtopic>();
  for (const sub of expected) {
    const key = topicTokens(sub.label).sort().join(" ");
    if (!key) continue; // all-generic label - not scorable
    const prev = byKey.get(key);
    if (!prev || sub.weight > prev.weight) byKey.set(key, sub);
  }
  const rubric = [...byKey.values()];

  if (rubric.length === 0) {
    return { coverage: null, expectedCount: 0, coveredCount: 0, missingTopLabels: [], missingAll: [] };
  }

  const missing: ExpectedSubtopic[] = [];
  let coveredCount = 0;
  for (const sub of rubric) {
    if (subtopicCovered(sub.label, extract)) coveredCount += 1;
    else missing.push(sub);
  }
  missing.sort((a, b) => b.weight - a.weight || a.label.localeCompare(b.label));

  return {
    coverage: coveredCount / rubric.length,
    expectedCount: rubric.length,
    coveredCount,
    missingTopLabels: missing.slice(0, MAX_NAMED_GAPS).map((m) => m.label),
    missingAll: missing,
  };
}
