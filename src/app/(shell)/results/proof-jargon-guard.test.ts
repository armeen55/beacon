import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * proof-jargon-guard (FINAL PREMIUM PLAN item 69) - the Results page must read in
 * plain business language. This test scans the SOURCE of the /results surface files
 * and asserts that no operator-visible string (JSX text or string literal) leaks a
 * lab word (baseline, treatment, reservation, experiment, control) or an em/en dash.
 *
 * Heuristic, not a parser (by design, keep it robust):
 *   1. strip comments (block + line),
 *   2. collect every quoted string literal (template interpolations stripped),
 *   3. collect JSX text: inline >text< runs (expression holes stripped) plus bare
 *      prose lines (letters, no tag/brace/assignment characters, not statement-like).
 * Code identifiers like `controlsUsed` / `l.baseline` never reach the word-boundary
 * checks because member accesses and statements are filtered out.
 */

const FILES = [
  "page.tsx",
  "proof-ledger-client.tsx",
  "proof-summary-section.tsx",
  "forecast-calibration-section.tsx",
  "../../../domains/experiments/forecast-receipts.ts",
  // Item C6 - the Results page embeds ResultsTimeline -> ChangesV2Client, so its
  // empty-state copy ("Those are the changes you shipped...") is operator-visible
  // on /results too. Guarded here so a future "experiment" word regression on this
  // file fails loudly instead of quietly reappearing on a page it wasn't written for.
  "../changes/changes-v2-client.tsx",
] as const;

/** Never allowed in visible text (word boundary, case-insensitive). */
const BANNED_WORDS = [
  /\bbaselines?\b/i,
  /\btreatments?\b/i,
  /\breservations?\b/i,
  /\bexperiments?\b/i,
  /\bcontrols?\b/i,
];

/** Em dash (u2014) and en dash (u2013): banned in every visible segment. */
const BANNED_DASHES = /[–—]/;

/**
 * Exact legacy segments in files OUTSIDE this rewrite's ownership. Pinned verbatim
 * so ANY new occurrence (or any edit to these) fails the guard. Prefer shrinking
 * this list to zero by rewriting the source files.
 */
// Empty by design: every operator-visible proof string is now jargon-free. Adding an entry
// here to get past the guard is the wrong fix - rewrite the string in plain language instead.
const ALLOWED_LEGACY_SEGMENTS = new Set<string>([]);

function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  return noBlocks
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/\s.*$/, "$1"))
    .join("\n");
}

/** Module-path string literals (import/export specifiers) are never operator-visible text -
 *  a folder name like "@/domains/experiments/..." must not trip the lab-word guard. Blank the
 *  whole line so its module-specifier string is never handed to extractStringLiterals. */
function stripImportExportLines(src: string): string {
  return src
    .split("\n")
    .map((line) => (/^\s*(import|export)\b.*\bfrom\b/.test(line) ? "" : line))
    .join("\n");
}

/** Contents of every "...", '...' and `...` literal; ${...} holes blanked. */
function extractStringLiterals(src: string): string[] {
  const out: string[] = [];
  const re =
    /"([^"\\\n]*(?:\\.[^"\\\n]*)*)"|'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g;
  for (const m of src.matchAll(re)) {
    const body = m[1] ?? m[2] ?? m[3] ?? "";
    out.push(body.replace(/\$\{[^}]*\}/g, " "));
  }
  return out;
}

/** JSX text: inline >text< runs plus bare prose lines (multi-line text nodes). */
function extractJsxText(src: string): string[] {
  const out: string[] = [];
  for (const rawLine of src.split("\n")) {
    for (const m of rawLine.matchAll(/>([^<>]+)</g)) {
      out.push(m[1]!.replace(/\{[^{}]*\}/g, " "));
    }
    // Blank balanced {expression} holes first so a prose line with an inline
    // expression ("What we learned ({rows.length})") still reads as prose; a
    // line with UNBALANCED braces keeps them and is rejected as code below.
    const line = rawLine.trim().replace(/\{[^{}]*\}/g, " ");
    const looksLikeProse =
      /[A-Za-z]{3}/.test(line) &&
      !/[<>{}=]/.test(line) &&
      !/[;,(]\s*$/.test(line) &&
      !/[\w)\]]\??\.[A-Za-z_$]/.test(line) &&
      !/^(import|export|const|let|var|return|function|if|else|for|while|switch|case|type|interface|async|await|break|continue|throw|new)\b/.test(
        line,
      );
    if (looksLikeProse) out.push(line);
  }
  return out;
}

function visibleSegmentsOf(file: string): string[] {
  const src = stripComments(readFileSync(resolve(__dirname, file), "utf8"));
  return [...extractStringLiterals(stripImportExportLines(src)), ...extractJsxText(src)];
}

describe("proof surface - plain business language guard (item 69)", () => {
  for (const file of FILES) {
    describe(file, () => {
      it("has no em or en dash in any visible segment", () => {
        for (const seg of visibleSegmentsOf(file)) {
          expect(seg, `"${seg}" in ${file} contains an em or en dash`).not.toMatch(
            BANNED_DASHES,
          );
        }
      });

      it("has no lab jargon in any visible segment", () => {
        for (const seg of visibleSegmentsOf(file)) {
          if (ALLOWED_LEGACY_SEGMENTS.has(seg.trim())) continue;
          for (const word of BANNED_WORDS) {
            expect(seg, `"${seg}" in ${file} matches banned word ${word}`).not.toMatch(
              word,
            );
          }
        }
      });
    });
  }

  it("extraction heuristic still sees real page text (self-check)", () => {
    // If the extractor ever goes blind, the jargon assertions above would pass
    // vacuously. Pin a few known-visible strings so a broken heuristic fails loudly.
    const pageSegments = visibleSegmentsOf("page.tsx");
    const joined = pageSegments.join("\n");
    expect(joined).toContain("Measured outcomes");
    expect(joined).toContain("What we learned");
    expect(joined).toContain("comparison page");
    const summarySegments = visibleSegmentsOf("proof-summary-section.tsx").join("\n");
    expect(summarySegments).toContain("Proof at a glance");
  });
});
