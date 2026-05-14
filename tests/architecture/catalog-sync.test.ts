/**
 * Architecture invariant — Section 12.1 (2026-05-14).
 *
 * Catalog-sync invariant. Bidirectional referential integrity
 * between the architecture-test directory and the catalog at
 * `docs/ARCHITECTURE_INVARIANTS_CATALOG.md`.
 *
 * Contract enforced (structural only — content review is human-gated):
 *   1. Every `.test.ts` file under `tests/architecture/` is
 *      referenced exactly once in the catalog (source-file column).
 *   2. Every catalog source-file reference resolves to an existing
 *      `.test.ts` file under `tests/architecture/`.
 *   3. No duplicate listings in the catalog.
 *
 * This file is itself an architecture invariant, so the catalog has
 * a row for `tests/architecture/catalog-sync.test.ts`. The fixed-
 * point check below confirms self-reference is present.
 *
 * Failure modes the sync test catches:
 *   - "I added a new architecture test but forgot to catalog it"
 *     → missing-from-catalog assertion fires.
 *   - "I retired an invariant by deleting the test file but left
 *     the catalog row" → missing-from-disk assertion fires.
 *   - "I copy-pasted a catalog row and changed only the name" →
 *     duplicate-source-file assertion fires.
 *
 * Failure modes the sync test deliberately does NOT catch:
 *   - The *purpose* one-sentence column is wrong / stale → human
 *     reviewer must catch.
 *   - The *retirement-condition* is wrong → human reviewer.
 *   - The *last-verified* date hasn't been touched in a year →
 *     human reviewer (date-based churn would be noise).
 *   - The *status* field doesn't match reality → human reviewer
 *     (the `active` / `retired` semantics are a soft contract).
 *
 * To retire an invariant cleanly: delete the test file AND the
 * catalog row in the same PR. To rewrite an invariant: keep the
 * test file, edit the catalog row's `status` / retirement-condition
 * / last-verified fields. The sync test passes either way.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const ARCH_DIR = resolve(REPO_ROOT, "tests", "architecture");
const CATALOG_PATH = resolve(
  REPO_ROOT,
  "docs",
  "ARCHITECTURE_INVARIANTS_CATALOG.md",
);

const CATALOG_SOURCE = readFileSync(CATALOG_PATH, "utf-8");

// ────────────────────────────────────────────────────────────────────
// Disk side — enumerate `.test.ts` files under tests/architecture/.
// Excludes nested directories and non-test files (catalog-sync is
// itself in this directory, so it's expected to appear).
// ────────────────────────────────────────────────────────────────────

function listTestFiles(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(ARCH_DIR)) {
    const full = resolve(ARCH_DIR, name);
    if (statSync(full).isDirectory()) continue;
    if (name.endsWith(".test.ts")) out.push(name);
  }
  return out.sort();
}

const onDisk = new Set(listTestFiles());

// ────────────────────────────────────────────────────────────────────
// Catalog side — extract every `tests/architecture/<name>.test.ts`
// reference from the source-file column of catalog TABLE ROWS only.
// Prose references in the header / introduction are intentionally
// ignored (the catalog's intro mentions the sync test by path as
// context, which is a documentation reference, not a row entry).
//
// Row shape (markdown table):
//   | name | `tests/architecture/<name>.test.ts` | section | … |
//
// Every row line starts with `|` and contains at least one inline-
// code source-file reference inside the row.
// ────────────────────────────────────────────────────────────────────

function extractCatalogSourceFiles(src: string): string[] {
  const hits: string[] = [];
  for (const rawLine of src.split("\n")) {
    const line = rawLine.trim();
    // Restrict to lines that LOOK like table data rows: start + end
    // with `|`, contain at least one cell separator. Excludes header
    // lines (`| name | source test file | … |` and `|---|...|`).
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (line.includes("source test file")) continue; // header row
    if (line.startsWith("|---") || line.startsWith("| ---")) continue; // separator
    if (/^\|\s*-+\s*\|/.test(line)) continue; // separator variant
    const m = line.match(
      /`tests\/architecture\/([A-Za-z0-9._-]+\.test\.ts)`/,
    );
    if (m) hits.push(m[1]!);
  }
  return hits;
}

const catalogReferences = extractCatalogSourceFiles(CATALOG_SOURCE);
const catalogReferencesSet = new Set(catalogReferences);

// ────────────────────────────────────────────────────────────────────
// Helpers used by multiple assertions.
// ────────────────────────────────────────────────────────────────────

function symmetricDifference<T>(a: Set<T>, b: Set<T>): { onlyA: T[]; onlyB: T[] } {
  const onlyA: T[] = [];
  const onlyB: T[] = [];
  for (const x of a) if (!b.has(x)) onlyA.push(x);
  for (const x of b) if (!a.has(x)) onlyB.push(x);
  return { onlyA: onlyA.sort(), onlyB: onlyB.sort() };
}

function duplicates<T>(arr: T[]): T[] {
  const seen = new Set<T>();
  const dups = new Set<T>();
  for (const x of arr) {
    if (seen.has(x)) dups.add(x);
    seen.add(x);
  }
  return [...dups].sort();
}

// ────────────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────────────

describe("Architecture catalog sync (Section 12.1)", () => {
  it("the catalog file exists at the canonical path", () => {
    // Reading at module load already proves existence; this
    // assertion documents the contract for human readers.
    expect(CATALOG_SOURCE.length).toBeGreaterThan(0);
  });

  it("at least one architecture test file exists on disk (sanity)", () => {
    expect(onDisk.size).toBeGreaterThan(0);
  });

  it("the catalog references at least one source file (sanity)", () => {
    expect(catalogReferences.length).toBeGreaterThan(0);
  });

  it("every architecture test file on disk is referenced in the catalog", () => {
    const { onlyA: missingFromCatalog } = symmetricDifference(
      onDisk,
      catalogReferencesSet,
    );
    expect(
      missingFromCatalog,
      `These test files exist on disk but are NOT referenced in docs/ARCHITECTURE_INVARIANTS_CATALOG.md — add a row for each:\n${missingFromCatalog.map((f) => `  - ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("every catalog reference resolves to an existing test file on disk", () => {
    const { onlyA: missingFromDisk } = symmetricDifference(
      catalogReferencesSet,
      onDisk,
    );
    expect(
      missingFromDisk,
      `These test files are referenced in docs/ARCHITECTURE_INVARIANTS_CATALOG.md but do NOT exist on disk — either restore the file or remove the catalog row:\n${missingFromDisk.map((f) => `  - ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("the catalog does not list the same source file twice", () => {
    const dups = duplicates(catalogReferences);
    expect(
      dups,
      `These source files are referenced more than once in the catalog (each invariant must have exactly one row):\n${dups.map((f) => `  - ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("the catalog row count equals the on-disk test file count", () => {
    // Redundant with the four-way set equality above, but a single-
    // number summary is the most useful regression signal — a
    // refactor that drops 10 invariants without updating the
    // catalog trips here in one line.
    expect(catalogReferencesSet.size).toBe(onDisk.size);
  });

  it("the catalog has a self-referential entry for this sync test", () => {
    // Catches the bootstrapping mistake where someone writes the
    // sync test but forgets to add a catalog row for it.
    expect(catalogReferencesSet.has("catalog-sync.test.ts")).toBe(true);
  });
});
