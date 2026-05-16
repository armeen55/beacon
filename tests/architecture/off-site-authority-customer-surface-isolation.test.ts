/**
 * Architecture invariant — Section 7 C7a customer-surface isolation
 * (2026-05-16).
 *
 * C7a is OPERATOR-ONLY. The new diagnostic page lives under
 * `/diagnostics/off-site-authority` and must NOT pull anything from
 * the customer-facing app shells:
 *   - src/app/(shell)/today
 *   - src/app/(shell)/recommendations
 *   - src/app/(shell)/changes
 *   - src/app/(shell)/prompts
 *   - src/app/(shell)/local
 *
 * Defense-in-depth: catches a future drive-by that adds a "show on
 * Today" component import. Customer-facing tile work is C7d/C7e and
 * is gated behind the multi-tenant prerequisite (see catalog row
 * `off-site-authority-multi-tenant-prerequisite`).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const C7A_FILES = [
  "src/domains/off-site-authority/types.ts",
  "src/domains/off-site-authority/compute-snapshot.ts",
  "src/domains/off-site-authority/load-snapshot.ts",
  "src/app/(shell)/diagnostics/off-site-authority/page.tsx",
] as const;

const FORBIDDEN_IMPORT_PATH_PREFIXES = [
  "@/app/(shell)/today",
  "@/app/(shell)/recommendations",
  "@/app/(shell)/changes",
  "@/app/(shell)/prompts",
  "@/app/(shell)/local",
  // Relative variants — belt-and-suspenders for any drive-by that
  // tries a relative path resolution.
  "../../today",
  "../../recommendations",
  "../../changes",
  "../../prompts",
  "../../local",
] as const;

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("Architecture — Section 7 C7a customer-surface isolation", () => {
  for (const rel of C7A_FILES) {
    const active = stripComments(read(rel));
    for (const prefix of FORBIDDEN_IMPORT_PATH_PREFIXES) {
      it(`${rel}: does NOT import from a customer surface path starting with '${prefix}'`, () => {
        const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const re = new RegExp(
          `from\\s+["']${escaped}(?:["']|\\/)`,
        );
        expect(active).not.toMatch(re);
      });
    }
  }
});
