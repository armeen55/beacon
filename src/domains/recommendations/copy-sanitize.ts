/**
 * Operator-facing copy sanitizer — Phase v7 stabilization (2026-04-24).
 *
 * Internal taxonomy tokens (e.g. "Shield: ") sometimes leak from
 * topic_id / location_scope strings into cluster labels and candidate
 * titles. Those strings are storage detail, not product copy. This
 * module strips known prefixes so operator-facing surfaces never show
 * them.
 *
 * Pure. Deterministic. All transformations must be safe against common
 * edge cases (empty strings, already-clean strings, multiple prefixes).
 */

/** Internal taxonomy prefixes we want to strip from operator-facing strings.
 *  Add future prefixes here as they surface. Case-insensitive matching.
 *  Each entry is matched at the START of the string with optional trailing
 *  whitespace, colon, or hyphen. */
const INTERNAL_PREFIXES: ReadonlyArray<string> = [
  "shield:",
  "shield -",
  "internal:",
  "priv:",
  "tbd:",
];

export function sanitizeOperatorCopy(input: string | null | undefined): string {
  if (!input) return "";
  let s = input.trim();
  // Strip any recognized internal prefix at the start (possibly repeated).
  let changed = true;
  let safety = 0;
  while (changed && safety < 4) {
    changed = false;
    safety += 1;
    const lower = s.toLowerCase();
    for (const prefix of INTERNAL_PREFIXES) {
      if (lower.startsWith(prefix)) {
        s = s.slice(prefix.length).trimStart();
        changed = true;
        break;
      }
    }
  }
  return s;
}

/** Convenience for sanitizing cluster labels specifically. */
export function sanitizeClusterLabel(
  label: string | null | undefined,
): string | null {
  if (!label) return null;
  const cleaned = sanitizeOperatorCopy(label);
  return cleaned.length > 0 ? cleaned : null;
}
