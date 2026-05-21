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

// ---------------------------------------------------------------------------
// Slice 4.5.G-B.2 — write-time prevention for the same high-severity
// internal leakage patterns the B.1 render-guard catches at render time
// (2026-05-21).
// ---------------------------------------------------------------------------
//
// The 2026-05-21 production audit at /diagnostics/recommendation-safety-
// audit surfaced 19 B.1-blocked violations across active rows: 10
// canonical-UUID leaks, 5 internal-token leaks (`aiSearchSignal` et al.),
// 4 competitor-name leaks. B.1 caught these at render. B.2 closes the
// other half of the loop: prevent NEW leaks at row creation by scrubbing
// generated reasoning/evidence copy BEFORE Supabase persistence.
//
// Scope discipline (mirrors B.1):
//   • Handle: canonical UUIDs (already handled above), long 32+ hex/hash
//     strings, the 12 locked internal taxonomy tokens.
//   • Do NOT handle: unsupported_claim, architect_overclaim, "best",
//     architect-led, architect-designed — those defer to slice 4.5.G-B.4
//     pending the brand-assertion carve-out.
//   • Do NOT mutate historical rows. B.2 is forward-only.
//   • Do NOT replicate the B.1 competitor-name guard here — competitor
//     scrubbing already lives on a separate validator path
//     (`validateCompetitorPublicCopy`) and the existing sanitizer in this
//     module does not have access to the per-tenant `competitorNames`
//     list at the write-time call site.

/**
 * Long-hex / hash-like string (32+ contiguous hex chars), case-
 * insensitive, word-boundary anchored. Catches SHA-1 (40), SHA-256 (64),
 * MD5 (32), and similar opaque identifiers that B.1 blocks at render.
 * Runs AFTER the UUID replacement so canonical 8-4-4-4-12 forms are
 * already gone by the time this fires — avoids false matches on UUID
 * substrings.
 */
const LONG_HEX_HASH_PATTERN_GLOBAL = /\b[0-9a-f]{32,}\b/gi;

/**
 * Internal taxonomy tokens — locked to mirror the B.1 render-guard's
 * blocklist exactly. Each entry pairs a regex with a customer-safe
 * replacement string per the operator-locked replacement style.
 *
 * Order matters slightly: more-specific tokens (`source_rec_id`) come
 * BEFORE less-specific ones (`rec_id`) so the longer match wins. Each
 * regex uses `\b` where word chars allow it and explicit non-alphanumeric
 * lookarounds for hyphenated tokens (`customer-queue-ready`) and `Mode X`.
 *
 * Idempotency: replacements are designed so a second pass is a no-op
 * (e.g., `"search-intent signals"` does not contain `aiSearchSignal`).
 */
const INTERNAL_TOKEN_REPLACEMENTS: ReadonlyArray<[RegExp, string]> = [
  // ai/search signal tokens (replace with operator-approved neutral copy)
  [/\baiSearchSignal\b/g, "search-intent signals"],
  [/\bactualSearchQueries\b/g, "observed search-intent signals"],
  // taxonomy tokens (collapse to plain English)
  [/\baction_type\b/g, "action type"],
  [/\btrigger_signal\b/g, "signal"],
  [/\bevidence_tier\b/g, "evidence"],
  // mode labels — operator vocabulary that must not appear customer-facing
  [/\bMode\s+[ABC]\b/g, "Beacon's evaluation mode"],
  // recommendation IDs — more-specific first
  [/\bsource_rec_id\b/g, "source recommendation"],
  [/\brec_id\b/g, "recommendation"],
  // bucket labels
  [/\bdiagnostic_only\b/g, "diagnostic"],
  // hyphenated token: lookaround on non-alphanumerics (\b treats hyphens as boundaries)
  [/(?<![A-Za-z0-9])customer-queue-ready(?![A-Za-z0-9])/g, "customer queue"],
];

/**
 * Apply the B.2 forward-prevention scrubbers: long hex hashes and the
 * 12 locked internal taxonomy tokens. Each pattern replaces with a
 * customer-safe substitute; surrounding text is preserved.
 *
 * Pure. Deterministic. Idempotent — running on an already-scrubbed
 * string is a no-op because the replacement strings contain none of
 * the matched tokens.
 *
 * Exported for testability + so future call sites (e.g., a future cron
 * that re-scrubs at scan time) can reuse the same logic without
 * needing the `promptTextById` lookup that the UUID path requires.
 */
export function scrubInternalLeakagePatterns(text: string): string {
  let out = text;
  // Long hex hashes (post-UUID-replacement — canonical UUIDs are already gone)
  out = out.replace(LONG_HEX_HASH_PATTERN_GLOBAL, "prompt evidence");
  // 12 locked internal tokens
  for (const [pattern, replacement] of INTERNAL_TOKEN_REPLACEMENTS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Strip prompt UUIDs from operator-visible copy and replace each with
 * a quoted snippet of the prompt text when the mapping is available,
 * or with a generic "prompt evidence" fallback when the UUID maps to
 * an unknown prompt (e.g., a deleted prompt or a hand-typed UUID with
 * no prompt-row counterpart).
 *
 * Slice 4.5.G-B.2 (2026-05-21): in addition to UUIDs, also scrubs the
 * locked long-hex-hash + internal-taxonomy-token leakage patterns the
 * B.1 render-guard catches. Forward-only: this sanitizer runs at
 * persistence time; it does NOT mutate historical rows.
 *
 * Preserves all surrounding text. Idempotent — running twice is a
 * no-op once the UUIDs/hashes/tokens are gone.
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
  let out = text;
  // Phase 1 — UUID replacement (existing M2 behavior, 2026-05-05).
  // Use a fresh regex instance because /g state persists on the literal
  // when used with .test() / .exec() — a subtle source of bugs.
  if (UUID_PATTERN_SINGLE.test(out)) {
    out = out.replace(
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
  // Phase 2 — B.2 forward-prevention scrubbers (2026-05-21).
  out = scrubInternalLeakagePatterns(out);
  return out;
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
