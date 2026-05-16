/**
 * Architecture invariant — Section 5.A / no customer surface
 * references repeat-citation symbols (2026-05-16).
 *
 * Pins that customer-facing surface files do NOT reference the new
 * Section 5 compute / loader. Section 5.B will explicitly add these
 * surfaces (Changes detail Act 3 sub-line + Today "Edit lifecycle"
 * tile counter) and at that point this invariant RETIRES.
 *
 * Walks the customer-facing surface tree:
 *   src/app/(shell)/{today,recommendations,changes,prompts,local,competitors}/**
 *   src/components/{today,recommendations,changes,prompts,local}/**
 *
 * Forbids any occurrence of:
 *   - repeat-citation
 *   - repeatCitation
 *   - RepeatCitation
 *   - loadRepeatCitationForEdit
 *   - computeRepeatCitation
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
  "src/app/(shell)/competitors",
  "src/components/today",
  "src/components/recommendations",
  "src/components/changes",
  "src/components/prompts",
  "src/components/local",
] as const;

const FORBIDDEN_TOKENS = [
  "repeat-citation",
  "repeatCitation",
  "RepeatCitation",
  "loadRepeatCitationForEdit",
  "computeRepeatCitation",
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
for (const root of CUSTOMER_SURFACE_ROOTS) ALL_FILES.push(...walk(root));

describe("Architecture — no customer-surface references to repeat-citation symbols", () => {
  for (const rel of ALL_FILES) {
    for (const token of FORBIDDEN_TOKENS) {
      it(`${rel}: does NOT reference '${token}'`, () => {
        const active = stripComments(
          readFileSync(resolve(REPO_ROOT, rel), "utf-8"),
        );
        const idx = active.indexOf(token);
        if (idx >= 0) {
          const start = Math.max(0, idx - 40);
          const end = Math.min(active.length, idx + token.length + 40);
          throw new Error(
            `${rel}: customer surface references operator-only Section 5.A symbol '${token}'.\n` +
              `Section 5.B is the slice that introduces these surfaces (Changes detail + Today tile).\n` +
              `Excerpt: ...${active.slice(start, end)}...`,
          );
        }
        expect(idx).toBe(-1);
      });
    }
  }
});
