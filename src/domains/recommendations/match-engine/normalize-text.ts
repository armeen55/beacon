/**
 * Recommendation Lifecycle OS — Phase 2 (2026-04-27).
 *
 * Canonical text normalizer locked in
 * `docs/RECOMMENDATION_LIFECYCLE_OS_SPEC.md` §3.3.
 *
 * Pure function. Idempotent — `normalizeText(normalizeText(x)) === normalizeText(x)`.
 * No I/O. No throws on any string input (including empty / whitespace-only).
 *
 * The normalizer addresses the canonical "CMS reformatted my copy"
 * failure modes: smart-quote substitution, NBSP injection, em-dash
 * conversion, trailing-period drift, leading/trailing whitespace.
 *
 * Two compare modes:
 *   - exact / structural: lowercase=false (preserves "Title Case")
 *   - similarity scoring: lowercase=true (case-insensitive distance)
 */

export type NormalizeTextOpts = {
  /** When true, downcases the result. Default: false. */
  lowercase?: boolean;
  /** When true, strips trailing `.!?` runs. Default: true. */
  stripTerminalPunctuation?: boolean;
};

/**
 * Canonical normalizer. The 7 steps run in this fixed order:
 *
 *   1. NFC unicode normalize (composed form)
 *   2. Smart quotes (curly single + curly double + low-9 + reversed-9) → straight
 *   3. Em / en / figure / minus dashes → ASCII hyphen-minus
 *   4. NBSP and other unicode-space classes → regular space
 *   5. All whitespace runs (\n \t etc.) → single space
 *   6. Trim leading/trailing whitespace
 *   7. (opt) Strip terminal `.!?`. (opt) Lowercase.
 *
 * The order matters: e.g. NFC must precede smart-quote replacement
 * because NFC may compose precomposed quote forms differently than the
 * source bytes. Trim runs after whitespace-collapse so a string like
 * "  hello\u00A0\u00A0world  " becomes "hello world" not " hello world".
 */
export function normalizeText(
  input: string,
  opts: NormalizeTextOpts = {},
): string {
  let s = input.normalize("NFC");

  // 2. Smart quotes (single, double, low-9, reversed-9 variants).
  s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u201F]/g, '"');

  // 3. Em / en / figure / minus dashes → ASCII hyphen-minus.
  s = s.replace(/[\u2013\u2014\u2015\u2212]/g, "-");

  // 4. Unicode whitespace classes (NBSP, en-quad..hair, narrow-NBSP,
  //    medium-mathematical, ideographic) → regular space.
  s = s.replace(/[\u00A0\u2000-\u200A\u202F\u205F\u3000]/g, " ");

  // 5. Collapse all whitespace runs (incl. \t, \n, \r) to single space.
  s = s.replace(/\s+/g, " ");

  // 6. Trim.
  s = s.trim();

  // 7. Optional stripping + lowercasing.
  const stripTerm = opts.stripTerminalPunctuation !== false;
  if (stripTerm) {
    s = s.replace(/[.!?]+$/u, "");
  }
  if (opts.lowercase === true) {
    s = s.toLowerCase();
  }

  return s;
}

/**
 * Convenience: produce both the case-preserving and case-folded forms
 * in one call. Hot loops in matchers compute both per candidate; this
 * avoids re-running the 6 deterministic steps twice.
 */
export function normalizeTextBoth(input: string): {
  exact: string;
  folded: string;
} {
  const exact = normalizeText(input, { lowercase: false });
  const folded = exact.toLowerCase();
  return { exact, folded };
}

/**
 * Recommendation Lifecycle OS — Phase 2 add-on (2026-04-27).
 *
 * Returns the FIRST non-empty line of `text` (after trimming each line
 * individually). Used by the H2 matcher (`add_h2_section` /
 * `rewrite_h2` dispatch in `index.ts`) when the generator's
 * `proposed_text` shape concatenates a heading + body paragraph
 * separated by `\n` — only the heading is the H2 candidate; the body
 * is structural context the v1 element extractor doesn't yet handle
 * (paragraph extractor deferred per spec §3.2).
 *
 * Falls back to the whole input string when every line is blank
 * (defensive — never returns empty unless input was empty).
 *
 * Pure. No I/O. Idempotent — `extractFirstNonEmptyLine(extractFirstNonEmptyLine(x))
 * === extractFirstNonEmptyLine(x)`.
 */
export function extractFirstNonEmptyLine(text: string): string {
  if (text.length === 0) return text;
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return text;
}
