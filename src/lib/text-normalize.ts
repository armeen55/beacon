/**
 * Lightweight text normalization for matching concepts to page fields.
 *
 * Used by trust guardrails for literal insertion/positioning recommendations
 * (keyword_optimization recs that tell the operator to place a concept into a
 * specific H1 / H2 / title). Before such a rec is emitted, we check whether
 * the concept is *already* present in the target field — if it is, the rec
 * is redundant and must be suppressed.
 *
 * Design rules:
 *   - Lightweight only. Lowercase, strip punctuation, collapse whitespace,
 *     simple singular/plural fold for obvious variants (home/homes, cities/city).
 *   - No stemming library, no part-of-speech tagging, no synonyms.
 *   - Contiguous-subsequence match. "custom homes" matches "... custom home
 *     builder ..." (tokens `custom` and `home` appear in sequence). It does
 *     NOT match "... custom modern homes ..." (tokens are not contiguous).
 *   - Contiguous match is deliberately strict. The rule is: "would a reader
 *     see this concept in the heading?" — the phrase, not scattered words.
 */

/** Characters stripped from text before tokenizing. Quotes (ASCII + curly),
 *  common punctuation, hyphens/dashes, brackets, slashes. Ampersand kept as
 *  a letter so "custom & luxury" tokenizes as three tokens, not two. */
const PUNCT_REGEX =
  /['"\u2018\u2019\u201C\u201D\u2014\u2013,.?!;:()\[\]{}/\\\-]/g;

/** Lowercase → strip punctuation/quotes → collapse whitespace → trim. */
export function normalizeForMatch(s: string): string {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(PUNCT_REGEX, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Fold a single token to its canonical form. Cheap English singular/plural
 * handling — no stemming library. Only catches obvious variants.
 *
 *   cities   → city       (ies → y)
 *   homes    → home       (trailing s, length ≥ 4)
 *   builders → builder    (trailing s, length ≥ 4)
 *   bass     → bass       (ss preserved)
 *   in       → in         (length < 4)
 */
export function foldToken(token: string): string {
  if (!token) return "";
  // ies → y, e.g. "cities" → "city"
  if (token.length >= 5 && token.endsWith("ies")) {
    return token.slice(0, -3) + "y";
  }
  // trailing s, length ≥ 4, not ending in ss
  if (token.length >= 4 && token.endsWith("s") && !token.endsWith("ss")) {
    return token.slice(0, -1);
  }
  return token;
}

/** Normalize + tokenize + fold each token. Returns [] for empty input. */
export function tokenizeForMatch(s: string): string[] {
  const normalized = normalizeForMatch(s);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean).map(foldToken);
}

/**
 * True iff the concept's tokens appear as a contiguous subsequence in the
 * haystack's tokens (both normalized and folded).
 *
 * Empty concept → false (don't suppress on nothing).
 * Empty haystack → false (can't match nothing).
 */
export function containsConcept(haystack: string, concept: string): boolean {
  const conceptTokens = tokenizeForMatch(concept);
  if (conceptTokens.length === 0) return false;
  const haystackTokens = tokenizeForMatch(haystack);
  if (haystackTokens.length === 0) return false;
  if (conceptTokens.length > haystackTokens.length) return false;

  const last = haystackTokens.length - conceptTokens.length;
  outer: for (let i = 0; i <= last; i++) {
    for (let j = 0; j < conceptTokens.length; j++) {
      if (haystackTokens[i + j] !== conceptTokens[j]) continue outer;
    }
    return true;
  }
  return false;
}
