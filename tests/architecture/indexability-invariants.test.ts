/**
 * Architecture invariants — indexability loader + diagnostics page
 * (Phase A.3 §3b / §5; consolidated 2026-07-20 architecture-suite diet).
 *
 * ONE file for the indexability source-scanner family. All four prior
 * files used the identical comment-strip read of either the loader
 * (`load-indexability.ts`) or the operator diagnostics page; every pin
 * is preserved verbatim, the strip/import-extraction helpers shared.
 *
 * Subsumes (deleted; each pin survives once here):
 *   • indexability-loader-tenant-isolation      (§3b tenant isolation, TRUST-CRITICAL)
 *   • indexability-loader-import-allowlist       (§3b loader import allowlist)
 *   • indexability-no-fresh-fetch                (§3b loader read-only)
 *   • indexability-diagnostics-no-fresh-fetch    (§5 page read-only)
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOADER = "src/domains/indexability/load-indexability.ts";
const PAGE = "src/app/(shell)/diagnostics/indexability/page.tsx";

function raw(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripped(rel: string): string {
  return raw(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function extractImportPaths(src: string): string[] {
  const paths: string[] = [];
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']\s*;?/gm)) paths.push(m[1]!);
  for (const m of src.matchAll(/^\s*import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']\s*;?/gm)) paths.push(m[1]!);
  return paths;
}

const FRESH_FETCH_TOKENS = [
  "fetch(", "fetchAndParseRobots", "refreshRobotsState", "axios", "superagent", "node-fetch", "got(",
] as const;

// ─────────────────────── loader tenant isolation (§3b) ──────────────────────

describe("indexability loader — tenant isolation (§3b)", () => {
  const SRC = raw(LOADER);
  const S = stripped(LOADER);
  it("imports currentTenantId from @/lib/tenant-context", () => {
    expect(SRC).toMatch(/from\s+["']@\/lib\/tenant-context["']/);
    expect(S).toMatch(/\bcurrentTenantId\b/);
  });
  it("calls currentTenantId() at runtime", () => {
    expect(S).toMatch(/currentTenantId\s*\(\s*\)/);
  });
  it("references opts.tenantId in the loader body", () => {
    expect(S).toMatch(/opts\.tenantId/);
  });
  it("throws on tenant-context mismatch (fail-loud)", () => {
    expect(S).toMatch(/!==\s*opts\.tenantId/);
    expect(S).toMatch(/throw\s+new\s+Error\s*\(/);
    expect(S).toMatch(/tenant context mismatch/);
  });
  it("filters reconciliation.canonical_pages by tenant domain before membership check", () => {
    expect(S).toMatch(/canonical_pages\s*\.\s*filter\s*\(/);
    expect(S).toMatch(/tenantDomain/);
  });
  it("normalizes host (lowercase + strip-www) before tenant-domain comparison", () => {
    expect(S).toMatch(/function\s+normalizeHost\s*\(/);
    expect(S).toMatch(/normalizeHost\s*\(\s*[a-zA-Z_]+\.url\s*\)/);
  });
  it("validates state.siteDomain against tenantDomain before consuming robots data", () => {
    expect(S).toMatch(/state\.siteDomain/);
    expect(S).toMatch(/normalizeHost\s*\(\s*state\.siteDomain\s*\)\s*!==\s*tenantDomain/);
  });
  it("returns null robots flags on every defense branch (no silent fall-through)", () => {
    expect(S).toMatch(/function\s+nullRobotsFlags\s*\(/);
    const matches = S.match(/nullRobotsFlags\s*\(\s*\)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(4);
  });
});

// ─────────────────────── loader import allowlist (§3b) ──────────────────────

describe("indexability loader — import allowlist (§3b)", () => {
  const S = stripped(LOADER);
  const ALLOWED = new Set([
    "server-only", "next/cache", "./types", "./compute-indexability", "./load-gsc-signal",
    "@/domains/pages/types", "@/domains/pages/robots-parser",
    "@/domains/citation-lifecycle/canonicalize-url", "@/lib/business-config",
    "@/lib/tenant-context", "@/lib/persistence/repositories",
  ]);
  it("every import path in the loader matches the allowlist", () => {
    const paths = extractImportPaths(S);
    expect(paths.length, "loader has zero imports").toBeGreaterThan(0);
    for (const p of paths) {
      expect(ALLOWED.has(p), `disallowed import path '${p}' in load-indexability.ts`).toBe(true);
    }
  });
  it("loader imports 'server-only'", () => {
    expect(S).toMatch(/^\s*import\s+["']server-only["']/m);
  });
  it("loader imports 'next/cache'", () => {
    expect(S).toMatch(/from\s+["']next\/cache["']/);
  });
  it("loader imports its sibling compute module", () => {
    expect(S).toMatch(/from\s+["']\.\/compute-indexability["']/);
  });
  it("loader imports the citation-lifecycle canonicalizer", () => {
    expect(S).toMatch(/from\s+["']@\/domains\/citation-lifecycle\/canonicalize-url["']/);
  });
});

// ─────────────────────── loader no-fresh-fetch (§3b) ────────────────────────

describe("indexability loader — no fresh fetch (§3b)", () => {
  const S = stripped(LOADER);
  for (const token of FRESH_FETCH_TOKENS) {
    it(`loader source does NOT contain the fresh-fetch token '${token}'`, () => {
      expect(S).not.toContain(token);
    });
  }
  const FORBIDDEN_IMPORTS: ReadonlyArray<RegExp> = [
    /from\s+["']@\/lib\/llm\//,
    /from\s+["']@\/lib\/cost\//,
    /from\s+["']@\/domains\/recommendations\/cross-tenant-brain\//,
    /from\s+["']@\/lib\/connectors\/gsc\//,
  ];
  for (const re of FORBIDDEN_IMPORTS) {
    it(`loader source does NOT import ${re.source}`, () => {
      expect(S).not.toMatch(re);
    });
  }
  it("loader source does NOT import the raw dotdata I/O layer", () => {
    expect(S).not.toMatch(/from\s+["']@\/lib\/persistence\/dotdata-json["']/);
  });
});

// ─────────────────────── diagnostics page no-fresh-fetch (§5) ────────────────

describe("/diagnostics/indexability page — no fresh fetch (§5)", () => {
  const S = stripped(PAGE);
  for (const token of FRESH_FETCH_TOKENS) {
    it(`page source does NOT contain the fresh-fetch token '${token}'`, () => {
      expect(S).not.toContain(token);
    });
  }
  const FORBIDDEN_IMPORTS: ReadonlyArray<RegExp> = [
    /from\s+["']@\/lib\/llm\//,
    /from\s+["']@\/lib\/cost\//,
    /from\s+["']@\/domains\/recommendations\/cross-tenant-brain\//,
    /from\s+["'][^"']*-client["']/,
    /from\s+["']@\/lib\/persistence\/dotdata-json["']/,
    /from\s+["']@\/domains\/scanning\//,
    /from\s+["']@\/lib\/connectors\/gsc\//,
  ];
  for (const re of FORBIDDEN_IMPORTS) {
    it(`page source does NOT import ${re.source}`, () => {
      expect(S).not.toMatch(re);
    });
  }
  it("page passes enableGsc=true to loadIndexabilityForUrl (A.3.b1.beta opt-in)", () => {
    expect(/enableGsc\s*:\s*true/.test(S)).toBe(true);
  });
  it("page caps GSC fresh fetches via GSC_INSPECT_PER_RENDER_LIMIT", () => {
    expect(/GSC_INSPECT_PER_RENDER_LIMIT/.test(S)).toBe(true);
  });
  const ALLOWED = new Set([
    "next/navigation", "next/link", "@/lib/operator-mode", "@/lib/tenant-context",
    "@/lib/persistence/repositories", "@/lib/business-config",
    "@/domains/pages/robots-parser", "@/domains/citation-lifecycle/canonicalize-url",
    "@/domains/indexability/load-indexability", "@/domains/indexability/types",
    "@/domains/indexability/load-gsc-signal", "@/components/site-health/site-health-panel",
    "@/domains/site-health/ai-crawler-block", "@/domains/site-health/cms-detect",
  ]);
  it("every import path in the page matches the allowlist", () => {
    const paths = extractImportPaths(S);
    expect(paths.length, "diagnostics page has zero imports").toBeGreaterThan(0);
    for (const p of paths) {
      expect(ALLOWED.has(p), `disallowed import path '${p}' in indexability diagnostics page`).toBe(true);
    }
  });
});
