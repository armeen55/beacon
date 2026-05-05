/**
 * D2 (operator audit, 2026-05-05) — /settings/import default surface is
 * customer-safe.
 *
 * Pre-D2: the default page header read "Place historical citation CSVs
 * on the server under .data/ and run the batch importer", and a large
 * "Batch import — historical citation CSVs" card was always visible
 * with `.data/` filesystem references and "Bridged results" / internal-
 * tooling copy. A non-technical SMB owner walking the product would
 * land here looking for "where do I import my data" and read internal
 * Beacon-team copy as if it were customer-facing.
 *
 * Post-D2: the default surface is generic — "Bring in historical
 * AI-answer data" / "For most accounts there's nothing to do here".
 * The Profound batch importer + manual paste + reset + import log all
 * live behind an "Advanced — legacy import paths" disclosure that's
 * collapsed by default. NO Profound, `.data/`, "bridged", or internal-
 * filesystem copy is visible until the operator explicitly opens
 * Advanced.
 *
 * The legacy controls remain reachable — none of the actions are
 * deleted. The ONLY change is visibility-by-default.
 *
 * Source-text invariant rather than full DOM render: the import-page is
 * a `"use client"` component with hooks (`useState`, `useTransition`,
 * `useEffect`) that don't render under vitest's renderToStaticMarkup
 * without a heavy fixture stack. Pinning the source text is a stronger
 * contract — every customer-facing copy string must live in source, so
 * grepping it is sufficient.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const IMPORT_PAGE_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/settings/import/import-page.tsx",
);

function loadSource(): string {
  return readFileSync(IMPORT_PAGE_PATH, "utf-8");
}

/**
 * Strip /* ... *\/ block comments and // line comments so historical
 * narration in JSDoc isn't mistaken for live customer-facing copy.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Find the substring of the JSX render block that lives BEFORE the first
 * `{advancedOpen && (` block. That's the always-visible default surface.
 * Anything inside `{advancedOpen && (...)}` is gated by the operator
 * clicking the disclosure trigger — those copy strings are explicitly
 * NOT customer-default-visible.
 *
 * The slice STARTS at the `return (` so module-level imports + state
 * setup (which legitimately contain `importProfoundData` / "profound"
 * source identifiers) are excluded.
 */
function defaultSurfaceText(src: string): string {
  const stripped = stripComments(src);
  const returnIdx = stripped.indexOf("return (");
  if (returnIdx < 0) {
    throw new Error("import-page.tsx must contain `return (` — JSX block not found");
  }
  const sliceFrom = returnIdx;
  const advIdx = stripped.indexOf("{advancedOpen && (", sliceFrom);
  if (advIdx < 0) {
    throw new Error(
      "import-page.tsx must contain `{advancedOpen && (` — D2 disclosure trigger not found",
    );
  }
  return stripped.slice(sliceFrom, advIdx);
}

describe("D2 — /settings/import default surface is customer-safe", () => {
  it("default page does NOT mention Profound", () => {
    const def = defaultSurfaceText(loadSource());
    // Case-insensitive — covers "Profound", "profound" (state init for
    // the manual-paste source field — that's gated to Advanced anyway,
    // but we sweep both casings to be safe).
    const lower = def.toLowerCase();
    expect(
      lower.includes("profound"),
      "Default /settings/import surface must NOT contain 'Profound' — D2",
    ).toBe(false);
  });

  it("default page does NOT mention `.data/`, internal filesystem paths, or 'bridged' copy", () => {
    const def = defaultSurfaceText(loadSource());
    const forbidden = [
      ".data/",
      "bridged",
      "Bridged",
      "Run batch import",
      "Batch import",
      "batch importer",
      "Unclassified CSV",
      "Merge semantics",
      "post-import setup",
    ];
    const violations = forbidden.filter((f) => def.includes(f));
    expect(
      violations,
      `Default /settings/import surface must NOT contain internal-tooling copy. Found: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("default page uses customer-safe copy", () => {
    const def = defaultSurfaceText(loadSource());
    // Both phrases exist verbatim — pin them so they cannot be reverted.
    expect(
      def.includes("Import historical answer data"),
      "Default page header must read 'Import historical answer data' (D2)",
    ).toBe(true);
    expect(
      def.includes("Bring in historical AI-answer data"),
      "Default page must include the customer-safe section heading 'Bring in historical AI-answer data' (D2)",
    ).toBe(true);
  });

  it("Advanced disclosure trigger is present (operators with legacy data still reach it)", () => {
    const src = stripComments(loadSource());
    expect(
      src.includes("Advanced — legacy import paths"),
      "/settings/import must show an 'Advanced — legacy import paths' disclosure trigger (D2)",
    ).toBe(true);
  });

  it("Profound importer code path is preserved (not deleted, just gated)", () => {
    const src = loadSource();
    // The action import + the `Run batch import` button source MUST still
    // exist somewhere in the file — they're now inside the `{advancedOpen && (...)}`
    // block. We just verify the controls are still reachable in source.
    expect(src.includes("importProfoundData")).toBe(true);
    expect(src.includes("Run batch import")).toBe(true);
  });

  it("Profound batch importer copy lives BEHIND the advanced disclosure (not in default surface)", () => {
    const src = stripComments(loadSource());
    const triggerIdx = src.indexOf("{advancedOpen && (");
    const profoundButtonIdx = src.indexOf("Run batch import");
    expect(triggerIdx).toBeGreaterThan(0);
    expect(profoundButtonIdx).toBeGreaterThan(0);
    expect(
      profoundButtonIdx,
      "'Run batch import' button must appear AFTER the {advancedOpen && (} trigger — D2",
    ).toBeGreaterThan(triggerIdx);
  });
});
