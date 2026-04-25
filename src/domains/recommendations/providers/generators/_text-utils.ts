/**
 * Sprint 6A.1 Phase 9 (2026-04-24) — shared text helpers for the
 * deterministic generators. Pure functions only.
 *
 * Underscore-prefix filename signals "internal to ./generators" — not
 * intended for import outside this folder. Keeps the public surface
 * area of `providers/` small.
 */

const TITLE_CASE_LOWER = new Set([
  "a", "an", "and", "as", "at", "but", "by", "for", "in", "of", "on",
  "or", "the", "to", "vs", "via", "with",
]);

/**
 * Title-case a phrase. Lowercases known short connector words unless
 * they are the first or last word. Leaves digits + camelCase tokens
 * (rare in cluster labels) untouched.
 */
export function titleCase(input: string): string {
  const words = input.trim().split(/\s+/);
  return words
    .map((word, i) => {
      const lower = word.toLowerCase();
      if (i !== 0 && i !== words.length - 1 && TITLE_CASE_LOWER.has(lower)) {
        return lower;
      }
      // Capitalize first letter; keep rest as-is so existing acronyms
      // (HVAC, FAQ, DIY) survive.
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join(" ");
}

/**
 * Question-shape detector: text ends with `?` OR begins with a
 * common interrogative. Used by `add_faq` to decide which prompts
 * are FAQ-shaped.
 */
const INTERROGATIVES = new Set([
  "what", "how", "why", "who", "when", "where", "which", "can",
  "does", "do", "is", "are", "should", "will", "could", "would",
]);

export function isQuestionLike(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (trimmed.endsWith("?")) return true;
  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
  return firstWord ? INTERROGATIVES.has(firstWord) : false;
}

/**
 * Truncate a phrase for display labels. Keeps under `max` chars and
 * appends an ellipsis when cut.
 */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

/**
 * Sentence-case a text for FAQ-question proposals. If the text isn't
 * already a question, append `?`.
 */
export function asQuestion(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const sentence =
    trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
  return sentence.endsWith("?") ? sentence : `${sentence}?`;
}
