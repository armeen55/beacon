/**
 * CONSTITUTION §3 — No paid provider calls during render (GA4 half).
 *
 * Consolidated from edit-outcomes-loader-no-ga4-api,
 * outcome-attribution-changes-detail-no-ga4-api, and
 * outcome-attribution-mode-a-sample-size-guard. Pins that no
 * customer/render surface triggers a live GA4 Data API call — cached
 * `ga4_url_traffic` rows via Supabase admin only; fresh GA4 lands only
 * on an operator-clicked Refresh. Mode A stays a pure, network-free
 * compute over caller-supplied rows with locked sample-size thresholds.
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
    .filter((l) => /^\s*import\b/.test(l) && !/^\s*import\s+type\b/.test(l));
}

const FORBIDDEN_GA4_IDENTIFIERS = [
  "runGa4UrlTrafficReport",
  "persistGa4UrlTraffic",
  "refreshTenantGa4Traffic",
  "normalizeGa4PagePathToFullUrl",
];

// ── Today outcomes loader ───────────────────────────────────────────
const LOADER_RAW = readFileSync(
  join(
    REPO_ROOT,
    "src/domains/outcome-attribution/load-outcomes-summary-for-tenant.ts",
  ),
  "utf-8",
);
const LOADER_CODE = stripComments(LOADER_RAW);

describe("load-outcomes-summary-for-tenant — no GA4 API surface on render", () => {
  const FORBIDDEN_RUNTIME_PATHS = [
    /from\s+["']@\/lib\/connectors\/ga4\/data-api["']/,
    /from\s+["']@\/lib\/connectors\/ga4\/persist-url-traffic["']/,
    /from\s+["']@\/lib\/connectors\/ga4\/normalize-page-path["']/,
    /from\s+["']@\/lib\/connectors\/ga4\/client["']/,
    /from\s+["']@\/lib\/connectors\/ga4\/property-selection["']/,
  ];
  for (const pat of FORBIDDEN_RUNTIME_PATHS) {
    it(`does NOT runtime-import matching ${pat.source}`, () => {
      expect(runtimeImportLines(LOADER_CODE).filter((l) => pat.test(l))).toEqual(
        [],
      );
    });
  }
  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      expect(new RegExp(`\\b${id}\\b`).test(LOADER_CODE)).toBe(false);
    });
  }
  it("does NOT call fetch(); does read via Supabase admin + repository (positive sanity)", () => {
    expect(/\bfetch\s*\(/.test(LOADER_CODE)).toBe(false);
    expect(/from\s+["']@\/lib\/persistence\/supabase["']/.test(LOADER_CODE)).toBe(
      true,
    );
    expect(/getSupabaseAdmin/.test(LOADER_CODE)).toBe(true);
    expect(/computeModeATrafficAttribution/.test(LOADER_CODE)).toBe(true);
    expect(
      /from\s+["']@\/lib\/persistence\/repositories["']/.test(LOADER_CODE),
    ).toBe(true);
  });
  it("Ga4UrlTrafficRow is a type-only import (erased at runtime)", () => {
    expect(/import\s+type\s+\{\s*Ga4UrlTrafficRow\s*\}/.test(LOADER_RAW)).toBe(
      true,
    );
    expect(
      runtimeImportLines(LOADER_CODE).filter((l) => /Ga4UrlTrafficRow/.test(l)),
    ).toEqual([]);
    expect(
      /from\s+["']next\/cache["']/.test(runtimeImportLines(LOADER_CODE).join("\n")),
    ).toBe(false);
  });
});

// ── Changes detail server page ──────────────────────────────────────
const PAGE_CODE = stripComments(
  readFileSync(
    join(REPO_ROOT, "src/app/(shell)/changes/[id]/page.tsx"),
    "utf-8",
  ),
);

describe("Changes detail server page — no GA4 connector import on render", () => {
  it("does NOT import from @/lib/connectors/ga4/* (runtime OR type)", () => {
    expect(/from\s+["']@\/lib\/connectors\/ga4\//.test(PAGE_CODE)).toBe(false);
  });
  for (const id of FORBIDDEN_GA4_IDENTIFIERS) {
    it(`does NOT reference identifier \`${id}\``, () => {
      expect(new RegExp(`\\b${id}\\b`).test(PAGE_CODE)).toBe(false);
    });
  }
});

// ── Mode A pure-compute guard ───────────────────────────────────────
const MODE_A_CODE = stripComments(
  readFileSync(
    join(
      REPO_ROOT,
      "src/domains/outcome-attribution/mode-a-cited-here-traffic-here.ts",
    ),
    "utf-8",
  ),
);
const MODE_A_RUNTIME_IMPORTS = runtimeImportLines(MODE_A_CODE).join("\n");

describe("Mode A — locked K4 sample-size thresholds", () => {
  it("pins MODE_A_MIN_DAYS_POST_LIVE=7, MIN_SESSIONS=5, MIN_QUALIFIED_CALLS=1", () => {
    expect(
      /export\s+const\s+MODE_A_MIN_DAYS_POST_LIVE\s*=\s*7\s*;/.test(MODE_A_CODE),
    ).toBe(true);
    expect(/export\s+const\s+MODE_A_MIN_SESSIONS\s*=\s*5\s*;/.test(MODE_A_CODE)).toBe(
      true,
    );
    expect(
      /export\s+const\s+MODE_A_MIN_QUALIFIED_CALLS\s*=\s*1\s*;/.test(MODE_A_CODE),
    ).toBe(true);
  });
  it("honors the K4 OR-branch (!sessionsThresholdMet && !callsThresholdMet)", () => {
    expect(
      /!\s*sessionsThresholdMet\s*&&\s*!\s*callsThresholdMet/.test(
        MODE_A_CODE.replace(/\s+/g, " "),
      ),
    ).toBe(true);
  });
  it("computeModeATrafficAttribution is exported non-async (pure)", () => {
    expect(/export\s+function\s+computeModeATrafficAttribution/.test(MODE_A_CODE)).toBe(
      true,
    );
    expect(
      /export\s+async\s+function\s+computeModeATrafficAttribution/.test(MODE_A_CODE),
    ).toBe(false);
  });
});

describe("Mode A — purity + server-only + network-free posture", () => {
  it("imports server-only; no Supabase/repository/GA4-client/fetch", () => {
    expect(/import\s+["']server-only["']/.test(MODE_A_CODE)).toBe(true);
    expect(/from\s+["']@\/lib\/persistence\/supabase["']/.test(MODE_A_CODE)).toBe(
      false,
    );
    expect(/from\s+["']@\/lib\/persistence\/repositories["']/.test(MODE_A_CODE)).toBe(
      false,
    );
    expect(/from\s+["']@\/lib\/connectors\/ga4\/data-api["']/.test(MODE_A_CODE)).toBe(
      false,
    );
    expect(/from\s+["']@\/lib\/connectors\//.test(MODE_A_RUNTIME_IMPORTS)).toBe(
      false,
    );
    expect(/\bfetch\s*\(/.test(MODE_A_CODE)).toBe(false);
    expect(/\bcurrentTenantSlug\s*\(/.test(MODE_A_CODE)).toBe(false);
    expect(/\bcurrentTenantId\s*\(/.test(MODE_A_CODE)).toBe(false);
  });
  it("does NOT runtime-import any customer surface / page / component", () => {
    const forbidden = [
      /from\s+["']@\/app\//,
      /from\s+["']@\/components\//,
      /from\s+["']@\/domains\/today["']/,
      /from\s+["']@\/domains\/today\//,
      /from\s+["']@\/domains\/recommendations["']/,
      /from\s+["']@\/domains\/recommendations\//,
      /from\s+["']@\/domains\/changes["']/,
      /from\s+["']@\/domains\/changes\//,
      /from\s+["']@\/domains\/prompts["']/,
      /from\s+["']@\/domains\/prompts\//,
    ];
    for (const pat of forbidden)
      expect(pat.test(MODE_A_RUNTIME_IMPORTS), pat.source).toBe(false);
  });
  it("K5 forbidden customer-vocab absent from source (defense in depth)", () => {
    const lower = MODE_A_CODE.toLowerCase();
    for (const w of ["drove", "caused", "generated", "revenue", "dollars"])
      expect(lower.includes(w), w).toBe(false);
  });
});
