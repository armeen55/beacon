/**
 * Architecture invariant — Section 6 C6a customer-vocabulary contract
 * (2026-05-15).
 *
 * Scans the copy-renderer module's customer-visible string content for
 * forbidden phrases. Pre-emptively enforces Section 12 N4 on this
 * surface — primary-recommendation copy must never imply causation,
 * never claim revenue/dollars, never leak internal Mode labels, and
 * never expose customer-schema enum names.
 *
 * Scope: ONLY the copy-renderer module
 * (`src/domains/citation-lifecycle/change-primary-evidence-copy.ts`).
 * The Mode A / Mode B pure helpers don't emit customer-visible text,
 * so they're not scanned here.
 *
 * Source-text preprocessing (in order):
 *   1. Comment-strip — JSDoc + line comments can mention forbidden
 *      terms for documentation purposes; they never reach customers.
 *   2. Template-substitution-strip — `${...}` segments inside
 *      template literals are TS syntax, not customer-visible text.
 *      Stripping them avoids a false positive on the literal `$`
 *      character that template syntax inevitably contains.
 *
 * Status enum strings allowlist (documented):
 *   - "pass" / "still_learning" / "still_learning_a" /
 *     "still_learning_b" / "silent" are TS discriminator strings,
 *     never rendered to customers. They are intentionally NOT in the
 *     forbidden list. (They are TS UNION MEMBERS, not customer copy.)
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const COPY_PATH =
  "src/domains/citation-lifecycle/change-primary-evidence-copy.ts";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Remove `${...}` template-substitution expressions from active
 * source. The `$` character inside `${...}` is TS syntax, not
 * customer text. The substituted value itself can NEVER be the literal
 * dollar sign because all callers pass typed values (numbers / brand
 * name strings), never raw "$" — and the forbidden-vocab test for the
 * brand-name path is enforced by surrounding render tests, not this
 * source-text scan.
 */
function stripTemplateSubstitutions(src: string): string {
  // Greedy enough to handle nested braces is unnecessary for our copy
  // strings (which use only flat expressions like ${modeA.primary_count}).
  return src.replace(/\$\{[^}]*\}/g, "");
}

const ACTIVE = stripTemplateSubstitutions(stripComments(read(COPY_PATH)));
const ACTIVE_LOWER = ACTIVE.toLowerCase();

/**
 * Each forbidden rule: the literal substring (case-insensitive) plus
 * a one-line rationale shown on failure.
 */
const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  // Causal language — primary-recommendation copy must not imply
  // causation. Section 12 N4 carry-over.
  { phrase: "drove", rationale: "Causal verb. Use observation framing ('received', 'was up')." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: " made ", rationale: "Causal verb (with spaces to avoid false-positive on 'main', 'made-up', etc.)." },
  { phrase: "led to", rationale: "Causal phrase." },
  // Revenue / financial language — never appropriate on Changes detail.
  { phrase: "$", rationale: "Dollar sign in customer copy. Section 12 N4 forbids revenue framing." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Revenue framing." },
  // Internal Mode labels — operator-only vocabulary.
  { phrase: "Mode A", rationale: "Operator-only label. Never customer-visible." },
  { phrase: "Mode B", rationale: "Operator-only label. Never customer-visible." },
  { phrase: "Mode C", rationale: "Operator-only label. Never customer-visible." },
  // Internal customer-schema enum names.
  { phrase: "primary_recommendation_count", rationale: "Internal schema field name." },
  { phrase: "total_possible", rationale: "Internal schema field name." },
  { phrase: "scope_type", rationale: "Internal schema field name." },
  { phrase: "claimable", rationale: "Internal status enum. Never customer-visible." },
];

describe("Architecture — Section 6 C6a forbidden customer vocabulary", () => {
  for (const rule of FORBIDDEN) {
    it(`does not contain forbidden phrase "${rule.phrase}" in change-primary-evidence-copy.ts`, () => {
      const needle = rule.phrase.toLowerCase();
      const idx = ACTIVE_LOWER.indexOf(needle);
      if (idx >= 0) {
        // Build a small excerpt around the hit for the failure message.
        const excerptStart = Math.max(0, idx - 40);
        const excerptEnd = Math.min(ACTIVE.length, idx + needle.length + 40);
        const excerpt = ACTIVE.slice(excerptStart, excerptEnd);
        throw new Error(
          `Forbidden phrase "${rule.phrase}" found in ${COPY_PATH} (offset ${idx}).\n` +
            `Rationale: ${rule.rationale}\n` +
            `Excerpt: ...${excerpt}...`,
        );
      }
      expect(idx).toBe(-1);
    });
  }
});
