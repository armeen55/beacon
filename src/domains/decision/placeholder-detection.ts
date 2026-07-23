/**
 * W3 Step 3.1 (2026-05-01) — placeholder + structural-quality detection.
 *
 * Pure functions. No I/O, no DB, no LLM. Used by:
 *   - specific-edit-validator: rejects edits whose proposedText reads
 *     like a generator placeholder OR a structurally-useless FAQ body
 *     before they reach the persistence layer.
 *   - providers/generators/*: gates the deterministic generators so
 *     they abstain ("better empty than bad") when the only output they
 *     could honestly produce would fail validation anyway.
 *
 * Two detection layers:
 *
 * 1. PHRASE detection — looksLikePlaceholder(). Catches the explicit
 *    placeholder strings the master plan calls out:
 *      - "Draft answer"
 *      - "TBD"
 *      - "operator: rewrite" (with or without parens)
 *      - "rewrite below"
 *      - "[insert ..."
 *      - "placeholder"
 *      - "(operator: ...)"  — any operator-instruction parenthetical
 *
 * 2. STRUCTURAL detection — evaluateFaqAnswer({ question, answer }).
 *    Even when no placeholder phrase fires, an FAQ answer can still
 *    be useless if it:
 *      - is under MIN_FAQ_ANSWER_WORDS (25) words
 *      - mostly repeats the question (≥80% content-word overlap)
 *      - has no specific content beyond generic filler ("learn",
 *        "find", "more information", etc.)
 *
 * The structural test only runs against FAQ answer bodies. H2
 * headings, page titles, meta descriptions are short by design and
 * don't get the under-25-words rule.
 *
 * Hard rules locked by tests:
 *   - All eight phrase patterns reject (case-insensitive).
 *   - looksLikePlaceholder is whitespace-tolerant.
 *   - evaluateFaqAnswer is deterministic (no Date / Math.random).
 *   - Empty / null inputs return safe defaults (don't throw).
 *   - The verdict's `reason` enum is stable so callers can branch.
 */

// ---------------------------------------------------------------------------
// Phrase detection
// ---------------------------------------------------------------------------

/**
 * Patterns that MUST never appear in operator-visible copy. Each entry
 * is a case-insensitive regex. Order matters only for diagnostic
 * messages — the first match wins; collectively they're a union.
 *
 * Operator scope (W3 Step 3.1, founder note 2026-05-01):
 *   - "Draft answer"
 *   - "TBD"
 *   - "operator: rewrite" / "(operator: rewrite)"
 *   - "rewrite below"
 *   - "[insert ..."
 *   - "placeholder"
 *   - "(operator: ...)" parenthetical
 *
 * Patterns are intentionally LITERAL — no semantic quality scoring at
 * this layer (that's evaluateFaqAnswer's job). A copy that says
 * "We draft each answer carefully" would NOT match because "Draft "
 * needs to be at the start of a phrase ("draft answer", not "we draft
 * each").
 */
export const PLACEHOLDER_PATTERNS: ReadonlyArray<{
  readonly id: string;
  readonly pattern: RegExp;
  readonly description: string;
}> = [
  {
    id: "draft_answer",
    pattern: /\bdraft\s+answer\b/i,
    description: "literal 'Draft answer' phrase",
  },
  {
    id: "tbd",
    // \bTBD\b — match standalone "TBD" or "TBD." or "(TBD)". Avoid
    // matching tokens like "TBDC" or "ATBD" via the word-boundary.
    pattern: /\bTBD\b/i,
    description: "literal 'TBD' marker",
  },
  {
    id: "operator_rewrite",
    // Catches "(operator: rewrite)", "operator: rewrite", "Operator: Rewrite".
    pattern: /\boperator\s*:\s*rewrite\b/i,
    description: "literal 'operator: rewrite' instruction",
  },
  {
    id: "operator_parenthetical",
    // Any (operator: …) parenthetical — covers "(operator: fill in)",
    // "(operator: add details)", etc. Scoped to a single line so a
    // legitimate sentence containing "operator" doesn't fire.
    pattern: /\(\s*operator\s*:[^)\n]*\)/i,
    description: "(operator: ...) parenthetical",
  },
  {
    id: "rewrite_below",
    pattern: /\brewrite\s+below\b/i,
    description: "literal 'rewrite below' instruction",
  },
  {
    id: "insert_bracket",
    // [insert ...] — a [insert anything] bracket is always a generator
    // placeholder. Anchored on `\[insert` to avoid matching the verb
    // "insert" used naturally ("insert the screws").
    pattern: /\[\s*insert\b[^\]]*\]/i,
    description: "[insert ...] template placeholder",
  },
  {
    id: "placeholder_word",
    // Literal "placeholder" anywhere — generators or LLMs occasionally
    // emit this. False positives are rare (no normal product copy
    // uses the word; technical articles about placeholders themselves
    // would, but those aren't in this domain).
    pattern: /\bplaceholder\b/i,
    description: "literal 'placeholder' word",
  },
  {
    id: "todo_marker",
    // TODO + colon = template marker. "TODO" alone (e.g., a checklist
    // header) wouldn't, so we require the colon.
    pattern: /\bTODO\s*:/i,
    description: "literal 'TODO:' template marker",
  },
];

