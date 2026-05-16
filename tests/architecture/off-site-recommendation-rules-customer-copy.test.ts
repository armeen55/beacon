/**
 * Architecture invariant — Section 7 C7c customer-copy contract
 * (2026-05-16).
 *
 * Scans the visible-text candidates (string-literal contents +
 * template-literal static segments, skipping `${...}` substitution
 * expressions) of two C7c source files for forbidden customer-vocab:
 *
 *   - `src/domains/off-site-authority/recommendation-rules.ts`
 *       — rule title strings + rationale strings live here.
 *   - `src/app/(shell)/diagnostics/off-site-authority/page.tsx`
 *       — silence-reason labels + the new CandidatesSection's
 *         visible strings live here.
 *
 * Forbidden phrases (case-insensitive substring on visible-text
 * extraction; pre-flight section E + operator-locked additions):
 *   - Causal verbs: `drove`, `caused`, `generated`, ` made `, `led to`
 *   - Revenue framing: `$`, `revenue`, `dollars`, `sales`, `leads`
 *   - Operator-only Mode labels: `Mode A`, `Mode B`, `Mode C`
 *   - Internal schema enum names: `primary_recommendation_count`,
 *     `total_possible`, `scope_type`, `claimable`, `still_learning`
 *   - Automation language: `auto-claim`, `auto-post`,
 *     `auto-review-request`, `automated outreach`
 *   - Section 7 additions: ` GBP ` standalone (full-form
 *     "Google Business Profile" required), `missing` (scary form
 *     — use "did not find a confirmed" instead)
 *   - AI-citation / ranking outcome promises: `will improve rankings`,
 *     `will make AI cite you`, `will drive`, `you must`, `you need to`
 *
 * Allowlist (documented):
 *   - "Google Business Profile" full form
 *   - "Better Business Bureau", "Houzz", "Yelp", "Angi"
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const C7C_TEXT_FILES = [
  "src/domains/off-site-authority/recommendation-rules.ts",
  "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
] as const;

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * Walk `src` and accumulate the contents of string literals + the
 * static segments of template literals. Skips `${...}` substitution
 * expressions (those are code, not customer text) and handles
 * escape sequences in string literals.
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

const FORBIDDEN: ReadonlyArray<{ phrase: string; rationale: string }> = [
  // Causal verbs.
  { phrase: "drove", rationale: "Causal verb." },
  { phrase: "caused", rationale: "Causal verb." },
  { phrase: "generated", rationale: "Causal verb." },
  { phrase: " made ", rationale: "Causal verb (spaces to avoid false-positive on 'main', 'made-up')." },
  { phrase: "led to", rationale: "Causal phrase." },
  // Revenue framing.
  { phrase: "$", rationale: "Dollar sign — revenue framing forbidden." },
  { phrase: "revenue", rationale: "Revenue framing." },
  { phrase: "dollars", rationale: "Revenue framing." },
  { phrase: "sales", rationale: "Revenue framing." },
  { phrase: "leads", rationale: "Revenue framing." },
  // Operator-only Mode labels.
  { phrase: "Mode A", rationale: "Operator-only label." },
  { phrase: "Mode B", rationale: "Operator-only label." },
  { phrase: "Mode C", rationale: "Operator-only label." },
  // Internal schema enum names.
  { phrase: "primary_recommendation_count", rationale: "Internal schema field." },
  { phrase: "total_possible", rationale: "Internal schema field." },
  { phrase: "scope_type", rationale: "Internal schema field." },
  { phrase: "claimable", rationale: "Internal status enum." },
  { phrase: "still_learning", rationale: "Internal status enum." },
  // Automation language.
  { phrase: "auto-claim", rationale: "Section 7 invariant #1: Beacon RECOMMENDS, never PERFORMS." },
  { phrase: "auto-post", rationale: "Section 7 invariant #1." },
  { phrase: "auto-review-request", rationale: "Section 7 invariant #5: no review-gating / policy-risky automation." },
  { phrase: "automated outreach", rationale: "Section 7 invariant #1." },
  // Section 7 additions.
  { phrase: " GBP ", rationale: "Abbreviation — use 'Google Business Profile' in visible text." },
  { phrase: "missing", rationale: "Scary form — use 'did not find a confirmed'." },
  // AI-citation / ranking outcome promises.
  { phrase: "will improve rankings", rationale: "Outcome promise." },
  { phrase: "will make AI cite you", rationale: "Outcome promise." },
  { phrase: "will drive", rationale: "Outcome promise." },
  { phrase: "you must", rationale: "Imperative guarantee." },
  { phrase: "you need to", rationale: "Imperative guarantee." },
];

describe("Architecture — Section 7 C7c customer-copy discipline", () => {
  for (const rel of C7C_TEXT_FILES) {
    const visible = extractCustomerVisibleText(stripComments(read(rel)));
    const visibleLower = visible.toLowerCase();

    it(`${rel}: extracted a non-trivial amount of visible text (sanity check)`, () => {
      expect(visible.length).toBeGreaterThan(50);
    });

    for (const rule of FORBIDDEN) {
      it(`${rel}: visible text does NOT contain forbidden phrase "${rule.phrase}"`, () => {
        const needle = rule.phrase.toLowerCase();
        const idx = visibleLower.indexOf(needle);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(visible.length, idx + needle.length + 40);
          throw new Error(
            `${rel}: forbidden phrase "${rule.phrase}" found in visible text (offset ${idx}).\n` +
              `Rationale: ${rule.rationale}\n` +
              `Excerpt: ...${visible.slice(start, end)}...`,
          );
        }
        expect(idx).toBe(-1);
      });
    }
  }
});
