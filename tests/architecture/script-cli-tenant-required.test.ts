/**
 * Architecture invariant — every CLI script that writes tenant-scoped
 * data to Supabase or `.data/` either:
 *   (a) requires `BEACON_TENANT_ID` env var (fail-loud on missing), OR
 *   (b) accepts an explicit `--tenant <id>` argv flag, OR
 *   (c) imports `currentTenantId` and uses it for stamping.
 *
 * Plus the literal scan: every script under `scripts/` that participates
 * in the D3-cleaned set must contain ZERO `tenant_id: ""` literals.
 *
 * Stage D3 (2026-05-09) — cron / backfill / verify scripts now require
 * the tenant boundary explicitly. No silent default to empty string.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join, relative } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const SCRIPTS_DIR = join(REPO_ROOT, "scripts");

/** Strip TS comments before scanning. */
function stripComments(src: string): string {
  return src
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

const LITERAL_RE = /tenant_id:\s*(?:""|'')/;

/** Stage D3 cleaned + writer scripts. Each writes tenant-scoped data
 *  and must resolve the tenant explicitly at the boundary. */
const D3_WRITER_SCRIPTS: ReadonlyArray<string> = [
  "scripts/scan-owned-pages.ts",
  "scripts/verify-rec-response-roundtrip.ts",
  "scripts/backfill-change-contracts.ts",
  "scripts/backfill-operator-loop-stores.ts",
  "scripts/backfill-scan-findings.ts",
];

/** Heuristics: a script "requires" a tenant if its source contains one
 *  of these patterns. Any one is sufficient. */
const TENANT_REQUIRED_PATTERNS: ReadonlyArray<RegExp> = [
  // `process.env.BEACON_TENANT_ID` followed somewhere by an exit on missing
  /process\.env\.BEACON_TENANT_ID/,
  // Explicit argv parser like `--tenant <id>`
  /--tenant\b/,
  // Imports `currentTenantId` from the tenant-context module
  /from\s+["'][^"']*tenant-context["']/,
];

/** Loose check that the script ALSO fails loud (process.exit / throw)
 *  when the resolved value is falsy. We require both presence AND
 *  fail-loud on absence — silently using `process.env.BEACON_TENANT_ID`
 *  without checking it doesn't satisfy the contract. */
function failsLoudOnMissingTenant(src: string): boolean {
  // Match shapes:
  //   if (!tenantId) { ... process.exit(1) ... }
  //   if (!process.env.BEACON_TENANT_ID) { ... process.exit … }
  //   const tenantId = process.env.BEACON_TENANT_ID; if (!tenantId) throw …
  //   const tenantId = await currentTenantId(); — currentTenantId itself
  //     fail-loud-throws when env unset (per src/lib/tenant-context.ts)
  if (/from\s+["'][^"']*tenant-context["']/.test(src)) return true;
  if (
    /BEACON_TENANT_ID[\s\S]{0,400}(?:process\.exit\s*\(\s*1|throw\s+new\s+Error)/.test(
      src,
    )
  ) {
    return true;
  }
  if (
    /(?:!tenantId|!FALLBACK_TENANT_ID)[\s\S]{0,400}(?:process\.exit\s*\(\s*1|throw\s+new\s+Error)/.test(
      src,
    )
  ) {
    return true;
  }
  return false;
}

describe("Architecture — D3 writer scripts require an explicit tenant boundary", () => {
  it("every D3 writer script source loads and is non-trivial", () => {
    for (const rel of D3_WRITER_SCRIPTS) {
      const abs = join(REPO_ROOT, rel);
      const src = readFileSync(abs, "utf-8");
      expect(src.length, `${rel} loaded`).toBeGreaterThan(200);
    }
  });

  it("every D3 writer script declares a tenant resolution boundary", () => {
    const violations: Array<{ path: string; reason: string }> = [];
    for (const rel of D3_WRITER_SCRIPTS) {
      const abs = join(REPO_ROOT, rel);
      const src = readFileSync(abs, "utf-8");
      const stripped = stripComments(src);
      const declares = TENANT_REQUIRED_PATTERNS.some((re) => re.test(stripped));
      if (!declares) {
        violations.push({
          path: rel,
          reason:
            "does not declare BEACON_TENANT_ID env, --tenant argv, or " +
            "currentTenantId import — silent-default risk",
        });
      }
    }
    expect(
      violations,
      `${violations.length} D3 writer script(s) lack a tenant boundary:\n` +
        violations.map((v) => `  ${v.path}: ${v.reason}`).join("\n"),
    ).toEqual([]);
  });

  it("every D3 writer script fails loud when tenant is missing", () => {
    const violations: Array<{ path: string }> = [];
    for (const rel of D3_WRITER_SCRIPTS) {
      const abs = join(REPO_ROOT, rel);
      const src = readFileSync(abs, "utf-8");
      const stripped = stripComments(src);
      if (!failsLoudOnMissingTenant(stripped)) {
        violations.push({ path: rel });
      }
    }
    expect(
      violations,
      `${violations.length} D3 writer script(s) do not fail loud on missing ` +
        `tenant — they may silently use an empty default. ` +
        `Add an explicit \`if (!tenantId) { process.exit(1) }\` (or use ` +
        `currentTenantId, which throws on missing). Violating script(s):\n` +
        violations.map((v) => `  ${v.path}`).join("\n"),
    ).toEqual([]);
  });

  it("no D3 writer script contains a `tenant_id: \"\"` literal in non-comment code", () => {
    const violations: Array<{ path: string }> = [];
    for (const rel of D3_WRITER_SCRIPTS) {
      const abs = join(REPO_ROOT, rel);
      const stripped = stripComments(readFileSync(abs, "utf-8"));
      if (LITERAL_RE.test(stripped)) {
        violations.push({ path: rel });
      }
    }
    expect(
      violations,
      `${violations.length} D3 writer script(s) re-introduced a ` +
        `\`tenant_id: ""\` literal — replace with the resolved tenantId.\n` +
        violations.map((v) => `  ${v.path}`).join("\n"),
    ).toEqual([]);
  });
});

/**
 * Forward sweep: any NEW script under `scripts/` that mentions a
 * tenant-scoped table name in a write context but does NOT declare a
 * tenant boundary is a regression. We scan the whole `scripts/` dir
 * (excluding the migrate-flat-to-tenant-data.ts read-side bucketer,
 * which legitimately operates on `tenant_id: ""` rows AS DATA, not as
 * a write target).
 */
describe("Architecture — no NEW silent-default tenant scripts", () => {
  const READ_SIDE_ALLOWLIST: ReadonlySet<string> = new Set([
    // migrate-flat-to-tenant-data.ts buckets rows by tenant_id including
    // the empty-string bucket — that's a read-side normalization, not a
    // write stamp. Coercion `?? ""` is intentional there.
    "scripts/migrate-flat-to-tenant-data.ts",
  ]);

  function listScriptFiles(): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(SCRIPTS_DIR, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith(".ts")) continue;
      if (entry.name.endsWith(".test.ts")) continue;
      out.push(join(SCRIPTS_DIR, entry.name));
    }
    return out;
  }

  it("no script outside the read-side allowlist contains a `tenant_id: \"\"` literal", () => {
    const violations: Array<{ path: string }> = [];
    for (const abs of listScriptFiles()) {
      const rel = relative(REPO_ROOT, abs);
      if (READ_SIDE_ALLOWLIST.has(rel)) continue;
      const stripped = stripComments(readFileSync(abs, "utf-8"));
      if (LITERAL_RE.test(stripped)) {
        violations.push({ path: rel });
      }
    }
    expect(
      violations,
      `${violations.length} script(s) contain \`tenant_id: ""\` literals ` +
        `outside the read-side bucketing allowlist:\n` +
        violations.map((v) => `  ${v.path}`).join("\n"),
    ).toEqual([]);
  });
});
