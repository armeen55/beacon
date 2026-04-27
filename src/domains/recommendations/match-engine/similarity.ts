/**
 * Recommendation Lifecycle OS — Phase 2 (2026-04-27).
 *
 * Text similarity scoring locked in
 * `docs/RECOMMENDATION_LIFECYCLE_OS_SPEC.md` §3.5.
 *
 *   similarity(a, b) = max(jaccard_tokens, 1 - levenshtein/maxLen)
 *
 * Both inputs must already be `normalizeText(_, { lowercase: true })`.
 * The scorer itself does NOT normalize — keeping it pure makes the
 * cost predictable (matchers normalize once, score N times).
 *
 * No embedding-based similarity in v1 (deferred to Phase 10 if MEDIUM
 * matches exceed 20% of accepted edits per spec §7).
 */

/**
 * Tokenize on any non-letter/non-digit boundary (Unicode-aware).
 * Empty strings yield `[]`. Used by Jaccard.
 */
export function tokenize(s: string): string[] {
  if (s.length === 0) return [];
  return s.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Set-based Jaccard similarity over tokens. [0,1].
 *   jaccard(A, B) = |A ∩ B| / |A ∪ B|
 *
 * Two empty token lists return 1 (vacuously identical) — this matches
 * how the hybrid `similarity()` treats empty strings via Levenshtein
 * (also returns 1 when both sides are empty).
 */
export function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const t of setA) if (setB.has(t)) intersection += 1;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Standard Levenshtein edit distance with two-row DP. Allocates
 * O(min(|a|,|b|)) memory; runs in O(|a|·|b|) time.
 */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  // Make `b` the shorter dimension to bound DP memory.
  if (a.length < b.length) {
    const tmp = a;
    a = b;
    b = tmp;
  }

  const m = a.length;
  const n = b.length;
  let prev = new Array<number>(n + 1);
  let curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    const ai = a.charCodeAt(i - 1);
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
      const del = curr[j - 1]! + 1;
      const ins = prev[j]! + 1;
      const sub = prev[j - 1]! + cost;
      curr[j] = del < ins ? (del < sub ? del : sub) : ins < sub ? ins : sub;
    }
    const swap = prev;
    prev = curr;
    curr = swap;
  }

  return prev[n]!;
}

/**
 * Hybrid similarity. Both inputs SHOULD already be normalized (lowercase
 * folded) before calling this; it does not re-normalize.
 *
 * Returns max(jaccard, 1 - lev/maxLen). Picks the higher signal: short
 * strings dominated by Levenshtein (token sets too sparse), long strings
 * dominated by Jaccard (typo distance too large to be useful).
 *
 * Two empty strings return 1 (consistent with `levenshtein`).
 */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  const j = jaccard(tokenize(a), tokenize(b));
  const lev = 1 - levenshtein(a, b) / maxLen;
  return Math.max(j, lev);
}
