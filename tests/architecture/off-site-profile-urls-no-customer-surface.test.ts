/**
 * Architecture invariant — Section 7 C7g v1 no-customer-surface
 * contract (2026-05-16).
 *
 * Operator-entered off-site profile URL fields (houzzProfileUrl,
 * angiProfileUrl, bbbProfileUrl, industryDirectoryProfileUrl) are
 * an operator-side signal only. They MUST NOT appear in any
 * customer-facing surface file. Customer-facing off-site surfaces
 * (C7d/C7e) remain BLOCKED by the catalog row
 * `off-site-authority-multi-tenant-prerequisite`; this invariant
 * pins the C7g v1 read-side scope so a drive-by that adds a Today
 * tile or a Recommendations card reading these URLs fails loudly.
 *
 * Scans the comment-stripped active source of every file under the
 * locked customer-facing surface tree:
 *   src/app/(shell)/today
 *   src/app/(shell)/recommendations
 *   src/app/(shell)/changes
 *   src/app/(shell)/prompts
 *   src/app/(shell)/local
 *   src/components/today
 *   src/components/recommendations
 *   src/components/changes
 *   src/components/prompts
 *   src/components/local
 *
 * and forbids any occurrence of the four field names.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

const CUSTOMER_SURFACE_ROOTS = [
  "src/app/(shell)/today",
  "src/app/(shell)/recommendations",
  "src/app/(shell)/changes",
  "src/app/(shell)/prompts",
  "src/app/(shell)/local",
  "src/components/today",
  "src/components/recommendations",
  "src/components/changes",
  "src/components/prompts",
  "src/components/local",
] as const;

const FORBIDDEN_FIELD_NAMES = [
  "houzzProfileUrl",
  "angiProfileUrl",
  "bbbProfileUrl",
  "industryDirectoryProfileUrl",
] as const;

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function walk(rootRel: string): string[] {
  const abs = resolve(REPO_ROOT, rootRel);
  let entries: string[];
  try {
    entries = readdirSync(abs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    const childAbs = join(abs, name);
    const childRel = `${rootRel}/${name}`;
    const stat = statSync(childAbs);
    if (stat.isDirectory()) {
      out.push(...walk(childRel));
    } else if (
      stat.isFile() &&
      (name.endsWith(".ts") || name.endsWith(".tsx"))
    ) {
      out.push(childRel);
    }
  }
  return out;
}

const ALL_FILES: string[] = [];
for (const root of CUSTOMER_SURFACE_ROOTS) {
  ALL_FILES.push(...walk(root));
}

describe("Architecture — Section 7 C7g v1 no customer-surface profile URLs", () => {
  for (const rel of ALL_FILES) {
    for (const fieldName of FORBIDDEN_FIELD_NAMES) {
      it(`${rel}: does NOT reference '${fieldName}'`, () => {
        const active = stripComments(
          readFileSync(resolve(REPO_ROOT, rel), "utf-8"),
        );
        const idx = active.indexOf(fieldName);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(active.length, idx + fieldName.length + 40);
          throw new Error(
            `${rel}: customer-facing file references operator-only field '${fieldName}'.\n` +
              `C7g v1 keeps operator-entered profile URLs off customer surfaces; the catalog row\n` +
              `'off-site-authority-multi-tenant-prerequisite' BLOCKS customer-facing off-site surfaces.\n` +
              `Excerpt: ...${active.slice(start, end)}...`,
          );
        }
        expect(idx).toBe(-1);
      });
    }
  }
});
