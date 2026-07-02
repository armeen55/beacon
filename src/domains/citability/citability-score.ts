/**
 * citability-score (2026-07-02, master plan item 26) - PURE deterministic
 * rubric that scores how quotable a page's text is for an AI engine, using
 * the SAME sentence-pattern buckets the miner finds real AI citations
 * favoring (mine-answer-patterns.ts): stat-first, definition, attributed
 * claim, list lead, date anchored.
 *
 * No LLM here, no randomness, no I/O. Same input text always produces the
 * same score. The LLM only writes drafts later, through the existing
 * structured drafter, guided by this rubric's topFixes.
 *
 * Shares its sentence classifier with the miner (pattern-classifier.ts) so a
 * page's own text and the real answer texts it is measured against always
 * agree on what a "quotable" sentence looks like.
 *
 * Scoring model (0-100, five buckets worth up to 20 points each): a page
 * earns points for the FIRST paragraph/opening sentences carrying each
 * quotable pattern, because that is what a crawler-driven AI answer lifts
 * first. Missing a pattern costs its points and produces one topFix.
 */

import { classifySentence, splitIntoSentences, type CitationPatternBucket } from "./pattern-classifier";

export type CitabilityScore = {
  /** 0-100. Higher = more of the patterns real AI citations favor. */
  score: number;
  /** Pattern buckets absent from the scored text (excludes "other"). */
  missingPatterns: CitationPatternBucket[];
  /** Pattern buckets found in the scored text (excludes "other"). */
  presentPatterns: CitationPatternBucket[];
  /** At most 3 one-line instructions, highest-value fix first. */
  topFixes: string[];
};

/** The 5 quotable buckets the rubric scores (excludes "other", which never
 *  earns or costs points - it is simply not one of the patterns AI lifts). */
const SCORED_BUCKETS: readonly Exclude<CitationPatternBucket, "other">[] = [
  "stat_first",
  "definition",
  "attributed_claim",
  "list_lead",
  "date_anchored",
];

const POINTS_PER_BUCKET = 20;

/** How many leading sentences count as "the opening" a crawler-driven AI
 *  answer is most likely to lift. Patterns deeper in the page still count
 *  for presence, but only the opening window drives the score, matching
 *  what the miner found: AI engines quote from near the top of the page. */
const OPENING_WINDOW_SENTENCES = 6;

const ONE_LINE_FIX: Record<Exclude<CitationPatternBucket, "other">, string> = {
  stat_first: "Lead the section with a number-first sentence (a percent, a count, or a dollar amount).",
  definition: "Open with a plain one-line definition naming the exact topic (X is a...).",
  attributed_claim: "Attribute the key claim to a named source (according to, per, X reports).",
  list_lead: "Start the answer as a short numbered or bulleted list of the top items.",
  date_anchored: "Anchor the opening fact to a specific date or year.",
};

/**
 * Score a page's text for citability. PURE. Looks at the opening window of
 * sentences for the score (what an AI answer actually lifts first) but
 * reports presence/absence across the WHOLE text so a pattern buried lower
 * on the page still counts as "present" for the honest evidence line, even
 * though it does not earn score points there.
 */
export function scorePageCitability(pageText: string): CitabilityScore {
  const allSentences = splitIntoSentences(pageText);
  if (allSentences.length === 0) {
    return {
      score: 0,
      missingPatterns: [...SCORED_BUCKETS],
      presentPatterns: [],
      topFixes: SCORED_BUCKETS.slice(0, 3).map((b) => ONE_LINE_FIX[b]),
    };
  }

  const opening = allSentences.slice(0, OPENING_WINDOW_SENTENCES);
  const openingBuckets = new Set(opening.map((s) => classifySentence(s)));
  const wholeBuckets = new Set(allSentences.map((s) => classifySentence(s)));

  let score = 0;
  const present: Exclude<CitationPatternBucket, "other">[] = [];
  const missing: Exclude<CitationPatternBucket, "other">[] = [];
  for (const bucket of SCORED_BUCKETS) {
    if (openingBuckets.has(bucket)) {
      score += POINTS_PER_BUCKET;
      present.push(bucket);
    } else if (wholeBuckets.has(bucket)) {
      // Present but not up front: half credit, still "present" for the
      // evidence line (the pattern exists, just not where it counts most).
      score += POINTS_PER_BUCKET / 2;
      present.push(bucket);
    } else {
      missing.push(bucket);
    }
  }

  const topFixes = missing.slice(0, 3).map((b) => ONE_LINE_FIX[b]);

  return {
    score: Math.round(Math.min(100, score)),
    missingPatterns: missing,
    presentPatterns: present,
    topFixes,
  };
}
