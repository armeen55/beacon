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

// ---------------------------------------------------------------------------
// M2 — UUID evidence sanitizer (operator audit follow-up, 2026-05-05)
// ---------------------------------------------------------------------------
//
// LLM-generated `why` text + some operator-hand-edited fields cite raw
// prompt UUIDs ("prompt 7ee3216b-...") in operator-visible copy. The
// audit found 11 leaks across the production rec queue (8 in active
// rows). The fix: strip UUID-shaped tokens from operator-facing strings
// at render time, replacing each with either a quoted prompt-text
// snippet (when we have the mapping) or a generic "prompt evidence"
// (when we don't). Internal IDs continue to live on `evidence: [{type:
// "prompt", promptId: ...}]` and on debug-only `data-rec-*` attributes
// — nothing changes about the underlying schema; only the human-
// rendered text loses the UUIDs.

/**
 * Match a Schema-v4 (RFC 4122) UUID. Operator-locked: 8-4-4-4-12 hex
 * with hyphens, case-insensitive. Optionally followed by a "..."
 * truncation tail (e.g., `7ee3216b-327c-4de9-...`) which the LLM
 * sometimes emits — both forms are matched.
 */
const UUID_PATTERN_GLOBAL =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.\.\.)?\b/gi;
const UUID_PATTERN_SINGLE =
  /\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\.\.\.)?\b/i;

/**
 * Test whether a string contains at least one UUID-shaped substring.
 * Useful for invariant tests that pin "no UUIDs in operator-visible
 * copy" without re-implementing the regex.
 */
export function containsUuid(text: string | null | undefined): boolean {
  if (!text) return false;
  return UUID_PATTERN_SINGLE.test(text);
}

/**
 * Truncate a prompt text to a snippet suitable for inline display.
 * Operator-locked at 50 chars + ellipsis to mirror the snippet
 * convention used in recommendations-client.tsx evidence-row rendering.
 */
function snippetForPrompt(promptText: string, max = 50): string {
  const trimmed = promptText.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trim()}…`;
}

/**
 * The prompt-text lookup the sanitizer accepts. Production call sites
 * already pass a `Record<string, string>` (server components stamp it
 * onto props), but tests + future call sites may use a `Map`. Both
 * shapes resolve through the same lookup helper below.
 */
export type PromptTextLookup =
  | ReadonlyMap<string, string>
  | Readonly<Record<string, string>>;

function lookupPromptText(
  source: PromptTextLookup | undefined,
  uuid: string,
): string | undefined {
  if (!source) return undefined;
  if (source instanceof Map) {
    return source.get(uuid.toLowerCase()) ?? source.get(uuid);
  }
  const rec = source as Readonly<Record<string, string>>;
  return rec[uuid.toLowerCase()] ?? rec[uuid];
}

/**
 * Strip prompt UUIDs from operator-visible copy and replace each with
 * a quoted snippet of the prompt text when the mapping is available,
 * or with a generic "prompt evidence" fallback when the UUID maps to
 * an unknown prompt (e.g., a deleted prompt or a hand-typed UUID with
 * no prompt-row counterpart).
 *
 * Preserves all surrounding text. Idempotent — running twice is a
 * no-op once the UUIDs are gone.
 *
 * Caller contract:
 *   • Pass `promptTextById` containing every prompt the operator might
 *     reasonably reference; missing entries fall back to the unknown-
 *     UUID treatment.
 *   • Use this on operator-VISIBLE copy only. Internal evidence arrays,
 *     debug attributes, and cost-ledger lines should keep raw IDs.
 *
 * Pure. Deterministic. Safe on null / empty / non-string inputs (returns
 * the input unchanged).
 */
export function sanitizeOperatorEvidenceText(
  text: string | null | undefined,
  promptTextById: PromptTextLookup | undefined,
): string | null | undefined {
  if (typeof text !== "string" || text.length === 0) return text;
  if (!UUID_PATTERN_SINGLE.test(text)) return text;
  // Use a fresh regex instance because /g state persists on the literal
  // when used with .test() / .exec() — a subtle source of bugs.
  return text.replace(
    new RegExp(UUID_PATTERN_GLOBAL.source, "gi"),
    (_match, uuid: string) => {
      const lookup = lookupPromptText(promptTextById, uuid);
      if (typeof lookup === "string" && lookup.trim().length > 0) {
        return `prompt: "${snippetForPrompt(lookup)}"`;
      }
      // Unknown UUID — replace with neutral fallback. Avoid emitting
      // the raw ID; if a future operator wants the ID for debugging,
      // they can read the underlying evidence array.
      return "prompt evidence";
    },
  );
}

/**
 * Apply `sanitizeOperatorEvidenceText` to a set of named string fields
 * on an object. Returns a new object with the same shape; non-string
 * fields and missing fields are left as-is.
 *
 * Convenience wrapper used by the rec-queue render layer to sanitize
 * the operator-facing copy fields ({why, expectedImpact, measurementPlan,
 * displayLabel}) in one call.
 */
export function sanitizeOperatorCopyFields<
  T extends Record<string, unknown>,
  K extends keyof T & string,
>(
  obj: T,
  fields: ReadonlyArray<K>,
  promptTextById: PromptTextLookup | undefined,
): T {
  let dirty = false;
  const out: Record<string, unknown> = { ...obj };
  for (const k of fields) {
    const before = obj[k];
    if (typeof before !== "string") continue;
    const after = sanitizeOperatorEvidenceText(before, promptTextById);
    if (after !== before) {
      out[k] = after;
      dirty = true;
    }
  }
  return (dirty ? out : obj) as T;
}
