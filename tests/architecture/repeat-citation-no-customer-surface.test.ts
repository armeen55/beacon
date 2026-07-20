/**
 * Architecture invariant — Section 5.A / no customer surface
 * references repeat-citation symbols, EXCEPT the explicitly
 * allowlisted Section 5.B customer-facing files (2026-05-16 —
 * transitioned from blanket ban to allowlist; EXTENDED 2026-05-21
 * with Section 5.B Slice 2 Today tile files).
 *
 * Section 5.B Slice 1 (Changes detail Act 3 sub-line) is HISTORICAL
 * as of the 2026-07-20 bounded orphan sweep — `/changes/[id]`
 * collapsed to a canonical-Results redirect (2026-07-17, commit
 * `19d292c1`) and its two allowlisted render files were deleted as
 * dead code:
 *
 *   • src/components/changes/repeat-citation-act3.tsx (deleted)
 *   • src/app/(shell)/changes/[id]/change-detail-v2-client.tsx (deleted)
 *
 * `src/app/(shell)/changes/[id]/page.tsx` itself no longer references
 * any repeat-citation symbol post-collapse, so it is dropped from the
 * allowlist too — the scan tree simply has nothing left to allow here.
 *
 * Section 5.B Slice 2 (Today edit-lifecycle tile band counter, added
 * 2026-05-21) is HISTORICAL — both of its allowlisted files
 * (`src/components/today/edit-lifecycle-tile.tsx` and
 * `src/app/(shell)/today-v2-sections.tsx`) are deleted: the host was
 * removed in the 2026-06-28 homepage-fold cleanup, and the orphaned
 * tile itself was deleted 2026-07-02 (UX5 legacy sweep).
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
 * Slice 1 (2026-05-16): Changes detail Act 3 sub-line — removed
 * 2026-07-20 (bounded orphan sweep): both allowlisted files were
 * deleted as dead code once `/changes/[id]` collapsed to a
 * canonical-Results redirect (2026-07-17), and the redirect page
 * itself no longer references any repeat-citation symbol.
 * Slice 2 (2026-05-21): Today edit-lifecycle tile band counter (2 files),
 * removed 2026-07-02 (UX5 legacy sweep).
 */
const ALLOWED_FILES: ReadonlySet<string> = new Set([
  // Empty — both Slice 1 and Slice 2 allowlisted files are deleted.
  // Adding a new customer-facing repeat-citation surface means adding
  // its file here AND the matching catalog row.
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
              `The allowlist is currently empty (Slice 1 + Slice 2 files both deleted as dead code).\n` +
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
