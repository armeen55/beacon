/**
 * Author / reviewer Person byline detector (BEACON 500 P10 v1 243/263,
 * 2026-07-03).
 *
 * THE GAP: a guide-shaped content page (an article / guide / how-to whose trust
 * hinges on who wrote it) has NO named author, no Person schema and no visible
 * "By <Name>" byline. Google's own quality guidance and every AI answer engine
 * lean on who wrote a page when deciding whether to trust and cite it. Adding a
 * real author byline plus Person schema is the single highest-leverage E-E-A-T
 * fix for a content site.
 *
 * PURE. No I/O, no LLM, no tenant hardcoding. The loader pre-computes each
 * page's `hasAuthorSignal` (Person schema OR a visible byline in the sampled
 * body) and `isGuideShaped`; this module applies the honest gap rule + ranking.
 *
 * EMPTY when authors are already present: a page carrying Person schema or a
 * visible byline never emits, so a site that already credits its writers gets a
 * clean, empty result (self-hiding).
 */

import type { AuthorGap, AuthorPageInput } from "./eeat-types";

/** How many author-byline cards surface in one run (highest-signal first). */
export const MAX_AUTHOR_PAGES = 8;

/**
 * A visible-byline signal in a page's own sampled body text. Deterministic
 * English grammar shape: a line starting "By <Name>", a "Written by <Name>" /
 * "Reviewed by <Name>" / "Author: <Name>" phrasing, where <Name> looks like a
 * proper noun (a capitalized word). This is a shape test, not a name list, so it
 * is tenant- and vertical-neutral. Exported for direct unit testing and for the
 * loader to compute `hasAuthorSignal` from the body sample.
 */
// The "by"/"author" keywords accept either case ([Bb]/[Aa]/[Rr]/[Ww]/[Ee]) but
// the NAME that follows MUST stay a capitalized proper noun ([A-Z], no `i`
// flag), which is what excludes generic prepositions ("made by hand", "step by
// step") from matching.
const BYLINE_PATTERNS: RegExp[] = [
  /\b[Bb]y\s+[A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,3}\b/,
  /\b(?:[Ww]ritten|[Rr]eviewed|[Aa]uthored|[Ee]dited)\s+by\s+[A-Z][a-zA-Z'.-]+/,
  /\b[Aa]uthor\s*:\s*[A-Z][a-zA-Z'.-]+/,
  /\b[Rr]eviewed\s*by\s*:\s*[A-Z][a-zA-Z'.-]+/,
];

/**
 * True when the text carries a visible author byline. Pure over a plain string
 * (the loader passes the page's sampled body text). A short guard rejects
 * generic "by" prepositions that are not bylines by requiring a proper-noun
 * name to follow, and by ignoring the extremely common "made by hand" /
 * "step by step" style phrases (the name-shape requirement already excludes
 * those, but the length floor keeps a stray single-capital token from matching).
 */
export function hasVisibleByline(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (t.length < 5) return false;
  return BYLINE_PATTERNS.some((re) => re.test(t));
}

/** True when the page's schema carries a Person node (author signal). */
export function schemaHasPerson(schemaTypes: ReadonlyArray<string>): boolean {
  return schemaTypes.some((t) => t.trim().toLowerCase() === "person");
}

/**
 * Classify each pre-assembled page into an AuthorGap when it is guide-shaped,
 * confidently extracted, and carries NO named-author signal. Ranked so the
 * loader can apply demand ordering upstream (this module preserves input order
 * then caps). Empty in -> empty out; a page WITH an author signal never emits.
 */
export function classifyAuthorGaps(
  pages: ReadonlyArray<AuthorPageInput>,
): AuthorGap[] {
  const gaps: AuthorGap[] = [];
  for (const page of pages) {
    if (!page.extractionCertain) continue;
    if (!page.isGuideShaped) continue;
    if (page.hasAuthorSignal) continue;
    gaps.push({ url: page.url, fetchedAt: page.fetchedAt });
  }
  return gaps.slice(0, MAX_AUTHOR_PAGES);
}
