/**
 * Architecture invariant — Section 6 C6a pure-module purity contract
 * (2026-05-15).
 *
 * Mirrors `tests/architecture/prompt-primary-share-source.test.ts`
 * structurally: the three pure Mode A / Mode B / copy-renderer modules
 * MUST NOT import `getRepository` and MUST NOT reference the identifier
 * in their active (comment-stripped) source. Tenant scope lives at the
 * loader boundary; pure modules consume already-fetched, already-
 * tenant-scoped data.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const PURE_MODULES = [
  "src/domains/citation-lifecycle/change-primary-mode-a.ts",
  "src/domains/citation-lifecycle/change-primary-mode-b.ts",
  "src/domains/citation-lifecycle/change-primary-evidence-copy.ts",
] as const;

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Architecture — Section 6 C6a pure modules do NOT import getRepository", () => {
  for (const rel of PURE_MODULES) {
    it(`${rel}: no getRepository import`, () => {
      const active = stripComments(read(rel));
      expect(active).not.toMatch(
        /import\s*\{[^}]*\bgetRepository\b[^}]*\}\s*from\s*["']@\/lib\/persistence\/repositories["']/,
      );
    });

    it(`${rel}: no bare getRepository identifier in active source`, () => {
      const active = stripComments(read(rel));
      expect(active).not.toMatch(/\bgetRepository\b/);
    });
  }
});
