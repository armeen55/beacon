/**
 * Architecture invariant — Slice 9.A2β (2026-05-19).
 *
 * Customer-facing Changes detail Mode A path MUST NOT trigger a
 * live GA4 Data API call on render. The customer surface reads
 * cached `ga4_url_traffic` rows via Supabase admin ONLY; the only
 * way fresh GA4 data lands in production is operator-clicked
 * Refresh on `/diagnostics/outcome-attribution` (9.A2γ).
 *
 * Pins per file:
 *
 * 1) `src/components/changes/outcome-attribution-act3.tsx`:
 *    • NO runtime import of `@/lib/connectors/ga4/*`.
 *    • NO runtime import of `runGa4UrlTrafficReport` /
 *      `persistGa4UrlTraffic` / `refreshTenantGa4Traffic` /
 *      `normalizeGa4PagePathToFullUrl`.
 *    • NO `fetch(` call.
 *
 * 2) `src/domains/outcome-attribution/load-mode-a-for-changes-detail.ts`:
 *    • Type-only import of `Ga4UrlTrafficRow` ALLOWED (TypeScript
 *      erases at compile time).
 *    • NO runtime import of `@/lib/connectors/ga4/data-api`,
 *      `@/lib/connectors/ga4/persist-url-traffic`,
 *      `@/lib/connectors/ga4/normalize-page-path`,
 *      `@/lib/connectors/ga4/client`,
 *      `@/lib/connectors/ga4/property-selection`.
 *    • NO runtime import of
 *      `@/app/(shell)/diagnostics/outcome-attribution/actions`.
 *    • NO `fetch(` call (Supabase admin handles its own transport).
 *    • Positive sanity: imports `getSupabaseAdmin` from
 *      `@/lib/persistence/supabase`.
 *    • Positive sanity: imports `computeModeATrafficAttribution`
 *      from `@/domains/outcome-attribution/mode-a-cited-here-traffic-here`.
 *
 * 3) `src/app/(shell)/changes/[id]/page.tsx`:
 *    • NO import of `@/lib/connectors/ga4/*` (runtime OR type).
 *    • NO bare identifier `runGa4UrlTrafficReport` /
 *      `persistGa4UrlTraffic` / `refreshTenantGa4Traffic` /
 *      `normalizeGa4PagePathToFullUrl`.
 *    • Positive sanity: imports `loadModeAForChangesDetail`.
 *
 * 4) `src/app/(shell)/changes/[id]/change-detail-v2-client.tsx`:
 *    • NO runtime import of `@/lib/connectors/ga4/*`.
 *    • Type-only import of `ModeAResult` ALLOWED.
 *    • Positive sanity: imports `OutcomeAttributionAct3`.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function stripComments(src: string): string {
  return src.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Lines after `import type ...` are TS-erased; this helper returns
 *  only RUNTIME import lines (excluding `import type`). */
function runtimeImportLines(src: string): string[] {
  return src
    .split("\n")
    .filter(
      (line) =>
        /^\s*import\b/.test(line) && !/^\s*import\s+type\b/.test(line),
    );
}

const COMPONENT_PATH = join(
  REPO_ROOT,
  "src/components/changes/outcome-attribution-act3.tsx",
);
const LOADER_PATH = join(
  REPO_ROOT,
  "src/domains/outcome-attribution/load-mode-a-for-changes-detail.ts",
);
const PAGE_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/changes/[id]/page.tsx",
);
const CLIENT_PATH = join(
  REPO_ROOT,
  "src/app/(shell)/changes/[id]/change-detail-v2-client.tsx",
);

const COMPONENT_RAW = readFileSync(COMPONENT_PATH, "utf-8");
const LOADER_RAW = readFileSync(LOADER_PATH, "utf-8");
const PAGE_RAW = readFileSync(PAGE_PATH, "utf-8");
const CLIENT_RAW = readFileSync(CLIENT_PATH, "utf-8");