/**
 * Returns the matched pattern's id when the text reads like a
 * generator placeholder, otherwise null. Whitespace-tolerant.
 *
 * Returns null for empty / non-string inputs (fail-safe — callers
 * shouldn't blow up just because a packet field was null).
 */
export function detectPlaceholder(text: string | null | undefined): {
  readonly matched: true;
  readonly patternId: string;
  readonly description: string;
} | {
  readonly matched: false;
} {
  if (typeof text !== "string" || text.length === 0) {
    return { matched: false };
  }
  for (const entry of PLACEHOLDER_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        matched: true,
        patternId: entry.id,
        description: entry.description,
      };
    }
  }
  return { matched: false };
}

/** Boolean convenience wrapper around detectPlaceholder. */
export function looksLikePlaceholder(text: string | null | undefined): boolean {
  return detectPlaceholder(text).matched;
}

// ---------------------------------------------------------------------------
// FAQ structural quality
// ---------------------------------------------------------------------------

/**
 * Word-count floor for FAQ answer bodies. Below this, the answer is
 * too short to carry business-specific, service-specific, city-
 * specific, or evidence-specific detail.
 *
 * 25 words is the operator-locked threshold (W3 Step 3.1, 2026-05-01).
 * Tuned to roughly 2 short sentences — enough to require at least one
 * concrete claim beyond a definitional restate of the question.
 */
export const MIN_FAQ_ANSWER_WORDS = 25;

/**
 * Question-overlap ratio above which the answer counts as "mostly
 * repeats the question." 0.8 = 80% of the answer's distinct content
 * tokens are also in the question. Anything ≥ 0.8 is structurally
 * a definitional restate.
 */
export const MAX_QUESTION_OVERLAP = 0.8;

/**
 * Minimum count of distinct, non-question, non-generic-filler content
 * words an FAQ answer must contain. Below this, the answer doesn't
 * carry enough specific content to be useful.
 */
export const MIN_SPECIFIC_CONTENT_WORDS = 5;

/**
 * Stopwords stripped before token comparison. Standard English
 * function words. Intentionally narrow — the structural test catches
 * the "mostly question" pattern via overlap, not via stopword removal,
 * so a generous stopword list would over-trigger.
 */
const STOPWORDS = new Set<string>([
  "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
  "of", "with", "by", "from", "as", "is", "was", "are", "were", "be",
  "been", "being", "have", "has", "had", "do", "does", "did", "will",
  "would", "could", "should", "may", "might", "can", "i", "you", "he",
  "she", "it", "we", "they", "them", "us", "our", "their", "your",
  "my", "his", "her", "its", "what", "when", "where", "why", "how",
  "this", "that", "these", "those", "there", "here", "if", "then",
  "than", "so", "such", "no", "not", "yes", "any", "some", "all",
  "each", "every", "both", "either", "neither", "much", "many", "few",
  "more", "most", "other", "another", "same", "different",
  "about", "into", "onto", "upon", "across", "through", "during",
  "before", "after", "above", "below", "between", "under", "over",
]);

/**
 * Generic-filler content words. These are content-class (not
 * stopwords) but carry no business-specific meaning. An FAQ answer
 * whose ONLY non-question content words come from this set is a
 * definitional restate ("Learn about X and how to choose the right
 * one").
 *
 * Operator-locked closed set. NOT extensible at runtime — narrow on
 * purpose to avoid false positives. Real product copy ("we install
 * solar panels") wouldn't intersect this set; generic AI fluff
 * ("learn more about how to find the right one") would.
 */
const GENERIC_FILLER_WORDS = new Set<string>([
  "learn", "find", "get", "know", "understand", "discover", "see",
  "view", "read", "explore", "check", "guide", "guides", "tip", "tips",
  "way", "ways", "thing", "things", "topic", "topics", "subject",
  "content", "context", "anything", "everything", "something",
  "important", "key", "main", "best", "great", "perfect", "good",
  "well", "right", "wrong", "one", "ones", "type", "types", "kind",
  "kinds", "info", "information", "details", "detail", "process",
  "options", "option", "choice", "choices", "decision", "decisions",
  "make", "take", "doing", "done", "use", "using", "used", "need",
  "needs", "needed", "want", "wants", "wanted", "looking", "look",
  "help", "helps", "helping", "helpful",
]);

/** Verdict shape — discriminated union so callers can branch on reason. */
export type FaqAnswerVerdict =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason:
        | "too_short"
        | "repeats_question"
        | "no_specific_content"
        | "placeholder_phrase";
      readonly detail: string;
    };

