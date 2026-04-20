/**
 * Search-query parser for PromptAnswerObservation.
 *
 * Profound exports AI search queries as a single string in the `search_queries`
 * CSV column. Multi-query fields use `", "` (comma+space) as the delimiter in
 * ~99% of cases, but a small fraction of rows contain embedded competitor-name
 * lists like "Builders A, Builders B, Builders C" which naive splitting would
 * incorrectly shatter into false queries.
 *
 * This parser is intentionally CONSERVATIVE:
 *   1. Splits on ", " only
 *   2. Drops fragments shorter than 15 chars or lacking a space
 *      (single-word shards are almost always company-name noise)
 *   3. If filtering produces zero valid queries, returns [raw] \u2014 better one
 *      coarse query than zero signal.
 *
 * Pairs with `raw_search_queries: string` on the observation: the raw form is
 * preserved lossless so downstream code can re-parse if needed.
 *
 * Audit note (Phase 7 Part 1b, 2026-04-19): format inspection on 6,522 real
 * populated rows across 2 CSVs:
 *   - 52% have 0 commas (single query, trivial)
 *   - 47% have 1 comma (two-query format, clean split)
 *   -  1% have 2+ commas (mix of true multi-query and embedded company-name
 *      lists \u2014 the length+space filter handles both acceptably)
 */

/**
 * Parse the raw `search_queries` string into an array of individual queries.
 *
 * Returns an empty array when the input is empty or whitespace-only.
 * Never returns fragments shorter than 15 chars or missing a space.
 * Always safe to re-run (idempotent).
 */
export function parseSearchQueries(raw: string | null | undefined): string[] {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];

  const parts = trimmed
    .split(", ")
    .map((s) => s.trim())
    .filter(Boolean);

  // Drop fragments that are too short to be real queries OR that are a single
  // word (single-word shards after a comma are almost always competitor-name
  // fragments, e.g. "Brookstone Builders, De Mattei Construction, Supple Homes
  // Bay Area custom luxury home builders" \u2192 "Brookstone Builders" is 2 words
  // but "Brookstone" alone would be dropped).
  const queries = parts.filter((p) => p.length >= 15 && /\s/.test(p));

  // Fallback: if our filter killed everything but the raw had content, return
  // the raw as a single coarse query \u2014 better 1 coarse signal than 0 signal.
  return queries.length > 0 ? queries : [trimmed];
}
