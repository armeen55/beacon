/**
 * Expert-rec-engine Slice 2 (2026-06-16) — deterministic COPY-ARTIFACT
 * detector. Closes audit cross-cutting RISK #3: Beacon-drafted copy that is
 * not actually publishable copy.
 *
 * Three artifacts a non-technical operator must never be handed as paste-ready
 * "Suggested copy":
 *   • instruction_artifact   — the text is an INSTRUCTION about the edit
 *     ("Change the page title to …", "Update the meta description") rather than
 *     the title/meta itself. Common when a directive action type's operator
 *     instruction leaks into a copy field.
 *   • repeated_action_word   — a doubled leading verb ("Add Add …", "Update
 *     Update …") from a compose step that prefixed an already-prefixed label.
 *   • duplicate_brand_suffix — the same trailing " | "/dash segment twice
 *     ("Title | Brand | Brand"), from asymmetric brand stripping at compose.
 *
 * Plus length BUDGET helpers (directive PHASE E targets: title 50–59 / hard 60,
 * meta 135–150 / hard 155). Length is a QUALITY signal, not a safety leak — it
 * is NOT used to suppress copy here; it is exported for the compose layer and
 * the reasoning packet to surface "title runs long" without hiding a valid rec.
 *
 * PURE / deterministic / no I/O / no LLM / no Supabase / no mutation. Composed
 * into `checkCopyDisplaySafe` (suggested-copy-display-guard.ts) so the existing
 * render-time guard suppresses an artifact-bearing copy field to the calm
 * fallback — no new render wiring needed (buildCopyTile already guards fields).
 *
 * Pinned by tests/domains/recommendations/copy-artifact-guard.test.ts.
 */

export type CopyArtifactKind =
  | "instruction_artifact"
  | "repeated_action_word"
  | "duplicate_brand_suffix";

/**
 * An INSTRUCTION about an SEO element rather than the element's value. High
 * precision: the imperative verb must take an SEO element (title / meta /
 * description / h1 / heading / headline) as its object — generic body copy that
 * happens to start with "Add" (e.g. a recipe step) does not match because its
 * object is not an SEO element.
 */
const INSTRUCTION_ARTIFACT_RE =
  /\b(?:change|update|set|rewrite|replace|edit|revise|modify)\s+(?:the\s+)?(?:page\s+)?(?:title|meta(?:\s+description)?|description|h1|heading|headline)\b/i;

/**
 * A doubled leading action verb ("Add Add", "Add a Add", "Update Update").
 * Anchored at the start + restricted to compose verbs so doubled prose words
 * ("had had") never trip it. The `i` flag makes the backreference
 * case-insensitive ("Add add" also matches).
 */
const REPEATED_ACTION_WORD_RE =
  /^(add|update|change|set|rewrite|edit|create|include|write|fix|improve|remove|insert)\s+(?:a\s+|an\s+|the\s+)?\1\b/i;

/** Title/meta segment separators: " | ", " – " (en dash), " — " (em dash). */
const SEGMENT_SPLIT_RE = /\s[|–—]\s/;

/**
 * A leading INSTRUCTION-about-an-SEO-element the generator/LLM sometimes emits
 * AS the label/value (e.g. "Change the page title to ", "Add a page title: ",
 * "Add the main page heading: ", "Add the short page description"). The row
 * title templates already supply the verb + element, so the label must be the
 * VALUE only — never an instruction. High precision: the verb must take an SEO
 * element as its object.
 */
const INSTRUCTION_PREFIX_RE =
  /^(?:change|update|set|rewrite|edit|revise|modify|write|add|insert|include)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:page\s+)?(?:title(?:\s+tag)?|meta(?:\s+description)?|description|h1|heading|headline|main\s+page\s+heading|short\s+page\s+description)\b\s*(?:tag\b\s*)?(?:to|so\s+that|reads?|:)?\s+/i;

/**
 * Strip a leading instruction-artifact prefix. Returns the recovered value +
 * whether a prefix was stripped (so the caller can decide to drop a directive
 * that leaves only a sentence fragment).
 */
export function stripInstructionArtifactPrefix(input: string): {
  text: string;
  stripped: boolean;
} {
  if (typeof input !== "string") return { text: "", stripped: false };
  const before = input.trim();
  const after = before.replace(INSTRUCTION_PREFIX_RE, "").trim();
  return { text: after, stripped: after !== before };
}

/** Collapse doubled consecutive words ("Add Add" → "Add"); case-insensitive,
 *  keeps the first occurrence. Safe for titles (they never legitimately repeat
 *  a word back-to-back). */
export function dedupeDoubledWords(input: string): string {
  if (typeof input !== "string") return "";
  return input.replace(/\b(\w+)(?:\s+\1\b)+/gi, "$1");
}

/**
 * Detect a copy artifact, or null when the text is clean. Order is fixed so the
 * first/most-specific artifact is reported.
 */
export function detectCopyArtifact(
  text: string | null | undefined,
): CopyArtifactKind | null {
  if (typeof text !== "string") return null;
  const t = text.trim();
  if (t.length === 0) return null;

  if (INSTRUCTION_ARTIFACT_RE.test(t)) return "instruction_artifact";
  if (REPEATED_ACTION_WORD_RE.test(t)) return "repeated_action_word";

  const segments = t
    .split(SEGMENT_SPLIT_RE)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (segments.length >= 2) {
    const last = segments[segments.length - 1]!.toLowerCase();
    const prev = segments[segments.length - 2]!.toLowerCase();
    if (last === prev) return "duplicate_brand_suffix";
  }

  return null;
}

// ── Length budgets (directive PHASE E; tenant config may override later) ─────

export const TITLE_HARD_MAX_CHARS = 60;
export const TITLE_IDEAL_MIN_CHARS = 50;
export const META_HARD_MAX_CHARS = 155;
export const META_IDEAL_MIN_CHARS = 135;
export const META_IDEAL_MAX_CHARS = 150;

export type LengthStatus = "ok" | "long" | "short";

export type LengthVerdict = {
  readonly chars: number;
  readonly status: LengthStatus;
  /** True when within the hard max (the only HARD constraint). */
  readonly withinHardMax: boolean;
};

/** Title length verdict against the directive's 50–59 ideal / 60 hard window. */
export function titleLengthVerdict(text: string): LengthVerdict {
  const chars = text.trim().length;
  const status: LengthStatus =
    chars > TITLE_HARD_MAX_CHARS
      ? "long"
      : chars < TITLE_IDEAL_MIN_CHARS
        ? "short"
        : "ok";
  return { chars, status, withinHardMax: chars <= TITLE_HARD_MAX_CHARS };
}

/** Meta length verdict against the directive's 135–150 ideal / 155 hard window. */
export function metaLengthVerdict(text: string): LengthVerdict {
  const chars = text.trim().length;
  const status: LengthStatus =
    chars > META_IDEAL_MAX_CHARS
      ? "long"
      : chars < META_IDEAL_MIN_CHARS
        ? "short"
        : "ok";
  return { chars, status, withinHardMax: chars <= META_HARD_MAX_CHARS };
}
