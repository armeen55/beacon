/**
 * Architecture invariant — Slice 4.5.B.α₂.2 (2026-05-19):
 * recommendation-trigger page-classifier applied.
 *
 * Pins the philosophy that EVERY trigger predicate must pass
 * through the universal page-intelligence/applicability layer
 * before emitting a candidate. Operator-locked principle from the
 * α₂.2 scope: every website is different (billions of
 * variations); the system MUST stay pattern-based and config-
 * driven, never tenant-specific slug-hardcoded.
 *
 * Pinned source files:
 *   • `src/domains/recommendation-intelligence/triggers/*.ts`
 *   • `src/domains/recommendation-intelligence/page-classifier.ts`
 *
 * Contract (all asserted via source-text scan, comments stripped):
 *
 *   1. Every predicate file under `triggers/` imports at least one
 *      export from `../page-classifier` (`isNonHtmlAsset` or
 *      `classifyPageType`). Future predicates that intentionally
 *      opt out must add an explicit `/** @no-classifier-required:
 *      <reason> *​/` JSDoc tag to the predicate function — until
 *      then, importing the classifier is the contract.
 *
 *   2. `title-h1-mismatch.ts` MUST reference `classifyPageType`
 *      AND restrict emission to the homepage/city/service set.
 *      Pinned via a regex match on the page-type allowlist
 *      literal in the predicate body.
 *
 *   3. `weak-h1.ts` MUST reference `classifyPageType` AND MUST
 *      NOT contain the old inline `classifyForGate` helper name
 *      (regression guard — pre-α₂.2 the substring-based gate
 *      false-positive'd on hub URLs).
 *
 *   4. Predicate source files MUST NOT contain hardcoded tenant-
 *      specific URL slugs ("ritz", "atherton", "palo-alto",
 *      "menlo-park", "whole-home-remodel", "ritzbuilders").
 *      Defense against future drift toward a tenant-specific
 *      blacklist.
 *
 *   5. Predicate source files MUST NOT contain a hardcoded
 *      utility-page slug blacklist as a Set / array literal
 *      named like `UTILITY_*` / `SUPPRESS_*` / `BLACKLIST_*`
 *      outside the shared page-classifier module. Forces utility-
 *      page handling to flow through the central classifier so it
 *      stays generic.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const TRIGGERS_DIR = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "triggers",
);
const TITLE_H1_MISMATCH_PATH = resolve(
  TRIGGERS_DIR,
  "title-h1-mismatch.ts",
);
const WEAK_H1_PATH = resolve(TRIGGERS_DIR, "weak-h1.ts");
const PAGE_CLASSIFIER_PATH = resolve(
  REPO_ROOT,
  "src",
  "domains",
  "recommendation-intelligence",
  "page-classifier.ts",
);

function read(path: string): string {
  return readFileSync(path, "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function listPredicateFiles(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(TRIGGERS_DIR)) {
    const full = resolve(TRIGGERS_DIR, name);
    if (statSync(full).isDirectory()) continue;
    if (name.endsWith(".test.ts")) continue;
    if (!name.endsWith(".ts")) continue;
    out.push(full);
  }
  return out.sort();
}

describe("recommendation-triggers-page-classifier-applied", () => {
  const predicates = listPredicateFiles();

  it("predicate directory is non-empty", () => {
    expect(predicates.length).toBeGreaterThanOrEqual(7);
  });

  // ── Rule 1: every predicate imports from page-classifier ────────────

  it("every predicate file imports at least one export from ../page-classifier", () => {
    const offenders: string[] = [];
    const importPattern =
      /import\s*\{[^}]*\b(?:isNonHtmlAsset|classifyPageType)\b[^}]*\}\s*from\s*["']\.\.\/page-classifier["']/;
    for (const file of predicates) {
      const active = stripComments(read(file));
      // Allow explicit opt-out via JSDoc tag (forward-compat).
      const raw = read(file);
      if (raw.includes("@no-classifier-required")) continue;
      if (!importPattern.test(active)) {
        offenders.push(file.replace(REPO_ROOT + "/", ""));
      }
    }
    expect(
      offenders,
      `Each predicate must import isNonHtmlAsset or classifyPageType from ../page-classifier (or opt out with a JSDoc @no-classifier-required tag). Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  // ── Rule 2: title-h1-mismatch uses classifyPageType + allowlist ─────

  it("title-h1-mismatch.ts references `classifyPageType`", () => {
    const src = stripComments(read(TITLE_H1_MISMATCH_PATH));
    expect(src).toContain("classifyPageType");
  });

  it("title-h1-mismatch.ts restricts emission to homepage / city / service via the allowlist", () => {
    const src = stripComments(read(TITLE_H1_MISMATCH_PATH));
    // The allowlist guard pattern checks `pageType !== "homepage"
    // && pageType !== "city" && pageType !== "service"` in some
    // ordering. Match each forbidden-set member individually so
    // ordering of the && clauses doesn't matter.
    for (const allowed of ["homepage", "city", "service"]) {
      expect(
        src.includes(`"${allowed}"`),
        `title-h1-mismatch.ts must reference allowed page type "${allowed}"`,
      ).toBe(true);
    }
  });

  // ── Rule 3: weak-h1 uses classifyPageType + no inline classifyForGate

  it("weak-h1.ts references `classifyPageType`", () => {
    const src = stripComments(read(WEAK_H1_PATH));
    expect(src).toContain("classifyPageType");
  });

  it("weak-h1.ts does NOT contain the old inline `classifyForGate` helper (regression guard)", () => {
    const src = stripComments(read(WEAK_H1_PATH));
    expect(src).not.toContain("classifyForGate");
  });

  it("weak-h1.ts does NOT contain a bare substring `path.includes(\"/location` check (forces classifier delegation)", () => {
    const src = stripComments(read(WEAK_H1_PATH));
    // The pre-α₂.2 inline gate used `path.includes(urlPatterns.city)`
    // which was the source of the hub false-positive. Forbid bare
    // `.includes("/locations` / `.includes("/services` /
    // `.includes("/projects` patterns in the predicate body — the
    // classifier owns prefix matching now.
    expect(src).not.toMatch(/\.includes\(\s*["']\/locations/);
    expect(src).not.toMatch(/\.includes\(\s*["']\/services/);
    expect(src).not.toMatch(/\.includes\(\s*["']\/projects/);
  });

  // ── Rule 4: no hardcoded tenant-specific slugs in predicate source ──

  const FORBIDDEN_TENANT_SLUGS: ReadonlyArray<string> = [
    "ritz",
    "ritzbuilders",
    "atherton",
    "palo-alto",
    "palo alto",
    "menlo park",
    "menlo-park",
    "whole-home-remodel",
  ];

  it.each(FORBIDDEN_TENANT_SLUGS)(
    "no predicate source file contains the tenant-specific slug '%s'",
    (slug) => {
      const offenders: string[] = [];
      for (const file of predicates) {
        const active = stripComments(read(file));
        if (active.toLowerCase().includes(slug.toLowerCase())) {
          offenders.push(file.replace(REPO_ROOT + "/", ""));
        }
      }
      expect(
        offenders,
        `Predicate source must not reference tenant-specific slug '${slug}'. Offenders: ${offenders.join(", ")}`,
      ).toEqual([]);
    },
  );

  // Page-classifier itself MAY (and does) reference generic English
  // utility patterns ("privacy", "about", etc.) — those are universal,
  // not tenant-specific. But the predicates themselves should never
  // need to know about specific tenant slugs.

  // ── Rule 5: no hardcoded utility-page blacklist outside classifier ──

  it("no predicate source file declares its own utility/suppress/blacklist literal", () => {
    // Forbid Set / array literals named like UTILITY_PATTERNS /
    // SUPPRESS_URLS / BLACKLIST / EXCLUDED_PAGES outside the
    // central classifier. Forces tenant-agnostic patterns to flow
    // through one source of truth.
    const offenders: string[] = [];
    const bannedNamePattern =
      /(?:const|let|var)\s+(UTILITY_[A-Z_]+|SUPPRESS_[A-Z_]+|BLACKLIST[A-Z_]*|EXCLUDED_[A-Z_]+)\s*[:=]/;
    for (const file of predicates) {
      const active = stripComments(read(file));
      const m = active.match(bannedNamePattern);
      if (m) {
        offenders.push(
          `${file.replace(REPO_ROOT + "/", "")} declares '${m[1]}'`,
        );
      }
    }
    expect(
      offenders,
      `Utility/suppress patterns must live in page-classifier.ts only. Offenders: ${offenders.join(", ")}`,
    ).toEqual([]);
  });

  // ── Page-classifier sanity (single source of truth lives here) ──────

  it("page-classifier.ts exists and exports `classifyPageType` + `isNonHtmlAsset`", () => {
    const src = stripComments(read(PAGE_CLASSIFIER_PATH));
    expect(src).toContain("export function classifyPageType");
    expect(src).toContain("export function isNonHtmlAsset");
  });
});
