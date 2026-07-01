/**
 * Architecture invariant — Section 5.A / no customer surface
 * references repeat-citation symbols, EXCEPT the explicitly
 * allowlisted Section 5.B customer-facing files (2026-05-16 —
 * transitioned from blanket ban to allowlist; EXTENDED 2026-05-21
 * with Section 5.B Slice 2 Today tile files).
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
 * Section 5.B Slice 2 (Today edit-lifecycle tile band counter)
 * adds two further allowlisted files (2026-05-21):
 *
 *   • src/components/today/edit-lifecycle-tile.tsx
 *     (extended tile component — renders the band counter section)
 *   • src/app/(shell)/today-v2-sections.tsx
 *     (server section that threads `repeat_citation_30d` from the
 *     summary loader to the tile)
 *
 * Every OTHER customer-surface file in the scan tree is still
 * forbidden from referencing the repeat-citation symbols
 * (`repeat-citation`, `repeatCitation`, `RepeatCitation`,
 * `loadRepeatCitationForEdit`, `computeRepeatCitation`). Adding
 * a new allowlisted file means a deliberately reviewed surface
 * — update the allowlist below AND the catalog row alongside.
 *
 * Walks the customer-facing surface tree:
 *   src/app/(shell)/{today,recommendations,changes,prompts,local,competitors}/**
 *   src/components/{today,recommendations,changes,prompts,local}/**
 *   PLUS the file src/app/(shell)/today-v2-sections.tsx specifically
 *   (lives directly under (shell), outside the per-feature subtrees).
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

/**
 * Single-file additions to the scan set — files that sit OUTSIDE
 * the per-feature subtrees (`src/app/(shell)/today/`, etc.) but
 * still render to customer surfaces and therefore must be covered
 * by the forbidden-vocab + allowlist contract.
 *
 * Section 5.B Slice 2 (2026-05-21): `today-v2-sections.tsx` is a
 * server-component module living directly under `src/app/(shell)/`
 * (not under `today/`) but it composes the Today page sections —
 * customer-facing surface. Adding it here ensures the allowlist
 * + forbidden-token scan apply to it.
 */
// Move 5 (2026-07-01): today-v2-sections.tsx was removed with the homepage fold;
// no extra scan files remain beyond the customer-surface roots below.
const ADDITIONAL_SCAN_FILES: ReadonlyArray<string> = [] as const;

const ALL_FILES: string[] = [];
for (const root of CUSTOMER_SURFACE_ROOTS) ALL_FILES.push(...walk(root));
for (const rel of ADDITIONAL_SCAN_FILES) {
  // Only add the additional file if it actually exists on disk —
  // a deleted file would otherwise spuriously fail the existence
  // sanity check below.
  try {
    statSync(resolve(REPO_ROOT, rel));
    ALL_FILES.push(rel);
  } catch {
    // file missing — skip (caught by the allowlist-exists test if
    // the file is in ALLOWED_FILES).
  }
}

/**
 * Section 5.B Slice 1 + Slice 2 allowlist — files explicitly
 * permitted to reference the Section 5 symbols. Adding a file
 * here is the structural signal that it is part of a deliberately
 * reviewed customer-facing repeat-citation surface.
 *
 * Slice 1 (2026-05-16): Changes detail Act 3 sub-line (3 files).
 * Slice 2 (2026-05-21): Today edit-lifecycle tile band counter (2 files).
 */
const ALLOWED_FILES: ReadonlySet<string> = new Set([
  // 5.B Slice 1 — Changes detail Act 3 sub-line
  "src/components/changes/repeat-citation-act3.tsx",
  "src/app/(shell)/changes/[id]/page.tsx",
  "src/app/(shell)/changes/[id]/change-detail-v2-client.tsx",
  // 5.B Slice 2 — Today edit-lifecycle tile band counter
  "src/components/today/edit-lifecycle-tile.tsx",
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
