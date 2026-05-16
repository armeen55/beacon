/**
 * Architecture invariant — Section 5.B Slice 1 / customer-copy
 * vocabulary on the new repeat-citation Changes detail sub-line
 * (2026-05-16).
 *
 * Visible-text extractor pulls string-literal contents +
 * template-literal static segments (skipping `${...}` substitution)
 * from `src/components/changes/repeat-citation-act3.tsx` and
 * forbids the locked Section 5.A + Section 6 vocabulary set plus
 * the Section 5.B customer-page additions.
 *
 * Categories:
 *   • Causal verbs: drove · caused · generated · " made " · "led to"
 *   • Revenue framing: $ · revenue · dollars · sales · leads
 *   • Operator-only Mode labels: Mode A · Mode B · Mode C
 *   • Promise verbs: "will improve rankings" · "will drive" ·
 *     "will make AI cite"
 *   • Prescriptive: "you must" · "you need to"
 *   • Cross-section vocabulary: "primary recommendation" ·
 *     "primary_recommendation"
 *   • Operator-page additions (forbidden on customer too):
 *     standalone "missing"
 *   • Section 5.B additions:
 *       - "One-off" (must use "Early signal")
 *       - "Intermittent" (must use "Recurring")
 *       - "%" (no percentages on customer surface)
 *       - "failing" / "underperforming" / "weak" / "bad"
 *         (verdict-style words)
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TARGET = "src/components/changes/repeat-citation-act3.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Extract string-literal contents + template-literal static
 * segments. Skips `${...}` substitution via depth-counted walker.
 */
function extractVisibleText(src: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
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

const ACTIVE = stripComments(read(TARGET));
const VISIBLE = extractVisibleText(ACTIVE);

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  // Causal verbs
  { phrase: "drove", rationale: "Causal verb." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: " made ", rationale: "Causal verb (space-bounded)." },
  { phrase: "led to", rationale: "Causal verb." },
  // Revenue framing
  { phrase: "$", rationale: "Revenue framing — Section 9 territory." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Revenue framing." },
  // Mode labels (Section 6 H8)
  { phrase: "Mode A", rationale: "Section 6 operator-only label." },
  { phrase: "Mode B", rationale: "Section 6 operator-only label." },
  { phrase: "Mode C", rationale: "Section 6 operator-only label." },
  // Promise verbs
  { phrase: "will improve rankings", rationale: "Promise verb." },
  { phrase: "will drive", rationale: "Promise verb." },
  { phrase: "will make AI cite", rationale: "Promise verb." },
  // Prescriptive
  { phrase: "you must", rationale: "Prescriptive." },
  { phrase: "you need to", rationale: "Prescriptive." },
  // Section 6 cross-section vocab
  { phrase: "primary recommendation", rationale: "Section 6 scope." },
  { phrase: "primary_recommendation", rationale: "Section 6 schema name." },
  // Operator-only carry-over
  // Note: 'missing' handled by word-bounded regex below to avoid
  // false-positives on compound identifiers.
  // Section 5.B customer-surface additions
  { phrase: "One-off", rationale: "Internal band name — must map to 'Early signal'." },
  { phrase: "Intermittent", rationale: "Internal band name — must map to 'Recurring'." },
  { phrase: "%", rationale: "No percentages on customer repeat-citation surface." },
  { phrase: "failing", rationale: "Verdict word." },
  { phrase: "underperforming", rationale: "Verdict word." },
  { phrase: "weak", rationale: "Verdict word." },
  { phrase: "bad", rationale: "Verdict word." },
];

describe("Architecture — repeat-citation customer-copy vocab (Section 5.B Slice 1)", () => {
  for (const { phrase, rationale } of FORBIDDEN) {
    it(`visible text does NOT contain '${phrase}'`, () => {
      const idx = VISIBLE.indexOf(phrase);
      if (idx >= 0) {
        const start = Math.max(0, idx - 40);
        const end = Math.min(VISIBLE.length, idx + phrase.length + 40);
        throw new Error(
          `${TARGET}: forbidden vocab '${phrase}' present in visible text (offset ${idx}).\n` +
            `Rationale: ${rationale}\n` +
            `Excerpt: ...${VISIBLE.slice(start, end)}...`,
        );
      }
      expect(idx).toBe(-1);
    });
  }

  it("visible text does NOT contain standalone 'missing'", () => {
    const m = /\bmissing\b/i.exec(VISIBLE);
    if (m) {
      const start = Math.max(0, m.index - 40);
      const end = Math.min(VISIBLE.length, m.index + 7 + 40);
      throw new Error(
        `${TARGET}: standalone 'missing' present in visible text (offset ${m.index}). ` +
          `Use 'not yet observed' or 'not repeated in this window' instead.\n` +
          `Excerpt: ...${VISIBLE.slice(start, end)}...`,
      );
    }
    expect(m).toBeNull();
  });
});
