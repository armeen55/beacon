/**
 * keyword-refresh-candidates (2026-06-28) — turn New-Page candidates (label + AI
 * prompt) into a small, deduped set of SHORT keyword queries worth pricing on
 * DataForSEO, so a bounded refresh grows the cache with terms that actually map back
 * to the board (the matcher is good; the cache was the bottleneck).
 *
 * Conservative by construction (the operator's hard rules):
 *  - SUPPRESS generic/junk topics with no distinguishing token ("Gifts", "List
 *    Iranians", "Things Iran Highlights") — we don't rewrite them, so we drop them.
 *  - PRESERVE specificity (persian wedding, nowruz activities kids, iranian culture
 *    etiquette, culture of iran, iran natural attractions, iranian diaspora).
 *  - Never query a raw long QUESTION prompt — only a short topic phrase (≤ MAX_WORDS,
 *    not interrogative). Dedupe normalized queries.
 * PURE / deterministic / no I/O. Pinned by keyword-refresh-candidates.test.ts.
 */

import { topicDistinguishingTokens } from "./keyword-match";

export type RefreshCandidate = { label: string; prompt?: string | null };

const MAX_WORDS = 6;
const QUESTION_LEADERS = new Set([
  "what", "how", "why", "when", "where", "who", "which", "is", "are", "do", "does",
  "can", "should", "will", "did", "was", "were",
]);

/** Lowercase, drop punctuation, collapse space, cap length to a sensible head phrase. */
function clean(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean)
    .slice(0, MAX_WORDS)
    .join(" ");
}

function isQuestion(q: string): boolean {
  return QUESTION_LEADERS.has(q.split(" ")[0] ?? "");
}

/** First-person / conversational pronouns mark a SENTENCE fragment, never a keyword
 *  ("i was invited to a persian wedding", "i want to celebrate my heritage"). */
const PRONOUNS = new Set(["i", "my", "me", "we", "our", "us", "your", "you", "their"]);

/** A query is worth pricing when it's a short phrase that carries ≥1 distinguishing
 *  (non-generic/filler/commerce) token and isn't a conversational sentence fragment. */
function isUsableQuery(q: string): boolean {
  if (q.length < 3) return false;
  const words = q.split(" ");
  if (words.some((w) => PRONOUNS.has(w))) return false; // sentence fragment, not a keyword
  return topicDistinguishingTokens(q).length > 0;
}

/**
 * Build the deduped keyword-query set from New-Page candidates. For each: the cleaned
 * LABEL (always considered) + the PROMPT only when it's already a short, non-question
 * topic. Generic-only labels/prompts are dropped. PURE.
 */
export function buildRefreshQueries(candidates: readonly RefreshCandidate[]): string[] {
  const out = new Set<string>();
  for (const c of candidates) {
    const label = clean(c.label ?? "");
    if (isUsableQuery(label)) out.add(label);

    const prompt = clean(c.prompt ?? "");
    // Only a short, non-interrogative prompt becomes a query (never a raw question).
    if (prompt && prompt !== label && !isQuestion(prompt) && prompt.split(" ").length <= MAX_WORDS && isUsableQuery(prompt)) {
      out.add(prompt);
    }
  }
  return [...out];
}
