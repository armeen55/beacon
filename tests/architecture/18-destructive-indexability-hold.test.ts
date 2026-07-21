/**
 * CONSTITUTION §6 — Destructive-action safety: indexability / indexing hold.
 *
 * From indexability-invariants (loader half; the /diagnostics page half was
 * dropped — that route tree is being removed). Pins the tenant-safe,
 * fail-loud, read-only indexability loader so a bad robots/canonical read
 * can never silently flip an indexing decision across tenants:
 *   1. Tenant isolation: currentTenantId() + opts.tenantId, fail-loud on
 *      mismatch, host-normalized tenant-domain gate BEFORE consuming robots
 *      data, and null robots flags on every defense branch (no silent
 *      fall-through).
 *   2. Import allowlist — no llm/cost/brain/gsc/raw-I-O reach the loader.
 *   3. No fresh network fetch on the loader path (read-only).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const LOADER = "src/domains/indexability/load-indexability.ts";

function raw(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}
function stripped(rel: string): string {
  return raw(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}
function extractImportPaths(src: string): string[] {
  const paths: string[] = [];
  for (const m of src.matchAll(/^\s*import\s+["']([^"']+)["']\s*;?/gm))
    paths.push(m[1]!);
  for (const m of src.matchAll(
    /^\s*import\s+(?:type\s+)?[\s\S]*?from\s+["']([^"']+)["']\s*;?/gm,
  ))
    paths.push(m[1]!);
  return paths;
}

const FRESH_FETCH_TOKENS = [
  "fetch(",
  "fetchAndParseRobots",
  "refreshRobotsState",
  "axios",
  "superagent",
  "node-fetch",
  "got(",
] as const;

describe("indexability loader — tenant isolation (§3b, trust-critical)", () => {
  const SRC = raw(LOADER);
  const S = stripped(LOADER);
  it("imports + calls currentTenantId and references opts.tenantId", () => {
    expect(SRC).toMatch(/from\s+["']@\/lib\/tenant-context["']/);
    expect(S).toMatch(/currentTenantId\s*\(\s*\)/);
    expect(S).toMatch(/opts\.tenantId/);
  });
  it("throws on tenant-context mismatch (fail-loud)", () => {
    expect(S).toMatch(/!==\s*opts\.tenantId/);
    expect(S).toMatch(/throw\s+new\s+Error\s*\(/);
    expect(S).toMatch(/tenant context mismatch/);
  });
  it("filters canonical_pages by host-normalized tenant domain before membership", () => {
    expect(S).toMatch(/canonical_pages\s*\.\s*filter\s*\(/);
    expect(S).toMatch(/tenantDomain/);
    expect(S).toMatch(/function\s+normalizeHost\s*\(/);
    expect(S).toMatch(/normalizeHost\s*\(\s*[a-zA-Z_]+\.url\s*\)/);
  });
  it("validates state.siteDomain against tenantDomain before consuming robots data", () => {
    expect(S).toMatch(/state\.siteDomain/);
    expect(S).toMatch(
      /normalizeHost\s*\(\s*state\.siteDomain\s*\)\s*!==\s*tenantDomain/,
    );
  });
  it("returns null robots flags on every defense branch (no silent fall-through)", () => {
    expect(S).toMatch(/function\s+nullRobotsFlags\s*\(/);
    expect((S.match(/nullRobotsFlags\s*\(\s*\)/g) ?? []).length).toBeGreaterThanOrEqual(
      4,
    );
  });
});

describe("indexability loader — import allowlist (§3b)", () => {
  const S = stripped(LOADER);
  const ALLOWED = new Set([
    "server-only",
    "next/cache",
    "./types",
    "./compute-indexability",
    "./load-gsc-signal",
    "@/domains/pages/types",
    "@/domains/pages/robots-parser",
    "@/domains/citation-lifecycle/canonicalize-url",
    "@/lib/business-config",
    "@/lib/tenant-context",
    "@/lib/persistence/repositories",
  ]);
  it("every import path in the loader matches the allowlist", () => {
    const paths = extractImportPaths(S);
    expect(paths.length, "loader has zero imports").toBeGreaterThan(0);
    for (const p of paths)
      expect(ALLOWED.has(p), `disallowed import '${p}'`).toBe(true);
  });
  it("loader is server-only and cache-wrapped", () => {
    expect(S).toMatch(/^\s*import\s+["']server-only["']/m);
    expect(S).toMatch(/from\s+["']next\/cache["']/);
  });
});

describe("indexability loader — no fresh fetch (§3b, read-only)", () => {
  const S = stripped(LOADER);
  for (const token of FRESH_FETCH_TOKENS) {
    it(`does NOT contain fresh-fetch token '${token}'`, () => {
      expect(S).not.toContain(token);
    });
  }
  for (const re of [
    /from\s+["']@\/lib\/llm\//,
    /from\s+["']@\/lib\/cost\//,
    /from\s+["']@\/domains\/recommendations\/cross-tenant-brain\//,
    /from\s+["']@\/lib\/connectors\/gsc\//,
    /from\s+["']@\/lib\/persistence\/dotdata-json["']/,
  ]) {
    it(`does NOT import ${re.source}`, () => {
      expect(S).not.toMatch(re);
    });
  }
});
