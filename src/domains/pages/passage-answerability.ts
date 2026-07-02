/**
 * passage-answerability (BEACON 500 item 78) - PURE passage-level answerability
 * scoring. `extractability.ts` grades a whole page on coarse factors (has FAQ,
 * has schema, word count). This is finer-grained: it splits a page's content
 * body into paragraph-ish passages and scores EACH ONE against a target
 * fanout question on the same quotability heuristics an AI answer engine
 * actually rewards when it lifts a passage verbatim.
 *
 * The rules mirror (do not import from - that file owns the competitor-facing
 * "what wins" audit) `competitor-page-audit.ts`'s answer-block heuristic and
 * add three more checks the item calls for:
 *   1. self-contained length (roughly 40-60 words - the AEO answer-block norm)
 *   2. entity-named first sentence (no pronoun opener like "It is..."/"This...")
 *   3. contains a concrete number or date
 *   4. directly addresses the question's own terms (token overlap)
 *
 * No I/O, no LLM, no randomness. Same input always produces the same output,
 * so this is fully unit-testable and safe to call from a server component.
 */

// ── passage splitting ───────────────────────────────────────────────────────

/** Split a content body into paragraph-ish passages. Handles both a body
 *  that already arrives as an array of paragraphs (page_snapshots'
 *  `body_paragraph_sample`) and a single raw-text blob (double-newline or
 *  single-newline separated). Empty/whitespace-only chunks are dropped. */
