/**
 * pattern-classifier (2026-07-02, master plan item 26) - PURE sentence-level
 * classification into the quotable-pattern buckets AI engines favor when
 * citing a source. No I/O, no LLM, no "server-only": both the mining pass
 * (mine-answer-patterns.ts, which reads real answer text from Supabase) and
 * the deterministic page rubric (citability-score.ts, which scores a page's
 * own text) import from here, so they can never classify the same sentence
 * two different ways.
 *
 * Buckets, distilled from how AI answers actually cite sources:
 *   stat_first        - the sentence opens with a number ("Over 60 percent of...").
 *   definition        - the sentence opens with a plain named definition ("X is a...").
 *   attributed_claim  - the claim is attributed to a named source ("According to X...").
 *   list_lead         - the sentence opens a numbered or bulleted list.
 *   date_anchored     - the sentence anchors its fact to a specific date/year.
 *   other             - none of the above (the honest default, never forced).
 */

export type CitationPatternBucket =
  | "stat_first"
  | "definition"
  | "attributed_claim"
  | "list_lead"
  | "date_anchored"
  | "other";

export const ALL_PATTERN_BUCKETS: readonly CitationPatternBucket[] = [
  "stat_first",
  "definition",
  "attributed_claim",
  "list_lead",
  "date_anchored",
  "other",
];

// Regexes are deliberately conservative (favor false negatives over false
// positives): a sentence only earns a bucket when it clearly matches, so the
// "other" bucket absorbs ambiguous prose rather than the classifier guessing.

/** "Over 60 percent of...", "3 million...", "$4.99 a month", "1 in 4 ...". */
const STAT_FIRST_RE =
  /^\s*(?:(?:over|more than|nearly|about|approximately|roughly|almost|at least)\s+)?(?:\$\s?\d[\d,.]*|\d[\d,.]*\s?(?:percent|%|million|billion|thousand)|\d+\s*(?:in|out of)\s*\d+)\b/i;

/** "X is a...", "X refers to...", "X means...", "X is the...". Excludes generic
 *  pronoun subjects (It, This, That, There, He, She, They) so "It is a special
 *  time" never reads as a named definition - only a real subject term does. */
const DEFINITION_RE =
  /^\s*(?!(?:it|this|that|there|these|those|he|she|they|we|i|you)\s)[A-Z][\w'’.-]*(?:\s+[\w'’.-]+){0,6}\s+(?:is|are|was|were|refers to|means)\s+(?:a|an|the|one|used|known|considered)\b/i;

/** "According to X, ..." / "per X, ..." leading the sentence. */
const ATTRIBUTED_CLAIM_LEAD_RE = /^\s*(?:according to|per|as reported by|as stated by|as noted by)\s+[\w]/i;

/** "X reports that...", "X says...", "X found that..." (named subject +
 *  reporting verb, anywhere in the sentence - these often follow a short
 *  lead-in clause rather than opening the sentence). */
const ATTRIBUTED_CLAIM_VERB_RE =
  /\b[A-Z][\w&.'-]*(?:\s+[A-Z][\w&.'-]*){0,3}\s+(?:reports?|states?|says?|notes?|confirms?|found)\s+that\b/;

/** Numbered/bulleted list lead-ins: "1. ...", "1) ...", "- ...", "Here are the top 5...",
 *  "The top 7 items...". */
const LIST_LEAD_RE = /^\s*(?:\d+[.)]\s+\S|[-*•]\s+\S|(?:here (?:are|is)\s+)?(?:the\s+)?(?:top|best)\s+\d+\b)/i;

/** A specific date/year anchoring the fact: "In 2024, ...", "As of March 2026, ...", "Since 1999...". */
const DATE_ANCHORED_RE = /^\s*(?:in|as of|since|by|during)\s+(?:\d{4}|(?:january|february|march|april|may|june|july|august|september|october|november|december)\b)/i;

/**
 * Classify one sentence into a single quotable-pattern bucket. Pure, order
 * matters (checked most-specific first): a sentence that opens with a
 * number-first stat wins stat_first even if it also happens to contain a
 * date later, because leading-token position is what an AI answer actually
 * lifts. Returns "other" when nothing matches (the honest default, never
 * forced into a bucket).
 */
export function classifySentence(sentence: string): CitationPatternBucket {
  const s = (sentence ?? "").trim();
  if (!s) return "other";
  if (STAT_FIRST_RE.test(s)) return "stat_first";
  if (LIST_LEAD_RE.test(s)) return "list_lead";
  if (DATE_ANCHORED_RE.test(s)) return "date_anchored";
  if (ATTRIBUTED_CLAIM_LEAD_RE.test(s) || ATTRIBUTED_CLAIM_VERB_RE.test(s)) return "attributed_claim";
  if (DEFINITION_RE.test(s)) return "definition";
  return "other";
}

/** Conservative sentence splitter shared by the miner and the rubric, so
 *  mining and scoring always agree on what counts as one sentence. Pure. */
export function splitIntoSentences(text: string): string[] {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'“])/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 8);
}

/**
 * Find the sentence CONTAINING a citation marker, or failing that a sentence
 * with a bracketed citation index (the common "here is the fact [1]" shape),
 * for each of the given citation URLs/domains inside one answer text. Pure.
 * Returns one classified sentence per citation found (a citation with no
 * locatable sentence is skipped, never guessed).
 */
export function findCitedSentences(
  answerText: string,
  citations: Array<{ url: string; domain: string }>,
): Array<{ domain: string; sentence: string; bucket: CitationPatternBucket }> {
  const sentences = splitIntoSentences(answerText);
  if (sentences.length === 0 || citations.length === 0) return [];
  const out: Array<{ domain: string; sentence: string; bucket: CitationPatternBucket }> = [];
  const lower = sentences.map((s) => s.toLowerCase());

  for (const c of citations) {
    const domain = (c.domain ?? "").trim().toLowerCase().replace(/^www\./, "");
    if (!domain) continue;
    // 1) A sentence that literally mentions the domain (inline-cited answers).
    let idx = lower.findIndex((s) => s.includes(domain));
    // 2) Otherwise, a bracketed numeric citation marker [N] - use the FIRST
    //    such marker as a stand-in for "the sentence being cited", since raw
    //    answer text rarely lines up marker index to citation array index
    //    reliably across engines.
    if (idx < 0) {
      idx = lower.findIndex((s) => /\[\d+\]/.test(s));
    }
    if (idx < 0) continue; // no locatable sentence for this citation - skip, never guess
    const sentence = sentences[idx]!;
    out.push({ domain, sentence, bucket: classifySentence(sentence) });
  }
  return out;
}
