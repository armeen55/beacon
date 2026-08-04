/**
 * decision/placeholder-detection: PLACEHOLDER PHRASE detection, pure, no I/O and no model call. The one
 * question it answers is whether a piece of operator-visible copy is a generator stub rather than a change:
 * "Draft answer", "TBD", "[insert ...", "(operator: rewrite)", "placeholder", "rewrite below".
 *
 * The ONE caller is validate-proposal, which refuses any draft this recognises, so a stub can never be
 * presented as work. Case insensitive, whitespace tolerant, and safe on null.
 */

// ---------------------------------------------------------------------------
// Phrase detection
// ---------------------------------------------------------------------------

/**
 * Patterns that MUST never appear in operator-visible copy. Each entry
 * is a case-insensitive regex. Order matters only for diagnostic
 * messages — the first match wins; collectively they're a union.
 *
 * Operator scope (W3 Step 3.1, founder note 2026-05-01):
 *   - "Draft answer"
 *   - "TBD"
 *   - "operator: rewrite" / "(operator: rewrite)"
 *   - "rewrite below"
 *   - "[insert ..."
 *   - "placeholder"
 *   - "(operator: ...)" parenthetical
 *
 * Patterns are intentionally LITERAL — no semantic quality scoring at
 * this layer (that's evaluateFaqAnswer's job). A copy that says
 * "We draft each answer carefully" would NOT match because "Draft "
 * needs to be at the start of a phrase ("draft answer", not "we draft
 * each").
 */
const PLACEHOLDER_PATTERNS: ReadonlyArray<{
  readonly id: string;
  readonly pattern: RegExp;
  readonly description: string;
}> = [
  {
    id: "draft_answer",
    pattern: /\bdraft\s+answer\b/i,
    description: "literal 'Draft answer' phrase",
  },
  {
    id: "tbd",
    // \bTBD\b — match standalone "TBD" or "TBD." or "(TBD)". Avoid
    // matching tokens like "TBDC" or "ATBD" via the word-boundary.
    pattern: /\bTBD\b/i,
    description: "literal 'TBD' marker",
  },
  {
    id: "operator_rewrite",
    // Catches "(operator: rewrite)", "operator: rewrite", "Operator: Rewrite".
    pattern: /\boperator\s*:\s*rewrite\b/i,
    description: "literal 'operator: rewrite' instruction",
  },
  {
    id: "operator_parenthetical",
    // Any (operator: …) parenthetical — covers "(operator: fill in)",
    // "(operator: add details)", etc. Scoped to a single line so a
    // legitimate sentence containing "operator" doesn't fire.
    pattern: /\(\s*operator\s*:[^)\n]*\)/i,
    description: "(operator: ...) parenthetical",
  },
  {
    id: "rewrite_below",
    pattern: /\brewrite\s+below\b/i,
    description: "literal 'rewrite below' instruction",
  },
  {
    id: "insert_bracket",
    // [insert ...] — a [insert anything] bracket is always a generator
    // placeholder. Anchored on `\[insert` to avoid matching the verb
    // "insert" used naturally ("insert the screws").
    pattern: /\[\s*insert\b[^\]]*\]/i,
    description: "[insert ...] template placeholder",
  },
  {
    id: "placeholder_word",
    // Literal "placeholder" anywhere — generators or LLMs occasionally
    // emit this. False positives are rare (no normal product copy
    // uses the word; technical articles about placeholders themselves
    // would, but those aren't in this domain).
    pattern: /\bplaceholder\b/i,
    description: "literal 'placeholder' word",
  },
  {
    id: "todo_marker",
    // TODO + colon = template marker. "TODO" alone (e.g., a checklist
    // header) wouldn't, so we require the colon.
    pattern: /\bTODO\s*:/i,
    description: "literal 'TODO:' template marker",
  },
];

/**
 * Returns the matched pattern's id when the text reads like a
 * generator placeholder, otherwise null. Whitespace-tolerant.
 *
 * Returns null for empty / non-string inputs (fail-safe — callers
 * shouldn't blow up just because a packet field was null).
 */
function detectPlaceholder(text: string | null | undefined): {
  readonly matched: true;
  readonly patternId: string;
  readonly description: string;
} | {
  readonly matched: false;
} {
  if (typeof text !== "string" || text.length === 0) {
    return { matched: false };
  }
  for (const entry of PLACEHOLDER_PATTERNS) {
    if (entry.pattern.test(text)) {
      return {
        matched: true,
        patternId: entry.id,
        description: entry.description,
      };
    }
  }
  return { matched: false };
}

/** Boolean convenience wrapper around detectPlaceholder. */
export function looksLikePlaceholder(text: string | null | undefined): boolean {
  return detectPlaceholder(text).matched;
}
