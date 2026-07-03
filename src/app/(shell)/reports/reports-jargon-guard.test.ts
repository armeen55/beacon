import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * reports-jargon-guard (P23) - the internal reports pack must read in plain
 * business language, same law the /results surface lives under. This scans the
 * SOURCE of the reports files and asserts no operator-visible string leaks a lab
 * word (baseline, treatment, reservation, experiment, control) or an em/en dash.
 * Heuristic mirrors proof-jargon-guard.test.ts (comments stripped, string
 * literals + JSX prose collected).
 */

const FILES = [
  "page.tsx",
  "win-card.tsx",
  "report-model.ts",
  "win/[id]/page.tsx",
] as const;

const BANNED_WORDS = [
  /\bbaselines?\b/i,
  /\btreatments?\b/i,
  /\breservations?\b/i,
  /\bexperiments?\b/i,
  /\bcontrols?\b/i,
];

const BANNED_DASHES = /[‒–—―]/;

function stripComments(src: string): string {
  const noBlocks = src.replace(/\/\*[\s\S]*?\*\//g, " ");
  return noBlocks
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/\s.*$/, "$1"))
    .join("\n");
}

function stripImportExportLines(src: string): string {
  return src
    .split("\n")
    .map((line) => (/^\s*(import|export)\b.*\bfrom\b/.test(line) ? "" : line))
    .join("\n");
}

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

function extractJsxText(src: string): string[] {
  const out: string[] = [];
  for (const rawLine of src.split("\n")) {
    for (const m of rawLine.matchAll(/>([^<>]+)</g)) {
      out.push(m[1]!.replace(/\{[^{}]*\}/g, " "));
    }
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

/** A pure Tailwind/CSS class-token string (e.g. "flex items-baseline gap-x-3") is
 *  never operator-visible copy - it just happens to contain "-baseline". Skip it
 *  so a layout utility can't trip the plain-language word guard. Heuristic: every
 *  space-separated token looks like a class (lowercase letters, digits, and the
 *  class punctuation - / : [ ] % . only), and there is no sentence punctuation. */
function isClassNameString(seg: string): boolean {
  const s = seg.trim();
  if (!s) return false;
  // Real prose carries capital letters or sentence punctuation; class strings do not.
  if (/[A-Z.,!?;'"]/.test(s.replace(/\[[^\]]*\]/g, ""))) return false;
  const tokens = s.split(/\s+/);
  const allClassLike = tokens.every((tok) => /^[a-z0-9:_./%\-\[\]]+$/.test(tok));
  // At least one Tailwind-style hyphen/colon token distinguishes a class list
  // ("flex items-baseline") from a bare lowercase phrase.
  return allClassLike && /[-:]/.test(s);
}

function visibleSegmentsOf(file: string): string[] {
  const src = stripComments(readFileSync(resolve(__dirname, file), "utf8"));
  return [
    ...extractStringLiterals(stripImportExportLines(src)),
    ...extractJsxText(src),
  ].filter((seg) => !isClassNameString(seg));
}

describe("reports pack - plain business language guard (P23)", () => {
  for (const file of FILES) {
    describe(file, () => {
      it("has no em or en dash in any visible segment", () => {
        for (const seg of visibleSegmentsOf(file)) {
          expect(seg, `"${seg}" in ${file} contains an em or en dash`).not.toMatch(BANNED_DASHES);
        }
      });

      it("has no lab jargon in any visible segment", () => {
        for (const seg of visibleSegmentsOf(file)) {
          for (const word of BANNED_WORDS) {
            expect(seg, `"${seg}" in ${file} matches banned word ${word}`).not.toMatch(word);
          }
        }
      });
    });
  }

  it("extraction heuristic still sees real reports copy (self-check)", () => {
    const pageText = visibleSegmentsOf("page.tsx").join("\n");
    expect(pageText).toContain("This month at a glance");
    expect(pageText).toContain("Your biggest win");
    const cardText = visibleSegmentsOf("win-card.tsx").join("\n");
    expect(cardText).toContain("No measured wins yet.");
  });
});
