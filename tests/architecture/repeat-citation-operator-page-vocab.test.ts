/**
 * Architecture invariant — Section 5.A.2 operator-page vocab
 * (2026-05-16).
 *
 * Extracts visible-text candidates from
 * `src/app/(shell)/diagnostics/repeat-citation/page.tsx` — string-
 * literal contents AND template-literal static segments (skipping
 * `${...}` substitution expressions) — and forbids the locked
 * vocabulary set.
 *
 * Mirrors the Section 5.A `repeat-citation-forbidden-vocab` pattern
 * with two added operator-page checks (`scored`, `AI cites you`,
 * standalone `missing`) that pre-emptively block hostile copy a
 * future drive-by might introduce on the diagnostic surface.
 *
 * Categories:
 *   • Causal verbs: drove · caused · generated · " made " · "led to"
 *   • Revenue framing: $ · revenue · dollars · sales · leads
 *   • Operator-only Mode labels (Section 6 H8 carry-over):
 *     "Mode A" · "Mode B" · "Mode C"
 *   • Promise verbs: "will improve rankings" · "will drive" ·
 *     "will make AI cite"
 *   • Prescriptive: "you must" · "you need to"
 *   • Cross-section vocab: "primary recommendation" ·
 *     "primary_recommendation"
 *   • Operator-page additions:
 *       - "scored" (implies a ranking that doesn't exist)
 *       - "AI cites you" (too informal; use "cited")
 *       - standalone "missing" (too judgmental; use "not yet
 *         observed" or "not repeated in this window")
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE = "src/app/(shell)/diagnostics/repeat-citation/page.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Extract every string-literal body + template-literal static
 * segment from the source. Skips `${...}` substitution expressions
 * inside template literals via a depth-counted walker (matches the
 * Section 5.A / Section 6 / Section 7 visible-text extractor
 * pattern).
 */
function extractVisibleText(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];

    // Skip block strings — single, double, backtick.
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      let buf = "";
      while (j < src.length) {
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        if (src[j] === quote) break;
        buf += src[j];
        j++;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }

    if (ch === "`") {
      let j = i + 1;
      let buf = "";
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "$" && src[j + 1] === "{") {
          // Skip ${...} with brace counting.
          let depth = 1;
          j += 2;
          while (j < src.length && depth > 0) {
            if (src[j] === "{") depth++;
            else if (src[j] === "}") depth--;
            j++;
          }
          continue;
        }
        if (src[j] === "\\") {
          buf += src[j + 1] ?? "";
          j += 2;
          continue;
        }
        buf += src[j];
        j++;
      }
      out.push(buf);
      i = j + 1;
      continue;
    }

    i++;
  }
  return out.join("\n");
}

const ACTIVE = stripComments(read(PAGE));
const VISIBLE = extractVisibleText(ACTIVE);

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  // Causal verbs
  { phrase: "drove", rationale: "Causal verb — describe observation, not causation." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: " made ", rationale: "Causal verb (space-bounded so we don't trip on 'made up of')." },
  { phrase: "led to", rationale: "Causal verb." },
  // Revenue framing
  { phrase: "$", rationale: "Revenue framing — Section 9 territory." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Revenue framing." },
  // Mode labels
  { phrase: "Mode A", rationale: "Section 6 H8 operator-only label." },
  { phrase: "Mode B", rationale: "Section 6 H8 operator-only label." },
  { phrase: "Mode C", rationale: "Section 6 H8 operator-only label." },
  // Promise verbs
  { phrase: "will improve rankings", rationale: "Promise verb." },
  { phrase: "will drive", rationale: "Promise verb." },
  { phrase: "will make AI cite", rationale: "Promise verb." },
  // Prescriptive
  { phrase: "you must", rationale: "Prescriptive — Beacon describes, doesn't dictate." },
  { phrase: "you need to", rationale: "Prescriptive." },
  // Cross-section vocab
  { phrase: "primary recommendation", rationale: "Section 6 scope — must not bleed into Section 5 surfaces." },
  { phrase: "primary_recommendation", rationale: "Section 6 schema name." },
  // Operator-page additions
  { phrase: "scored", rationale: "Implies a ranking that doesn't exist." },
  { phrase: "AI cites you", rationale: "Too informal — use 'cited' instead." },
];

describe("Architecture — repeat-citation operator-page vocab", () => {
  for (const { phrase, rationale } of FORBIDDEN) {
    it(`page visible text does NOT contain '${phrase}'`, () => {
      const idx = VISIBLE.indexOf(phrase);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(VISIBLE.length, idx + phrase.length + 40);
        throw new Error(
          `${PAGE}: forbidden vocab '${phrase}' present in visible text (offset ${idx}).\n` +
            `Rationale: ${rationale}\n` +
            `Excerpt: ...${VISIBLE.slice(start, end)}...`,
        );
      }
      expect(idx).toBe(-1);
    });
  }

  it("page visible text does NOT contain standalone 'missing'", () => {
    // Word-bounded match — accepts compounds like "missing-pages-store"
    // in identifiers (which won't reach VISIBLE anyway because the
    // extractor pulls only string + template literal contents), but
    // blocks the bare word inside customer-style copy.
    const wordRe = /\bmissing\b/i;
    const m = wordRe.exec(VISIBLE);
    if (m) {
      const start = Math.max(0, m.index - 40);
      const end = Math.min(VISIBLE.length, m.index + 7 + 40);
      throw new Error(
        `${PAGE}: standalone 'missing' present in visible text (offset ${m.index}). ` +
          `Use 'not yet observed' or 'not repeated in this window' instead.\n` +
          `Excerpt: ...${VISIBLE.slice(start, end)}...`,
      );
    }
    expect(m).toBeNull();
  });
});
