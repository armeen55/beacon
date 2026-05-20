/**
 * Architecture invariant — Section 9 Today tile (2026-05-19).
 *
 * `load-outcomes-summary-for-tenant.ts` MUST NOT trigger a live GA4
 * Data API call on Today page render. The Today tile reads cached
 * `ga4_url_traffic` rows via Supabase admin ONLY; the only way
 * fresh GA4 data lands in production is operator-clicked Refresh on
 * `/diagnostics/outcome-attribution` (9.A2γ).
 *
 * Pins (loader):
 *   • Type-only import of `Ga4UrlTrafficRow` ALLOWED (TypeScript
 *     erases at compile time).
 *   • NO runtime import of `@/lib/connectors/ga4/data-api`,
 *     `@/lib/connectors/ga4/persist-url-traffic`,
 *     `@/lib/connectors/ga4/normalize-page-path`,
 *     `@/lib/connectors/ga4/client`,
 *     `@/lib/connectors/ga4/property-selection`.
 *   • NO runtime import of
 *     `@/app/(shell)/diagnostics/outcome-attribution/actions`.
 *   • NO `fetch(` call (Supabase admin handles its own transport).
 *   • Positive sanity: imports `getSupabaseAdmin` from
 *     `@/lib/persistence/supabase`.
 *   • Positive sanity: imports `computeModeATrafficAttribution` from
 *     `@/domains/outcome-attribution/mode-a-cited-here-traffic-here`.
 *   • Positive sanity: imports `canonicalizeCitationUrl` from
 *     `@/domains/citation-lifecycle/canonicalize-url` (mirrors the
 *     9.A2β.1 URL-scoped SELECT pattern — canonicalize FIRST, then
 *     filter the SQL to candidates).
 *   • Positive sanity: imports `getRepository` from
 *     `@/lib/persistence/repositories` (the only allowed
 *     recommended_edits source).
 *
 * Pins (today-v2-sections.tsx — the only consumer of the loader):
 *   • Imports `loadOutcomesSummaryForTenant`.
 *   • Imports `EditOutcomesTile`.
 *   • NO runtime import of `@/lib/connectors/ga4/*`.
 *   • NO bare GA4 identifier reference (`runGa4UrlTrafficReport` etc).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function runtimeImportLines(src: string): string[] {
  return src
    .split("\n")
    .filter(
      (line) =>
        /^\s*import\b/.test(line) && !/^\s*import\s+type\b/.test(line),
    );
}

const LOADER_PATH = join(
  REPO_ROOT,
  "src/domains/outcome-attribution/load-outcomes-summary-for-tenant.ts",
);
const SECTIONS_PATH = join(REPO_ROOT, "src/app/(shell)/today-v2-sections.tsx");

const LOADER_RAW = readFileSync(LOADER_PATH, "utf-8");
const LOADER_CODE = stripComments(LOADER_RAW);
const SECTIONS_RAW = readFileSync(SECTIONS_PATH, "utf-8");
const SECTIONS_CODE = stripComments(SECTIONS_RAW);

const FORBIDDEN_GA4_IDENTIFIERS: ReadonlyArray<string> = [
  "runGa4UrlTrafficReport",
  "persistGa4UrlTraffic",
  "refreshTenantGa4Traffic",
  "normalizeGa4PagePathToFullUrl",
];

// ─────────────────────────────────────────────────────────────────────
// Loader
// ─────────────────────────────────────────────────────────────────────

describe("load-outcomes-summary-for-tenant — no GA4 API surface", () => {
  const FORBIDDEN_RUNTIME_PATHS: ReadonlyArray<RegExp> = [
    /from\s+["']@\/lib\/connectors\/ga4\/data-api["']/,
    /from\s+["']@\/lib\/connectors\/ga4\/persist-url-traffic["']/,
    /from\s+["']@\/lib\/connectors\/ga4\/normalize-page-path["']/,
    /from\s+["']@\/lib\/connectors\/ga4\/client["']/,
    /from\s+["']@\/lib\/connectors\/ga4\/property-selection["']/,
    /from\s+["']@\/app\/\(shell\)\/diagnostics\/outcome-attribution\/actions["']/,
  ];

  for (const pat of FORBIDDEN_RUNTIME_PATHS) {
    it(`does NOT runtime-import matching ${pat.source}`, () => {
      const runtimeLines = runtimeImportLines(LOADER_CODE);
      const offenders = runtimeLines.filter((l) => pat.test(l));
      expect(offenders).toEqual([]);
    });
  }

  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      const pattern = new RegExp(`\\b${id}\\b`);
      expect(pattern.test(LOADER_CODE)).toBe(false);
    });
  }

  it("does NOT call fetch() directly (Supabase admin owns transport)", () => {
    expect(/\bfetch\s*\(/.test(LOADER_CODE)).toBe(false);
  });

  it("does import getSupabaseAdmin from @/lib/persistence/supabase (positive sanity)", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/supabase["']/.test(LOADER_CODE),
    ).toBe(true);
    expect(/getSupabaseAdmin/.test(LOADER_CODE)).toBe(true);
  });

  it("does import computeModeATrafficAttribution (positive sanity)", () => {
    expect(/computeModeATrafficAttribution/.test(LOADER_CODE)).toBe(true);
  });

  it("does import canonicalizeCitationUrl from @/domains/citation-lifecycle/canonicalize-url (URL-scoped SELECT pattern)", () => {
    expect(
      /from\s+["']@\/domains\/citation-lifecycle\/canonicalize-url["']/.test(
        LOADER_CODE,
      ),
    ).toBe(true);
    expect(/canonicalizeCitationUrl/.test(LOADER_CODE)).toBe(true);
  });

  it("does import getRepository from @/lib/persistence/repositories (positive sanity)", () => {
    expect(
      /from\s+["']@\/lib\/persistence\/repositories["']/.test(LOADER_CODE),
    ).toBe(true);
    expect(/getRepository/.test(LOADER_CODE)).toBe(true);
  });

  it("type-only import of Ga4UrlTrafficRow is allowed AND present", () => {
    expect(
      /import\s+type\s+\{\s*Ga4UrlTrafficRow\s*\}/.test(LOADER_RAW),
    ).toBe(true);
    const runtimeLines = runtimeImportLines(LOADER_CODE);
    const runtimeUrlTrafficRow = runtimeLines.filter((l) =>
      /Ga4UrlTrafficRow/.test(l),
    );
    expect(runtimeUrlTrafficRow).toEqual([]);
  });

  it("declares 'server-only' (NOT optional — loader writes nothing client-side)", () => {
    // Loader doesn't currently declare server-only because its
    // imports (getRepository / getSupabaseAdmin) are themselves
    // server-only. This invariant captures the current posture; if
    // a future refactor adds server-only as belt-and-suspenders, it
    // stays allowed. The critical pin: NEVER import next/cache at
    // module top-level (it's dynamically imported inside the
    // function body to keep the loader safely tree-shakable from
    // any test context).
    expect(
      /from\s+["']next\/cache["']/.test(
        runtimeImportLines(LOADER_CODE).join("\n"),
      ),
      "Loader must NOT statically import next/cache; the dynamic " +
        "import inside the function body is the locked pattern.",
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// Section component (today-v2-sections.tsx) — only allowed consumer
// ─────────────────────────────────────────────────────────────────────

describe("today-v2-sections — outcomes loader consumer", () => {
  it("imports loadOutcomesSummaryForTenant (positive sanity)", () => {
    expect(/loadOutcomesSummaryForTenant/.test(SECTIONS_CODE)).toBe(true);
  });

  it("imports EditOutcomesTile (positive sanity)", () => {
    expect(/EditOutcomesTile/.test(SECTIONS_CODE)).toBe(true);
  });

  it("does NOT runtime-import @/lib/connectors/ga4/*", () => {
    const runtimeLines = runtimeImportLines(SECTIONS_CODE);
    const offenders = runtimeLines.filter((l) =>
      /from\s+["']@\/lib\/connectors\/ga4\//.test(l),
    );
    expect(offenders).toEqual([]);
  });

  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      const pattern = new RegExp(`\\b${id}\\b`);
      expect(pattern.test(SECTIONS_CODE)).toBe(false);
    });
  }
});
