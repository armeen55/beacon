/**
 * opposite-qualifier-guard (2026-06-25) — PURE, tenant-agnostic.
 *
 * Two owned pages can both be cited by AI (or ranked in Google) for an
 * overlapping query yet serve DELIBERATELY OPPOSITE audiences — e.g.
 * "persian female names" vs "persian male names". The cannibalization
 * recommenders would see the citation/keyword overlap and propose folding one
 * into the other ("merge_or_dedupe"). That is destructive: it erases an
 * intentionally distinct page and tanks the opposite-intent audience.
 *
 * This guard detects antonym qualifier tokens across two URLs/slugs so the
 * recommenders can DIFFERENTIATE-IN-PLACE (strengthen each, add internal links
 * between them) instead of consolidating. Deterministic, no I/O, no tenant or
 * vertical hardcoding — the antonym pairs are generic audience qualifiers that
 * apply to any site (gender, age, family role, royalty title).
 *
 * Pinned by opposite-qualifier-guard.test.ts.
 */

/**
 * Antonym groups. If one page carries a token from one side of a pair and the
 * other page carries the matching token from the other side, the two pages
 * target opposite audiences and must NOT be consolidated.
 */
const ANTONYM_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["male", "female"],
  ["males", "females"],
  ["man", "woman"],
  ["men", "women"],
  // Slug possessives (apostrophe stripped by tokenization): "men's" → "mens".
  ["mens", "womens"],
  ["boy", "girl"],
  ["boys", "girls"],
  ["he", "she"],
  ["his", "her"],
  ["him", "her"],
  ["father", "mother"],
  ["dad", "mom"],
  ["son", "daughter"],
  ["sons", "daughters"],
  ["husband", "wife"],
  ["brother", "sister"],
  ["brothers", "sisters"],
  ["king", "queen"],
  ["prince", "princess"],
  ["groom", "bride"],
  ["uncle", "aunt"],
  ["nephew", "niece"],
  ["gentlemen", "ladies"],
];

/** Tokenize a URL / slug / label into a set of lowercase word tokens. */
function tokenize(s: string): Set<string> {
  return new Set(
    (s ?? "")
      .toLowerCase()
      .replace(/https?:\/\/[^/]+/g, "") // drop scheme + host
      .split(/[^a-z]+/) // split on any non-letter (slashes, dashes, digits)
      .filter(Boolean),
  );
}

/**
 * True when `a` and `b` carry OPPOSITE qualifier tokens (one has "male", the
 * other "female", etc.) — i.e. they target deliberately distinct audiences and
 * must NOT be consolidated. Symmetric; case-insensitive; works on URLs, slugs,
 * or labels.
 */
export function hasOppositeQualifiers(a: string, b: string): boolean {
  const ta = tokenize(a);
  const tb = tokenize(b);
  for (const [x, y] of ANTONYM_PAIRS) {
    if ((ta.has(x) && tb.has(y)) || (ta.has(y) && tb.has(x))) return true;
  }
  return false;
}
