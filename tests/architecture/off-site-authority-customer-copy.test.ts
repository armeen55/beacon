/**
 * Architecture invariant — Section 7 C7a operator-page customer-copy
 * discipline (2026-05-16).
 *
 * Section 7 locked invariant #3 ("no scary/accusatory customer copy")
 * applies even to operator surfaces — they ship the same vocabulary
 * floor as customer surfaces so a future drive-by promoting an
 * operator page to a customer surface doesn't inherit hostile copy.
 *
 * Scans the operator diagnostic page's customer-visible string
 * literals + template-literal static text segments (skipping
 * `${...}` substitution expressions) for forbidden phrases.
 *
 * Forbidden:
 *   - causal verbs: drove, caused, generated, ` made `, led to
 *   - revenue framing: `$`, revenue, dollars, sales, leads
 *   - operator-only Mode labels: Mode A / Mode B / Mode C
 *   - internal schema names: primary_recommendation_count,
 *     total_possible, scope_type, claimable, still_learning
 *   - Section 7 additions:
 *     - ` GBP ` (with spaces) — full-form "Google Business Profile"
 *       required in rendered text
 *     - `missing` — scary form; softer "did not find a confirmed"
 *       required (locked I-block invariant #3)
 *
 * Allowlist (documented):
 *   - "Google Business Profile" full form
 *   - "Better Business Bureau"
 *   - "ChatGPT" / "Perplexity" platform labels (not present here, but
 *     the same allowlist policy applies repo-wide)
 *
 * Mirrors C6b's character-level visible-text extraction so the `$`
 * check is robust against template-substitution syntax.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE = "src/app/(shell)/diagnostics/off-site-authority/page.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Walk `src` and accumulate visible-text candidates:
 *   - double/single-quoted string-literal contents
 *   - template-literal static segments (skipping ${...} substitution
 *     expressions, tracking nested braces)
 */
function extractCustomerVisibleText(src: string): string {
  const segments: string[] = [];
  let i = 0;
  const len = src.length;
  while (i < len) {
    const ch = src[i];

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
      i += 1;
      continue;
    }

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
      i += 1;
      continue;
    }

    if (ch === "`") {
      i += 1;
      let chunkStart = i;
      while (i < len && src[i] !== "`") {
        if (src[i] === "\\" && i + 1 < len) {
          i += 2;
          continue;
        }
        if (src[i] === "$" && i + 1 < len && src[i + 1] === "{") {
          if (i > chunkStart) segments.push(src.slice(chunkStart, i));
          i += 2;
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
      if (i > chunkStart) segments.push(src.slice(chunkStart, i));
      i += 1;
      continue;
    }

    i += 1;
  }
  return segments.join("\n");
}

const VISIBLE = extractCustomerVisibleText(stripComments(read(PAGE)));
const VISIBLE_LOWER = VISIBLE.toLowerCase();

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  { phrase: "drove", rationale: "Causal verb." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: " made ", rationale: "Causal verb (with spaces)." },
  { phrase: "led to", rationale: "Causal phrase." },
  { phrase: "$", rationale: "Dollar sign in customer-visible text — revenue framing." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Revenue framing." },
  { phrase: "Mode A", rationale: "Operator-only label; never customer-visible." },
  { phrase: "Mode B", rationale: "Operator-only label; never customer-visible." },
  { phrase: "Mode C", rationale: "Operator-only label; never customer-visible." },
  { phrase: "primary_recommendation_count", rationale: "Internal schema field." },
  { phrase: "total_possible", rationale: "Internal schema field." },
  { phrase: "scope_type", rationale: "Internal schema field." },
  { phrase: "claimable", rationale: "Internal status enum." },
  { phrase: "still_learning", rationale: "Internal status enum." },
  // Section 7 additions:
  { phrase: " GBP ", rationale: "Abbreviation — use 'Google Business Profile' in visible text." },
  { phrase: "missing", rationale: "Scary form — use 'did not find a confirmed' (Section 7 locked invariant #3)." },
];

describe("Architecture — Section 7 C7a operator-page customer copy", () => {
  it("extracts a non-trivial amount of visible text (sanity check)", () => {
    expect(VISIBLE.length).toBeGreaterThan(150);
  });

  for (const rule of FORBIDDEN) {
    it(`does not contain forbidden phrase '${rule.phrase}'`, () => {
      const needle = rule.phrase.toLowerCase();
      const idx = VISIBLE_LOWER.indexOf(needle);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(VISIBLE.length, idx + needle.length + 40);
        throw new Error(
          `Forbidden phrase '${rule.phrase}' present in visible text of ${PAGE} (offset ${idx}).\n` +
            `Rationale: ${rule.rationale}\n` +
            `Excerpt: ...${VISIBLE.slice(start, end)}...`,
        );
      }
      expect(idx).toBe(-1);
    });
  }
});
