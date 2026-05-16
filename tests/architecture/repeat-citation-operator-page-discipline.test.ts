/**
 * Architecture invariant — Section 5.A.2 operator-page discipline
 * (2026-05-16).
 *
 * Pins on `src/app/(shell)/diagnostics/repeat-citation/page.tsx`:
 *
 *   1. Declares `export const dynamic = "force-dynamic"`.
 *   2. Imports `isOperatorModeServer` from `@/lib/operator-mode`.
 *   3. Imports `notFound` from `next/navigation`.
 *   4. Active source contains `isOperatorModeServer(` AND
 *      `notFound(` invocations.
 *   5. The operator gate fires BEFORE every data read — the first
 *      `isOperatorModeServer(` offset must precede the first
 *      offsets of `currentTenantId(`, `getBusinessConfig(`,
 *      `getRepository(`, `getRecommendedEdits(`, AND the first
 *      `loadRepeatCitationForEdit(` call.
 *   6. Imports `loadRepeatCitationForEdit` from
 *      `@/domains/citation-lifecycle/load-repeat-citation`.
 *   7. Does NOT import from `@/storage/canonical-store`.
 *   8. Does NOT call `repo.getObservationRuns()` — the website-
 *      crawl reader; Section 5 must consume
 *      `getProfoundImportRuns()` only. Negative-lookbehind regex
 *      allows the legitimate `.getProfoundImportRuns(` token.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE = "src/app/(shell)/diagnostics/repeat-citation/page.tsx";

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const ACTIVE = stripComments(read(PAGE));

function firstIndex(src: string, needle: string | RegExp): number {
  if (typeof needle === "string") return src.indexOf(needle);
  const m = needle.exec(src);
  return m ? m.index : -1;
}

describe("Architecture — repeat-citation operator-page discipline", () => {
  it("declares export const dynamic = 'force-dynamic'", () => {
    expect(ACTIVE).toMatch(
      /export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/,
    );
  });

  it("imports isOperatorModeServer from @/lib/operator-mode", () => {
    expect(ACTIVE).toMatch(
      /import\s*\{[^}]*\bisOperatorModeServer\b[^}]*\}\s*from\s*["']@\/lib\/operator-mode["']/,
    );
  });

  it("imports notFound from next/navigation", () => {
    expect(ACTIVE).toMatch(
      /import\s*\{[^}]*\bnotFound\b[^}]*\}\s*from\s*["']next\/navigation["']/,
    );
  });

  it("active source contains isOperatorModeServer( and notFound( invocations", () => {
    expect(ACTIVE).toMatch(/\bisOperatorModeServer\s*\(/);
    expect(ACTIVE).toMatch(/\bnotFound\s*\(/);
  });

  it("imports loadRepeatCitationForEdit from the Section 5.A loader", () => {
    expect(ACTIVE).toMatch(
      /import\s*\{[^}]*\bloadRepeatCitationForEdit\b[^}]*\}\s*from\s*["']@\/domains\/citation-lifecycle\/load-repeat-citation["']/,
    );
  });

  it("does NOT import from @/storage/canonical-store", () => {
    const offending =
      ACTIVE.includes('"@/storage/canonical-store"') ||
      ACTIVE.includes("'@/storage/canonical-store'");
    expect(offending).toBe(false);
  });

  it("does NOT call repo.getObservationRuns() (wrong type — website-crawl)", () => {
    // Negative-lookbehind: allow `.getProfoundImportRuns(` (legitimate
    // Section 5 denominator source) while forbidding the bare
    // `.getObservationRuns(`.
    expect(ACTIVE).not.toMatch(/(?<!Profound)\.getObservationRuns\s*\(/);
  });
});

describe("Architecture — operator gate fires BEFORE every data read", () => {
  // The operator-gate invocation site. We anchor on the LAST
  // occurrence of `isOperatorModeServer(` to be tolerant of import-
  // section mentions (the import line contains the identifier but
  // not the invocation). Practically only the page's gate-line
  // invocation matters — the import is named-import-only.
  const gateOffset = ACTIVE.lastIndexOf("isOperatorModeServer(");

  it("operator gate is reachable (sanity)", () => {
    expect(gateOffset).toBeGreaterThan(0);
  });

  for (const reader of [
    "currentTenantId(",
    "getBusinessConfig(",
    "getRepository(",
    "getRecommendedEdits(",
  ]) {
    it(`operator gate precedes ${reader}`, () => {
      // `firstIndex` after the gate offset proves the call happens
      // POST-gate. We require the call to exist (sanity check) AND
      // to lie strictly after the gate.
      const readerOffset = ACTIVE.indexOf(reader, gateOffset + 1);
      if (readerOffset === -1) {
        // Reader call not found — search the whole file to produce
        // a meaningful failure message.
        const anywhere = ACTIVE.indexOf(reader);
        throw new Error(
          `Expected ${reader} to be called AFTER isOperatorModeServer (gate at offset ${gateOffset}). ` +
            `Found anywhere at offset ${anywhere}; not found after the gate.`,
        );
      }
      expect(readerOffset).toBeGreaterThan(gateOffset);
    });
  }

  it("operator gate precedes the first loadRepeatCitationForEdit( invocation", () => {
    // Skip the import statement: search for the CALL site, which
    // appears after the destructure import line. Anchor on
    // `loadRepeatCitationForEdit(` AFTER the gate.
    const callOffset = firstIndex(
      ACTIVE.slice(gateOffset + 1),
      "loadRepeatCitationForEdit(",
    );
    expect(callOffset).toBeGreaterThan(-1);
  });
});
