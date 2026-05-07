/**
 * Architecture invariant — Trust Sprint T6.6 (2026-05-06).
 *
 * Pins the canonical URL normalizer at `src/lib/url/normalize.ts`. The
 * helper was extracted from `src/domains/product/url-citation-history.ts`
 * so analysis scripts + future write-time callers can import it without
 * pulling in citation-history's transitive dependencies.
 *
 * Contract pinned by this invariant:
 *
 *   1. `src/lib/url/normalize.ts` exists and exports `normalizeUrl`.
 *   2. `src/domains/product/url-citation-history.ts` re-exports
 *      `normalizeUrl` from the canonical location (back-compat — every
 *      historical importer keeps working).
 *   3. Analysis scripts import from the canonical location, not from
 *      url-citation-history (avoid the heavy transitive tree).
 *   4. The canonical file has zero domain imports — pure stdlib only.
 *
 * Behavioral tests of the helper itself live in
 * `src/lib/url/normalize.test.ts`. This invariant only pins the
 * cross-file wiring + import discipline.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const NORMALIZE_PATH = join(REPO_ROOT, "src/lib/url/normalize.ts");
const URL_CITATION_HISTORY_PATH = join(
  REPO_ROOT,
  "src/domains/product/url-citation-history.ts",
);
const REC_ANALYZER_PATH = join(
  REPO_ROOT,
  "scripts/analyze-recommendation-outcomes.ts",
);

describe("T6.6 — canonical URL normalizer location", () => {
  it("src/lib/url/normalize.ts exists", () => {
    expect(existsSync(NORMALIZE_PATH)).toBe(true);
  });

  it("canonical file exports normalizeUrl", () => {
    const src = readFileSync(NORMALIZE_PATH, "utf-8");
    expect(/export function normalizeUrl\(/.test(src)).toBe(true);
  });

  it("canonical file has no domain imports (pure stdlib)", () => {
    const src = readFileSync(NORMALIZE_PATH, "utf-8");
    // No imports from @/domains/* or @/storage/* — keep helper standalone.
    expect(/from\s+["']@\/domains\//.test(src)).toBe(false);
    expect(/from\s+["']@\/storage\//.test(src)).toBe(false);
    expect(/from\s+["']\.\.\/\.\.\/domains\//.test(src)).toBe(false);
  });

  it("url-citation-history re-exports normalizeUrl from the canonical path", () => {
    const src = readFileSync(URL_CITATION_HISTORY_PATH, "utf-8");
    // Two valid forms: re-export-from in one statement, OR
    // import + named export in two statements. Both keep historical
    // importers working. The contract is: external callers can still
    // do `import { normalizeUrl } from "@/domains/product/url-citation-history"`
    // and get the canonical helper.
    const reexportSingle =
      /export\s*\{\s*normalizeUrl\s*\}\s*from\s+["']@\/lib\/url\/normalize["']/.test(
        src,
      );
    const importThenExport =
      /import\s*\{\s*normalizeUrl\s*\}\s*from\s+["']@\/lib\/url\/normalize["']/.test(
        src,
      ) && /export\s*\{\s*normalizeUrl\s*\}/.test(src);
    expect(
      reexportSingle || importThenExport,
      "url-citation-history.ts must re-export normalizeUrl from @/lib/url/normalize so historical importers keep working without an in-file copy. Either single-line `export { normalizeUrl } from \"@/lib/url/normalize\";` or two-line `import { normalizeUrl } from \"@/lib/url/normalize\"; export { normalizeUrl };` is accepted.",
    ).toBe(true);
  });

  it("url-citation-history does NOT define normalizeUrl in-file (no in-file copy)", () => {
    const src = readFileSync(URL_CITATION_HISTORY_PATH, "utf-8");
    // Negative invariant: catch a future regression where someone
    // re-implements normalizeUrl in this file. Only the canonical
    // helper is allowed.
    expect(/export\s+function\s+normalizeUrl\(/.test(src)).toBe(false);
  });

  it("rec-outcome analyzer imports from canonical location, not url-citation-history", () => {
    const src = readFileSync(REC_ANALYZER_PATH, "utf-8");
    expect(/from\s+["']\.\.\/src\/lib\/url\/normalize["']/.test(src)).toBe(true);
    expect(
      /import.*normalizeUrl.*from\s+["'][^"']*url-citation-history["']/.test(src),
    ).toBe(false);
  });
});
