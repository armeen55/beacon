/**
 * Architecture invariant — Section 6 C6b client forbidden-vocab scan
 * (2026-05-15).
 *
 * Pre-emptively enforces Section 12 N4 on the v2 Changes detail
 * client: forbids causal/revenue/Mode-label/internal-enum vocabulary
 * — INCLUDING the literal "$" character — from ever appearing in
 * customer-visible string literals or template-literal static text
 * segments. Defense-in-depth — the C6a forbidden-vocab invariant
 * covers the copy module (the source of customer-visible lines); this
 * companion guards against a future drive-by hard-coding override
 * copy directly in the v2 client (e.g., a tooltip, placeholder,
 * heading, or inline string that adds forbidden phrasing).
 *
 * Scope: ONLY
 * `src/app/(shell)/changes/[id]/change-detail-v2-client.tsx`.
 *
 * Source preprocessing (in order):
 *   1. Strip block + line comments — JSDoc + line comments may
 *      legitimately mention forbidden phrases for documentation, and
 *      they never reach customers.
 *   2. Walk the comment-stripped source with a character-level state
 *      machine and extract ONLY the contents of:
 *        • double-quoted string literals  (`"..."`)
 *        • single-quoted string literals  (`'...'`)
 *        • template-literal static text   (between backticks,
 *          EXCLUDING `${...}` substitution expressions — those are
 *          code, not customer-visible text)
 *   3. Concatenate the extracted segments and scan for forbidden
 *      phrases.
 *
 * Why character-level extraction (not a regex-based strip):
 *   • Strip-based approaches (`replace(/\$\{[^}]*\}/g, "")`) leave
 *     surrounding TSX code in scope, which makes a "$" scan
 *     unreliable (template-substitution syntax `${expr}` legitimately
 *     contains `$` — the strip removes the substitution but the
 *     surrounding template static text still has `$` if a developer
 *     wrote `${foo}` inside a template; the strip doesn't help for
 *     edge cases like nested expressions).
 *   • By extracting only the cooked/static portion of every string
 *     literal and template literal, the scan operates strictly on
 *     candidate visible text. A `$` in extracted text is real
 *     content, not syntax.
 *
 * Allowlist (documented):
 *   • "ChatGPT" / "Perplexity" platform labels — no forbidden
 *     overlap; not on the forbidden list.
 *   • Status enum identifiers like "pass" / "silent" / "still_learning"
 *     never reach the v2 client (it only sees `string[] | null`); the
 *     `still_learning` literal IS forbidden in the client per Section
 *     12 N4 since the client would surface it as visible text if a
 *     drive-by inserted it.
 *   • Import paths (`@/lib/utils`, `next/link`, etc.) are extracted
 *     as string-literal content but contain no forbidden phrases in
 *     practice.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CLIENT_PATH =
  "src/app/(shell)/changes/[id]/change-detail-v2-client.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Walk `src` and accumulate the textual content of every string
 * literal + template-literal static segment. Skips `${...}`
 * substitution expressions (those are code, not customer text) and
 * handles escape sequences inside string literals so `\"` / `\'` /
 * `\\` don't prematurely terminate a literal.
 *
 * Returns the joined extracted text. The forbidden-vocab scan
 * operates strictly on this output, which means a `$` in the result
 * is real content (never template-substitution syntax).
 */
function extractCustomerVisibleText(src: string): string {
  const segments: string[] = [];
  let i = 0;
  const len = src.length;

  while (i < len) {
    const ch = src[i];

    // Double-quoted string literal.
    if (ch === '"') {
      i += 1;
      const start = i;
      while (i < len && src[i] !== '"') {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        i += 1;
      }
      segments.push(src.slice(start, i));
      i += 1; // skip closing "
      continue;
    }

    // Single-quoted string literal.
    if (ch === "'") {
      i += 1;
      const start = i;
      while (i < len && src[i] !== "'") {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        i += 1;
      }
      segments.push(src.slice(start, i));
      i += 1; // skip closing '
      continue;
    }

    // Template literal — accumulate static portions, skip ${...}.
    if (ch === "`") {
      i += 1;
      let chunkStart = i;
      while (i < len && src[i] !== "`") {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (src[i] === "$" && i + 1 < len && src[i + 1] === "{") {
          // Flush static text up to here, then skip the entire
          // ${...} block tracking nested braces (for template
          // expressions that contain object/JSX literals).
          if (i > chunkStart) {
            segments.push(src.slice(chunkStart, i));
          }
          i += 2; // skip ${
          let depth = 1;
          while (i < len && depth > 0) {
            if (src[i] === "{") depth += 1;
            else if (src[i] === "}") depth -= 1;
            i += 1;
          }
          chunkStart = i;
          continue;
        }
        i += 1;
      }
      if (i > chunkStart) {
        segments.push(src.slice(chunkStart, i));
      }
      i += 1; // skip closing `
      continue;
    }

    i += 1;
  }

  return segments.join("\n");
}

const COMMENT_STRIPPED = stripComments(read(CLIENT_PATH));
const VISIBLE_TEXT = extractCustomerVisibleText(COMMENT_STRIPPED);
const VISIBLE_TEXT_LOWER = VISIBLE_TEXT.toLowerCase();

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  // Causal verbs — primary-recommendation copy must never imply
  // causation. Section 12 N4 carry-over.
  { phrase: "drove", rationale: "Causal verb. Use observation framing." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: " made ", rationale: "Causal verb (spaces avoid false-positive on 'main', 'made-up', etc.)." },
  { phrase: "led to", rationale: "Causal phrase." },
  // Revenue / financial language.
  {
    phrase: "$",
    rationale:
      "Dollar sign in customer-visible text. Section 12 N4 forbids revenue framing. The extraction walker emits only string-literal + template-static text, so this scan is reliable against TSX/template-substitution syntax.",
  },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Revenue framing." },
  // Internal Mode labels — operator-only.
  { phrase: "Mode A", rationale: "Operator-only label." },
  { phrase: "Mode B", rationale: "Operator-only label." },
  { phrase: "Mode C", rationale: "Operator-only label." },
  // Internal customer-schema enum names.
  { phrase: "primary_recommendation_count", rationale: "Internal schema field." },
  { phrase: "total_possible", rationale: "Internal schema field." },
  { phrase: "scope_type", rationale: "Internal schema field." },
  { phrase: "claimable", rationale: "Internal status enum." },
  { phrase: "still_learning", rationale: "Internal status enum." },
];

describe("Architecture — Section 6 C6b client forbidden customer vocabulary", () => {
  it("extracts a non-trivial amount of visible text (sanity check)", () => {
    // Pin a floor so a future change that accidentally voids the
    // extractor (returning empty) is caught.
    expect(VISIBLE_TEXT.length).toBeGreaterThan(200);
  });

  for (const rule of FORBIDDEN) {
    it(`does not contain forbidden phrase "${rule.phrase}" in customer-visible text of change-detail-v2-client.tsx`, () => {
      const needle = rule.phrase.toLowerCase();
      const idx = VISIBLE_TEXT_LOWER.indexOf(needle);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(VISIBLE_TEXT.length, idx + needle.length + 40);
        const excerpt = VISIBLE_TEXT.slice(start, end);
        throw new Error(
          `Forbidden phrase "${rule.phrase}" found in customer-visible text of ${CLIENT_PATH} (offset ${idx}).\n` +
            `Rationale: ${rule.rationale}\n` +
            `Excerpt: ...${excerpt}...`,
        );
      }
      expect(idx).toBe(-1);
    });
  }
});