const COMPONENT_CODE = stripComments(COMPONENT_RAW);
const LOADER_CODE = stripComments(LOADER_RAW);
const PAGE_CODE = stripComments(PAGE_RAW);
const CLIENT_CODE = stripComments(CLIENT_RAW);

const FORBIDDEN_GA4_IDENTIFIERS: ReadonlyArray<string> = [
  "runGa4UrlTrafficReport",
  "persistGa4UrlTraffic",
  "refreshTenantGa4Traffic",
  "normalizeGa4PagePathToFullUrl",
];

// ─────────────────────────────────────────────────────────────────────
// (1) Component: outcome-attribution-act3.tsx
// ─────────────────────────────────────────────────────────────────────

describe("outcome-attribution Act 3 component — no GA4 API surface", () => {
  it("does NOT runtime-import from @/lib/connectors/ga4/*", () => {
    const runtimeLines = runtimeImportLines(COMPONENT_CODE);
    const offenders = runtimeLines.filter((l) =>
      /from\s+["']@\/lib\/connectors\/ga4\//.test(l),
    );
    expect(offenders).toEqual([]);
  });

  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      const pattern = new RegExp(`\\b${id}\\b`);
      expect(pattern.test(COMPONENT_CODE)).toBe(false);
    });
  }

  it("does NOT call fetch()", () => {
    expect(/\bfetch\s*\(/.test(COMPONENT_CODE)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (2) Loader: load-mode-a-for-changes-detail.ts
// ─────────────────────────────────────────────────────────────────────

describe("Mode A loader — no GA4 API surface", () => {
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

  it("does NOT call fetch() directly (Supabase admin owns its transport)", () => {
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

  it("type-only import of Ga4UrlTrafficRow is allowed", () => {
    // The full RAW source (with `import type ...`) must contain the
    // type-only import line. Stripped runtime view should NOT.
    expect(
      /import\s+type\s+\{\s*Ga4UrlTrafficRow\s*\}/.test(LOADER_RAW),
    ).toBe(true);
    // Defensive: there is NO runtime import that brings Ga4UrlTrafficRow
    // in as a value.
    const runtimeLines = runtimeImportLines(LOADER_CODE);
    const runtimeUrlTrafficRow = runtimeLines.filter((l) =>
      /Ga4UrlTrafficRow/.test(l),
    );
    expect(runtimeUrlTrafficRow).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (3) Server page: src/app/(shell)/changes/[id]/page.tsx
// ─────────────────────────────────────────────────────────────────────

describe("Changes detail server page — no GA4 connector import", () => {
  it("does NOT import from @/lib/connectors/ga4/* (runtime OR type)", () => {
    expect(/from\s+["']@\/lib\/connectors\/ga4\//.test(PAGE_CODE)).toBe(false);
  });

  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      const pattern = new RegExp(`\\b${id}\\b`);
      expect(pattern.test(PAGE_CODE)).toBe(false);
    });
  }

  it("does import loadModeAForChangesDetail (positive sanity)", () => {
    expect(/loadModeAForChangesDetail/.test(PAGE_CODE)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────
// (4) Client component: change-detail-v2-client.tsx
// ─────────────────────────────────────────────────────────────────────

describe("Changes detail client — no GA4 connector runtime import", () => {
  it("does NOT runtime-import from @/lib/connectors/ga4/*", () => {
    const runtimeLines = runtimeImportLines(CLIENT_CODE);
    const offenders = runtimeLines.filter((l) =>
      /from\s+["']@\/lib\/connectors\/ga4\//.test(l),
    );
    expect(offenders).toEqual([]);
  });

  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      const pattern = new RegExp(`\\b${id}\\b`);
      expect(pattern.test(CLIENT_CODE)).toBe(false);
    });
  }

  it("does import OutcomeAttributionAct3 (positive sanity)", () => {
    expect(/OutcomeAttributionAct3/.test(CLIENT_CODE)).toBe(true);
  });

  it("type-only import of ModeAResult is allowed", () => {
    expect(
      /import\s+type\s+\{\s*ModeAResult\s*\}/.test(CLIENT_RAW),
    ).toBe(true);
  });
});
