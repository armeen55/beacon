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
 *   • Any path containing `gsc` (reserved for A.3.b1)
 *   • Any `*-client` HTTP-client convention path
 *   • `@/lib/persistence/dotdata-json` (bypass of the store
 *     wrapper layer)
 *   • Any scan-orchestrator import (e.g.,
 *     `@/domains/scanning/orchestrate-scan`)
 *
 * Retirement: refines (does NOT retire) when A.3.b1 lands the
 * GSC connector — the GSC client path moves from forbidden to
 * allowed; the fetch-token list stays.
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
  /from\s+["'][^"']*gsc[^"']*["']/i,
  /from\s+["'][^"']*-client["']/,
  /from\s+["']@\/lib\/persistence\/dotdata-json["']/,
  /from\s+["']@\/domains\/scanning\//,
];

const ALLOWED_IMPORT_PATHS: ReadonlySet<string> = new Set([
  "next/navigation",
  "next/link",
  "@/lib/operator-mode",
  "@/lib/tenant-context",
  "@/lib/persistence/repositories",
  "@/lib/business-config",
  "@/domains/pages/snapshot-store",
  "@/domains/pages/sitemap-reconciliation-store",
  "@/domains/pages/robots-parser",
  "@/domains/citation-lifecycle/canonicalize-url",
  "@/domains/indexability/load-indexability",
  "@/domains/indexability/types",
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

  it("page source does NOT import any GSC module (reserved for A.3.b1)", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[3]);
  });

  it("page source does NOT import any '-client' HTTP-client convention path", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[4]);
  });

  it("page source does NOT import the raw dotdata I/O layer (must use store wrappers)", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[5]);
  });

  it("page source does NOT import any scan-orchestrator module", () => {
    expect(SRC_STRIPPED).not.toMatch(FORBIDDEN_IMPORT_PATTERNS[6]);
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
