/**
 * Architecture invariant — Section 5.A / no customer surface
 * references repeat-citation symbols, EXCEPT the explicitly
 * allowlisted Section 5.B Slice 1 customer-facing files
 * (2026-05-16 — transitioned from blanket ban to allowlist).
 *
 * Section 5.B Slice 1 (Changes detail Act 3 sub-line) introduced
 * the FIRST customer-facing files permitted to reference
 * repeat-citation symbols:
 *
 *   • src/components/changes/repeat-citation-act3.tsx
 *     (the customer-safe render component)
 *   • src/app/(shell)/changes/[id]/page.tsx
 *     (the server-side loader call site)
 *   • src/app/(shell)/changes/[id]/change-detail-v2-client.tsx
 *     (the v2 client that consumes the rendered component)
 *
 * Every OTHER customer-surface file in the scan tree is still
 * forbidden from referencing the repeat-citation symbols
 * (`repeat-citation`, `repeatCitation`, `RepeatCitation`,
 * `loadRepeatCitationForEdit`, `computeRepeatCitation`). When
 * Section 5.B Slice 2 (Today tile) ships, its files extend the
 * allowlist; the ban on everything else stays permanent.
 *
 * Walks the customer-facing surface tree:
 *   src/app/(shell)/{today,recommendations,changes,prompts,local,competitors}/**
 *   src/components/{today,recommendations,changes,prompts,local}/**
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

/**
 * Section 5.B Slice 1 allowlist — files explicitly permitted to
 * reference the Section 5 symbols. Adding a file here is the
 * structural signal that it is part of a deliberately reviewed
 * customer-facing repeat-citation surface.
 */
const ALLOWED_FILES: ReadonlySet<string> = new Set([
  "src/components/changes/repeat-citation-act3.tsx",
  "src/app/(shell)/changes/[id]/page.tsx",
  "src/app/(shell)/changes/[id]/change-detail-v2-client.tsx",
]);

describe("Architecture — no customer-surface references to repeat-citation symbols (with Section 5.B allowlist)", () => {
  for (const rel of ALL_FILES) {
    if (ALLOWED_FILES.has(rel)) continue;
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
            `${rel}: customer surface references repeat-citation symbol '${token}' but is not in the Section 5.B allowlist.\n` +
              `Section 5.B Slice 1 allowlist: src/components/changes/repeat-citation-act3.tsx,\n` +
              `  src/app/(shell)/changes/[id]/page.tsx,\n` +
              `  src/app/(shell)/changes/[id]/change-detail-v2-client.tsx.\n` +
              `Adding a new allowlisted file means a deliberately reviewed surface — update the allowlist and the catalog row alongside.\n` +
              `Excerpt: ...${active.slice(start, end)}...`,
          );
        }
        expect(idx).toBe(-1);
      });
    }
  }

  for (const allowed of ALLOWED_FILES) {
    it(`allowlisted file exists: ${allowed}`, () => {
      // Sanity — every entry in the allowlist must exist on disk
      // so a future rename forces an explicit allowlist update.
      const exists = ALL_FILES.includes(allowed);
      expect(exists, `${allowed} not found in scan tree`).toBe(true);
    });
  }
});
