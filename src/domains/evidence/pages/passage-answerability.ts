/**
 * passage-answerability - PURE passage-level answerability rules. `extractability.ts` grades a whole page
 * on coarse factors (has FAQ, has schema, word count); this checks ONE passage against ONE question on the
 * quotability heuristics an AI answer engine rewards when it lifts a passage verbatim.
 *
 * The rules mirror (never import from) `competitor-page-audit.ts`'s answer-block heuristic and add:
 *   1. self-contained length (roughly 40-60 words - the AEO answer-block norm)
 *   2. entity-named first sentence (no pronoun opener like "It is..."/"This...")
 *   3. contains a concrete number or date
 *   4. directly addresses the question's own terms (token overlap)
 *
 * No I/O, no LLM, no randomness. Same input always produces the same output,
 * so this is fully unit-testable and safe to call from a server component.
 */

// ── shared word/sentence helpers (mirrors competitor-page-audit.ts's own
//    small helpers so this file has zero cross-import; keep in sync by eye,
//    not by shared code, per the item's "mirror, do not edit" instruction) ──

function words(text: string): string[] {
  return (text ?? "").trim().split(/\s+/).filter(Boolean);
}

function passageWordCount(text: string): number {
  return words(text).length;
}

function firstSentenceOf(text: string): string {
  const parts = (text ?? "").trim().split(/(?<=[.!?])\s+/);
  return parts[0] ?? (text ?? "").trim();
}

const STOP = new Set([
  "the", "a", "an", "of", "for", "in", "on", "to", "and", "or", "is", "are", "was",
  "with", "best", "top", "how", "what", "why", "list", "guide", "your", "you", "this",
  "that", "from", "by", "at", "as", "it", "be", "we", "our", "their", "they", "have",
  "has", "can", "will", "more", "all", "about", "into", "out", "up", "if", "but",
  "when", "where", "who", "which", "does", "do", "did",
]);

function tokens(text: string): Set<string> {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2 && !STOP.has(t) && !/^\d+$/.test(t)),
  );
}

// ── the four quotability rules ──────────────────────────────────────────────

/** Self-contained AEO answer-block length band (mirrors the 20-120 detector in
 *  competitor-page-audit.ts's `hasAnswerBlock`, tightened to the item's
 *  "roughly 40-60 words" target with a workable +/-10 tolerance either side
 *  so a clean 35- or 65-word passage isn't punished for a rounding error). */
const IDEAL_MIN_WORDS = 30;
const IDEAL_MAX_WORDS = 70;

/** A first sentence that opens with a pronoun instead of naming the subject -
 *  the single most common reason an otherwise-good paragraph can't be lifted
 *  out of context and quoted on its own. */
const PRONOUN_OPENER = /^\s*(it|this|that|these|those|they|he|she|there)\b/i;

/** A concrete number or date signal - digits, or a written-out year/decade. */
const NUMBER_OR_DATE = /\b\d{1,4}(?:[.,]\d+)?\b|\b(?:19|20)\d{2}s?\b/;

export type PassageFailureCode =
  | "not_self_contained"
  | "pronoun_opener"
  | "no_number_or_date"
  | "off_question";

export type PassageRuleCheck = {
  code: PassageFailureCode;
  /** True = rule PASSES (no failure). */
  passed: boolean;
  /** Plain-English fix, phrased as an instruction, never a lint label. */
  fix: string;
};

/** Run the four quotability rules against one passage + its target question.
 *  Pure. Returns a check per rule, in the fixed order the item lists them. */
export function checkPassageRules(passage: string, question: string): PassageRuleCheck[] {
  const wc = passageWordCount(passage);
  const s1 = firstSentenceOf(passage);

  const selfContained = wc >= IDEAL_MIN_WORDS && wc <= IDEAL_MAX_WORDS;
  const namesSubjectFirst = !PRONOUN_OPENER.test(s1);
  const hasNumberOrDate = NUMBER_OR_DATE.test(passage);

  const qTokens = tokens(question);
  const pTokens = tokens(passage);
  let overlap = 0;
  for (const t of qTokens) if (pTokens.has(t)) overlap += 1;
  // "Addresses the question" = shares at least one real content token, or the
  // question carries no scoreable tokens at all (e.g. a very short question) -
  // in which case we don't penalize the passage for something unmeasurable.
  const addressesQuestion = qTokens.size === 0 || overlap >= 1;

  return [
    {
      code: "not_self_contained",
      passed: selfContained,
      fix:
        wc < IDEAL_MIN_WORDS
          ? `Add detail so the passage runs ${IDEAL_MIN_WORDS} to ${IDEAL_MAX_WORDS} words (it is ${wc} now) - too short to stand alone as a quote.`
          : `Trim the passage to ${IDEAL_MIN_WORDS} to ${IDEAL_MAX_WORDS} words (it is ${wc} now) so it reads as one self-contained answer.`,
    },
    {
      code: "pronoun_opener",
      passed: namesSubjectFirst,
      fix: `Name the subject in the first sentence instead of opening with "${(s1.match(PRONOUN_OPENER)?.[0] ?? "it")}".`,
    },
    {
      code: "no_number_or_date",
      passed: hasNumberOrDate,
      fix: "Add a concrete number or date so the answer reads as a specific fact, not a generality.",
    },
    {
      code: "off_question",
      passed: addressesQuestion,
      fix: "Use the question's own words in the passage so it reads as a direct answer, not a tangent.",
    },
  ];
}
