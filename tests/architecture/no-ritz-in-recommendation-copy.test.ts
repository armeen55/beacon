/**
 * 2026-06-13 — guard: no RENDERED "Ritz" in recommendation copy.
 *
 * recommendation-action-rows.ts (composeRowEvidenceSummary, MOTIVE_LABEL) +
 * recommendation-evidence-preview.ts fed literal "Ritz" strings into the
 * operator-facing cards — so Iranopedia cards would say "Ritz". De-branded to
 * tenant-neutral copy ("your site" / "you"). This pins it: any line in those
 * files containing "Ritz" must be a COMMENT (docs/history allowed), never a
 * rendered string literal.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FILES = [
  "src/domains/recommendations/recommendation-action-rows.ts",
  "src/domains/recommendations/recommendation-evidence-preview.ts",
];

function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

describe("no rendered 'Ritz' in recommendation copy", () => {
  for (const rel of FILES) {
    it(`${rel}: every 'Ritz' is in a comment, never a rendered string`, () => {
      const src = readFileSync(join(ROOT, rel), "utf-8");
      const offenders = src
        .split("\n")
        .map((line, i) => ({ line, n: i + 1 }))
        .filter(({ line }) => /Ritz/.test(line) && !isCommentLine(line));
      expect(
        offenders.map((o) => `${rel}:${o.n}: ${o.line.trim()}`),
      ).toEqual([]);
    });
  }
});
