/**
 * Architecture invariant — Phase A.3 Step 5 (2026-05-14).
 *
 * The `/diagnostics/indexability` page is READ-ONLY over stored
 * signals. It must never trigger fresh HTTP fetches, scan runs,
 * GSC calls, LLM calls, or Supabase writes. The page consumes
 * `loadIndexabilityForUrl` (already pinned read-only by
 * `indexability-no-fresh-fetch` for the loader itself) plus the
 * snapshot / sitemap / robots-state readers for the header
 * summary — every dependency is read-only by contract.
 *
 * This invariant pins the no-fresh-fetch boundary at the page's
 * source-text level so future refactors can't quietly add a
 * fetch-bearing helper. The forbidden-token + import-allowlist
 * sweeps mirror the loader invariant's shape.
 *
 * Forbidden tokens (case-sensitive substring match on the
 * comment-stripped source):
 *   • `fetch(`
 *   • `fetchAndParseRobots`
 *   • `refreshRobotsState`
 *   • `axios`
 *   • `superagent`
 *   • `node-fetch`
 *   • `got(`
 *
 * Forbidden import paths:
 *   • `@/lib/llm/*`
 *   • `@/lib/cost/*`
 *   • `@/domains/recommendations/cross-tenant-brain/*`
 *   • Any `*-client` HTTP-client convention path
 *   • `@/lib/persistence/dotdata-json` (bypass of the store
 *     wrapper layer)
 *   • Any scan-orchestrator import (e.g.,
 *     `@/domains/scanning/orchestrate-scan`)
 *
 * GSC posture (A.3.b1.beta, 2026-05-17):
 *   The page legitimately imports the GSC fresh-fetch cap constant
 *   `GSC_INSPECT_PER_RENDER_LIMIT` from `@/domains/indexability/
 *   load-gsc-signal` so it can pass a bounded budget to the loader's
 *   `enableGsc: true` opt-in. The page itself never invokes
 *   `gscUrlInspect` or any HTTP fetch directly — GSC reads route
 *   through the loader → adapter → cache + bounded client. The
 *   "no GSC module reserved for A.3.b1" guard is REPLACED with the
 *   explicit opt-in contract: page calls loader with
 *   `enableGsc: true` AND a `gscBudget` capped at
 *   `GSC_INSPECT_PER_RENDER_LIMIT`.
 *
 * Retirement: the fetch-token list + non-GSC forbidden paths are
 * permanent. GSC-specific guards refine when A.3.b3 lands additional
 * GSC APIs (Search Analytics, etc.).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const PAGE_PATH = resolve(
  REPO_ROOT,
  "src",
  "app",
  "(shell)",
  "diagnostics",
  "indexability",
  "page.tsx",
);

const SRC = readFileSync(PAGE_PATH, "utf-8");
const SRC_STRIPPED = SRC.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /^\s*\/\/.*$/gm,
  "",
);

const FORBIDDEN_TOKENS = [
  "fetch(",
  "fetchAndParseRobots",
  "refreshRobotsState",
  "axios",
  "superagent",
  "node-fetch",
  "got(",
] as const;

const FORBIDDEN_IMPORT_PATTERNS: ReadonlyArray<RegExp> = [
  /from\s+["']@\/lib\/llm\//,
  /from\s+["']@\/lib\/cost\//,
  /from\s+["']@\/domains\/recommendations\/cross-tenant-brain\//,
  // A.3.b1.beta (2026-05-17) — the `*-client` HTTP-client convention
  // is still forbidden, but the GSC adapter path
  // (`@/domains/indexability/load-gsc-signal`) is NOT a `*-client`
  // path and is allowlisted explicitly below. The page reaches GSC
  // only through the bounded adapter; never via a direct HTTP client.
  /from\s+["'][^"']*-client["']/,
  /from\s+["']@\/lib\/persistence\/dotdata-json["']/,
  /from\s+["']@\/domains\/scanning\//,
  // Direct GSC CLIENT import is still forbidden from the page —
  // GSC reads must flow through the bounded adapter (load-gsc-signal),
  // never via @/lib/connectors/gsc/client directly.
  /from\s+["']@\/lib\/connectors\/gsc\//,
];

const ALLOWED_IMPORT_PATHS: ReadonlySet<string> = new Set([
  "next/navigation",
  "next/link",
  "@/lib/operator-mode",
  "@/lib/tenant-context",
  "@/lib/persistence/repositories",
  "@/lib/business-config",
  // Phase A.3 (post-A.3.5 second-stage, 2026-05-15) —
  // sitemap-reconciliation-store + snapshot-store retired from
  // the page's import surface. Page now reads page-snapshots,
  // sitemap-reconciliation, robots-state all through the
  // tenant-scoped repository.
  "@/domains/pages/robots-parser",
  "@/domains/citation-lifecycle/canonicalize-url",
  "@/domains/indexability/load-indexability",
  "@/domains/indexability/types",
  // A.3.b1.beta (2026-05-17) — the page imports the locked
  // GSC_INSPECT_PER_RENDER_LIMIT constant + threads a fresh-fetch
  // budget through the loader's enableGsc opt-in path. GSC reads
  // route through the bounded adapter (`load-gsc-signal`), never
  // via direct HTTP. The page itself does NOT call gscUrlInspect.
  "@/domains/indexability/load-gsc-signal",
  // R23 P16 wiring (2026-07-03) — the site-health panel is a
  // display-only, self-hiding read layer over the robots signals +
  // snapshot the page ALREADY loaded. Both detectors are pure
  // (no fetch, no I/O); the panel is a token-only component. They
  // add zero fresh-fetch surface — the no-fresh-fetch boundary holds.
  "@/components/site-health/site-health-panel",
  "@/domains/site-health/ai-crawler-block",
  "@/domains/site-health/cms-detect",
]);

function extractImportPaths(src: string): string[] {
  const paths: string[] = [];
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']\s*;?/gm)) {
    paths.push(m[1]);
  }
  for (const m of src.matchAll(
    /^\s*import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']\s*;?/gm,
  )) {
    paths.push(m[1]);
  }
  return paths;
}

describe("Architecture — /diagnostics/indexability no-fresh-fetch (Phase A.3 §5)", () => {
  for (const token of FORBIDDEN_TOKENS) {
    it(`page source does NOT contain the fresh-fetch token '${token}'`, () => {
      expect(
        SRC_STRIPPED,
        `forbidden token '${token}' appeared in indexability page source`,
      ).not.toContain(token);
    });
  }

  it("page source does NOT import any LLM module", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[0]);
  });

  it("page source does NOT import any cost-ledger module", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[1]);
  });

  it("page source does NOT import any cross-tenant-brain module", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[2]);
  });

  it("page source does NOT import any '-client' HTTP-client convention path", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[3]);
  });

  it("page source does NOT import the raw dotdata I/O layer (must use store wrappers)", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[4]);
  });

  it("page source does NOT import any scan-orchestrator module", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[5]);
  });

  it("page source does NOT import the GSC client directly — only the bounded adapter (A.3.b1.beta)", () => {
    // GSC reads route through @/domains/indexability/load-gsc-signal
    // which enforces the per-render cap + Supabase cache + token
    // discipline. Direct gscUrlInspect import from the page would
    // bypass the bounded adapter.
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[6]);
  });

  it("page passes enableGsc=true to loadIndexabilityForUrl (A.3.b1.beta opt-in)", () => {
    // Operator-locked: the diagnostic page is the SOLE caller that
    // enables GSC. Customer-facing callers omit `enableGsc` and
    // get pre-beta byte-equal behavior.
    expect(
      /enableGsc\s*:\s*true/.test(SRC_STRIPPED),
      "operator diagnostic page must pass enableGsc: true to loadIndexabilityForUrl",
    ).toBe(true);
  });

  it("page caps GSC fresh fetches via GSC_INSPECT_PER_RENDER_LIMIT (A.3.b1.beta)", () => {
    // The page MUST reference the locked cap constant so a future
    // refactor can't quietly drop the bound.
    expect(
      /GSC_INSPECT_PER_RENDER_LIMIT/.test(SRC_STRIPPED),
      "operator diagnostic page must reference GSC_INSPECT_PER_RENDER_LIMIT for the fresh-fetch budget cap",
    ).toBe(true);
  });

  it("every import path in the page matches the allowlist", () => {
    const paths = extractImportPaths(SRC_STRIPPED);
    expect(
      paths.length,
      "diagnostics page has zero imports — sanity check",
    ).toBeGreaterThan(0);
    for (const p of paths) {
      expect(
        ALLOWED_IMPORT_PATHS.has(p),
        `disallowed import path '${p}' in indexability diagnostics page — add to ALLOWED_IMPORT_PATHS in this invariant OR remove the import`,
      ).toBe(true);
    }
  });
});
