/**
 * HARD RULE (operator directive, 2026-06-20): Beacon must NEVER emit an em dash
 * (—, U+2014) or en dash (–, U+2013) — nor the figure dash / horizontal bar — in
 * ANY generated copy, anywhere, ever. Em dashes read as machine-written and break
 * the "human-quality SEO copy" promise. This is the single, centralized enforcer;
 * every copy chokepoint (Page Surgeon artifacts, recommendation display labels)
 * runs strings through it. Pure + deterministic.
 *
 * Replacement is punctuation-aware so the result still reads like a human wrote it:
 *   • a SPACED dash (clause separator, e.g. "ranked by population — Tehran") → comma
 *   • an UNSPACED dash (range/compound, e.g. "10–20", "A–B") → hyphen-minus
 */

const BANNED_DASHES = /[‒–—―]/; // figure, en, em, horizontal bar

/** True if the string contains any banned dash (use in tests / guards). */
export function hasBannedDash(input: string | null | undefined): boolean {
  return typeof input === "string" && BANNED_DASHES.test(input);
}

/** Strip every banned dash from a string, keeping it human-readable. Never throws. */
export function stripBannedDashes(input: string | null | undefined): string {
  if (!input) return "";
  let s = input;
  // Spaced dash acting as a clause separator → comma + single space.
  s = s.replace(/\s+[‒–—―]\s+/g, ", ");
  // Any remaining dash (ranges, compounds, edge spacing) → plain hyphen.
  s = s.replace(/[‒–—―]/g, "-");
  // Tidy artifacts the replacement can create: " ," / ",," / doubled spaces / ",.".
  s = s
    .replace(/\s+,/g, ",")
    .replace(/,\s*,/g, ",")
    .replace(/,\s*\./g, ".")
    .replace(/[ \t]{2,}/g, " ");
  return s;
}