export function splitIntoPassages(body: string | readonly string[]): string[] {
  const raw = Array.isArray(body) ? body : splitRawText(body as string);
  return raw
    .map((p) => (p ?? "").replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
}

function splitRawText(text: string): string[] {
  const t = (text ?? "").trim();
  if (!t) return [];
  // Prefer paragraph breaks (blank line); fall back to single newlines when
  // the source has none (some crawls flatten paragraphs to one line each).
  const byBlank = t.split(/\n\s*\n+/).filter((s) => s.trim());
  if (byBlank.length > 1) return byBlank;
  return t.split(/\n+/).filter((s) => s.trim());
}

// ── shared word/sentence helpers (mirrors competitor-page-audit.ts's own
//    small helpers so this file has zero cross-import; keep in sync by eye,
//    not by shared code, per the item's "mirror, do not edit" instruction) ──

function words(text: string): string[] {
  return (text ?? "").trim().split(/\s+/).filter(Boolean);
}

export function passageWordCount(text: string): number {
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

// ── per-(page, question) scoring ────────────────────────────────────────────

export type PassageScore = {
  passage: string;
  /** 0-100, one quarter per rule passed. */
  score: number;
  /** Plain-English fixes for every rule that failed (empty when score is 100). */
  failures: string[];
};

const POINTS_PER_RULE = 25;

/** Score ONE passage against ONE question. Pure, 0-100. */
export function scorePassageForQuestion(passage: string, question: string): PassageScore {
  const checks = checkPassageRules(passage, question);
  const score = checks.reduce((sum, c) => sum + (c.passed ? POINTS_PER_RULE : 0), 0);
  const failures = checks.filter((c) => !c.passed).map((c) => c.fix);
  return { passage, score, failures };
}

/** True when a passage at least addresses the question's own terms. A
 *  well-formatted passage that fails every other rule is still a candidate
 *  "best passage" (there is something to fix); a well-formatted passage that
 *  never mentions the question's terms at all is not an answer to THIS
 *  question, no matter how clean its prose is. */
function addressesQuestion(passage: string, question: string): boolean {
  return checkPassageRules(passage, question).find((c) => c.code === "off_question")!.passed;
}

export type QuestionAnswerability = {
  question: string;
  /** The single best-scoring passage on the page for this question. */
  bestPassage: string | null;
  /** 0-100. 0 when the page has no passages at all. */
  score: number;
  /** Plain-English fixes for the best passage (empty when score is 100). */
  failures: string[];
};

/** A passage counts as "covering" a question once it clears this score - high
 *  enough that at most one rule is failing, which matches "quotable, maybe
 *  with one small fix" rather than "technically the closest match but still
 *  broken." */
export const COVERAGE_SCORE_THRESHOLD = 75;

/** Score a page (as passages) against ONE target question: the best passage,
 *  its score, and why it falls short (if it does). Pure.
 *
 * Selection prefers passages that at least address the question's own terms
 * over ones that don't, even when an off-topic passage happens to be better
 * FORMATTED - otherwise a clean but unrelated passage could look like
 * "coverage" for a question it never actually answers. Among passages tied
 * on that, the higher overall score wins. */
export function scoreQuestionAgainstPassages(
  passages: readonly string[],
  question: string,
): QuestionAnswerability {
  if (passages.length === 0) {
    return { question, bestPassage: null, score: 0, failures: ["This page has no content passages to check yet."] };
  }
  let best: PassageScore | null = null;
  let bestAddresses = false;
  for (const p of passages) {
    const scored = scorePassageForQuestion(p, question);
    const addresses = addressesQuestion(p, question);
    const better =
      !best ||
      (addresses && !bestAddresses) ||
      (addresses === bestAddresses && scored.score > best.score);
    if (better) {
      best = scored;
      bestAddresses = addresses;
    }
  }
  return {
    question,
    bestPassage: best!.passage,
    score: best!.score,
    failures: best!.failures,
  };
}

// ── page-level coverage across all fanout questions ─────────────────────────

export type PageAnswerabilityCoverage = {
  pageUrl: string;
  /** Percent (0-100) of target questions with a passage scoring >= threshold. */
  coveragePercent: number;
  /** The single best-scoring passage across the whole page (any question). */
  bestPassage: string | null;
  /** Best-scoring passage's own score, 0-100. */
  bestPassageScore: number;
  /** Per-question detail, in the same order as the input questions. */
  perQuestion: QuestionAnswerability[];
  /** Questions that did NOT clear the coverage threshold, worst-covered first. */
  uncoveredQuestions: QuestionAnswerability[];
};

/**
 * Coverage for one page against its fanout questions (the demand-graph
 * packet's `fanoutSeeds`). Pure - callers own loading the page's passages and
 * fanout seeds; this only computes the numbers. Never fabricates a question -
 * an empty `questions` array yields 0% coverage with an empty question list,
 * not a fabricated 100%.
 */
export function computePageAnswerabilityCoverage(
  pageUrl: string,
  body: string | readonly string[],
  questions: readonly string[],
): PageAnswerabilityCoverage {
  const passages = splitIntoPassages(body);
  const perQuestion = questions.map((q) => scoreQuestionAgainstPassages(passages, q));

  // "Covered" requires BOTH a high score AND that the best passage actually
  // addresses the question - a well-formatted but off-topic passage must
  // never count as coverage just because it clears the numeric bar.
  const isCovered = (q: QuestionAnswerability) =>
    q.score >= COVERAGE_SCORE_THRESHOLD && (q.bestPassage == null || addressesQuestion(q.bestPassage, q.question));
  const covered = perQuestion.filter(isCovered).length;
  const coveragePercent = perQuestion.length > 0 ? Math.round((covered / perQuestion.length) * 100) : 0;

  let bestPassage: string | null = null;
  let bestPassageScore = 0;
  for (const q of perQuestion) {
    if (q.bestPassage && q.score > bestPassageScore) {
      bestPassage = q.bestPassage;
      bestPassageScore = q.score;
    }
  }
  // No questions at all but the page does have passages: still surface the
  // single best-formed passage (self-contained + named subject + a fact) so
  // the UI has something to show even before fanout questions exist.
  if (!bestPassage && passages.length > 0 && questions.length === 0) {
    let best: PassageScore | null = null;
    for (const p of passages) {
      const scored = scorePassageForQuestion(p, "");
      if (!best || scored.score > best.score) best = scored;
    }
    bestPassage = best!.passage;
    bestPassageScore = best!.score;
  }

  const uncoveredQuestions = perQuestion
    .filter((q) => !isCovered(q))
    .sort((a, b) => a.score - b.score);

  return {
    pageUrl,
    coveragePercent,
    bestPassage,
    bestPassageScore,
    perQuestion,
    uncoveredQuestions,
  };
}
