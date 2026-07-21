/**
 * CONSTITUTION §13 — Catalog-sync mechanism.
 *
 * Bidirectional referential integrity between the (now constitutional)
 * architecture-test directory and docs/ARCHITECTURE_INVARIANTS_CATALOG.md.
 * Structural only (content review is human-gated):
 *   1. Every `.test.ts` file under tests/architecture/ is referenced
 *      exactly once in the catalog.
 *   2. Every catalog reference resolves to an existing file on disk.
 *   3. No duplicates; row count equals on-disk count.
 * This file is itself constitutional, so the catalog has a row for it —
 * the self-reference check confirms that.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const ARCH_DIR = resolve(REPO_ROOT, "tests", "architecture");
const CATALOG_PATH = resolve(REPO_ROOT, "docs", "ARCHITECTURE_INVARIANTS_CATALOG.md");
const CATALOG_SOURCE = readFileSync(CATALOG_PATH, "utf-8");

/** This file's own basename — the self-reference the catalog must carry. */
const SELF = "25-catalog-sync.test.ts";

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

function extractCatalogSourceFiles(src: string): string[] {
  const hits: string[] = [];
  for (const rawLine of src.split("\n")) {
    const line = rawLine.trim();
    if (!line.startsWith("|") || !line.endsWith("|")) continue;
    if (line.includes("source test file")) continue;
    if (line.startsWith("|---") || line.startsWith("| ---")) continue;
    if (/^\|\s*-+\s*\|/.test(line)) continue;
    const m = line.match(/`tests\/architecture\/([A-Za-z0-9._-]+\.test\.ts)`/);
    if (m) hits.push(m[1]!);
  }
  return hits;
}

const catalogReferences = extractCatalogSourceFiles(CATALOG_SOURCE);
const catalogReferencesSet = new Set(catalogReferences);

function symmetricDifference<T>(a: Set<T>, b: Set<T>): { onlyA: T[] } {
  const onlyA: T[] = [];
  for (const x of a) if (!b.has(x)) onlyA.push(x);
  return { onlyA: onlyA.sort() };
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

describe("Architecture catalog sync (constitution §13)", () => {
  it("the catalog file exists and references at least one source file", () => {
    expect(CATALOG_SOURCE.length).toBeGreaterThan(0);
    expect(catalogReferences.length).toBeGreaterThan(0);
    expect(onDisk.size).toBeGreaterThan(0);
  });

  it("every architecture test file on disk is referenced in the catalog", () => {
    const { onlyA: missingFromCatalog } = symmetricDifference(onDisk, catalogReferencesSet);
    expect(
      missingFromCatalog,
      `On disk but not cataloged — add a row for each:\n${missingFromCatalog.map((f) => `  - ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("every catalog reference resolves to an existing test file on disk", () => {
    const { onlyA: missingFromDisk } = symmetricDifference(catalogReferencesSet, onDisk);
    expect(
      missingFromDisk,
      `Cataloged but missing on disk — restore or remove the row:\n${missingFromDisk.map((f) => `  - ${f}`).join("\n")}`,
    ).toEqual([]);
  });

  it("the catalog does not list the same source file twice", () => {
    expect(duplicates(catalogReferences)).toEqual([]);
  });

  it("the catalog row count equals the on-disk test file count", () => {
    expect(catalogReferencesSet.size).toBe(onDisk.size);
  });

  it("the catalog has a self-referential entry for this sync test", () => {
    expect(catalogReferencesSet.has(SELF)).toBe(true);
  });
});