/**
 * Tokenize for content-word comparison. Lowercase, strip punctuation,
 * drop short tokens (< 2 chars) and stopwords. Returns the kept
 * tokens in source order; deduplication is the caller's job (we
 * usually want a Set on the receiving side).
 *
 * Pure. Stable across runs. Exported so tests + callers can verify
 * tokenization choices without re-implementing them.
 */
export function tokenizeContentWords(text: string): string[] {
  if (typeof text !== "string" || text.length === 0) return [];
  return text
    .toLowerCase()
    // Replace any non-alphanumeric with whitespace.
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/**
 * Count words in a text using the simplest possible rule:
 * non-empty whitespace-delimited tokens. Punctuation counts as part
 * of its adjacent word (so "hello, world" = 2 words).
 */
function wordCount(text: string): number {
  if (typeof text !== "string") return 0;
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).filter((t) => t.length > 0).length;
}

/**
 * Evaluate whether an FAQ answer carries enough specific content to
 * be useful. Returns ok=true when:
 *   - answer has ≥ MIN_FAQ_ANSWER_WORDS words AND
 *   - answer doesn't match a placeholder phrase AND
 *   - answer's content-word overlap with question is < MAX_QUESTION_OVERLAP AND
 *   - answer has ≥ MIN_SPECIFIC_CONTENT_WORDS distinct non-question,
 *     non-generic-filler content words
 *
 * Otherwise returns ok=false with a discriminated reason.
 *
 * Pure. Deterministic. Safe on null/empty inputs (returns
 * `too_short`).
 */
export function evaluateFaqAnswer(input: {
  readonly question: string | null | undefined;
  readonly answer: string | null | undefined;
}): FaqAnswerVerdict {
  const answer =
    typeof input.answer === "string" ? input.answer.trim() : "";
  const question =
    typeof input.question === "string" ? input.question.trim() : "";

  // 1. Phrase placeholder fires first — short-circuits before we
  // bother with structural rules.
  const placeholderHit = detectPlaceholder(answer);
  if (placeholderHit.matched) {
    return {
      ok: false,
      reason: "placeholder_phrase",
      detail: `answer matches ${placeholderHit.description} (id=${placeholderHit.patternId})`,
    };
  }

  // 2. Word-count floor.
  const wc = wordCount(answer);
  if (wc < MIN_FAQ_ANSWER_WORDS) {
    return {
      ok: false,
      reason: "too_short",
      detail: `answer has ${wc} words; minimum is ${MIN_FAQ_ANSWER_WORDS}`,
    };
  }

  // 3. Question-overlap. Sets are deduped so we measure DISTINCT
  // content-word overlap, not raw token count.
  const qTokens = new Set(tokenizeContentWords(question));
  const aTokens = new Set(tokenizeContentWords(answer));
  if (aTokens.size > 0) {
    let overlap = 0;
    for (const t of aTokens) {
      if (qTokens.has(t)) overlap += 1;
    }
    const ratio = overlap / aTokens.size;
    if (ratio >= MAX_QUESTION_OVERLAP) {
      return {
        ok: false,
        reason: "repeats_question",
        detail: `answer's distinct content words are ${(ratio * 100).toFixed(0)}% from the question (threshold ${(MAX_QUESTION_OVERLAP * 100).toFixed(0)}%)`,
      };
    }
  }

  // 4. Specific-content-word count. Anything in the question OR in the
  // generic-filler closed set is excluded from the count.
  let specificCount = 0;
  for (const t of aTokens) {
    if (qTokens.has(t)) continue;
    if (GENERIC_FILLER_WORDS.has(t)) continue;
    specificCount += 1;
  }
  if (specificCount < MIN_SPECIFIC_CONTENT_WORDS) {
    return {
      ok: false,
      reason: "no_specific_content",
      detail: `answer has ${specificCount} specific content words (excluding question + filler); minimum is ${MIN_SPECIFIC_CONTENT_WORDS}`,
    };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// FAQ proposed_text parsing
// ---------------------------------------------------------------------------

/**
 * Parse a deterministic-generator FAQ proposed_text block into Q + A
 * halves. The generator emits "Q: <question>\n\nA: <answer>". Returns
 * null when the input doesn't match that shape (the caller should
 * skip the structural test in that case — the validator's other rules
 * still apply).
 *
 * Pure.
 */
export function parseFaqProposedText(text: string | null | undefined): {
  readonly question: string;
  readonly answer: string;
} | null {
  if (typeof text !== "string" || text.length === 0) return null;
  // Find a leading "Q:" marker and a separator-then-"A:" marker. Be
  // lenient about whitespace around the colons.
  const qMatch = text.match(/^Q\s*:\s*([\s\S]*?)\n\s*A\s*:\s*([\s\S]+)$/);
  if (!qMatch) return null;
  return {
    question: qMatch[1].trim(),
    answer: qMatch[2].trim(),
  };
}
