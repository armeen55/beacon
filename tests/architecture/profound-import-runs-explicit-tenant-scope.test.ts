/**
 * Architecture invariant — Section 5 precursor + durable
 * denominator (2026-05-16) — explicit-tenant
 * `getProfoundImportRuns()` scoping across BOTH backends.
 *
 * Pins that the Section-5 denominator reader on `forTenant(
 * tenantId)` scopes by the explicit `tenantId` argument, NOT by
 * ambient `currentTenantSlug()` routing — for both backends:
 *
 *   • File backend (`tenant-repo.ts`): the explicit-tenant
 *     disk-read helper `readProfoundImportRunsForTenant` resolves
 *     slug via `getTenant(tenantId)` with operator-bootstrap env
 *     fallback, then reads `.data/tenants/{slug}/observation-runs.json`
 *     directly via `readFileSync`. Used by local dev with disk
 *     fixtures.
 *
 *   • Supabase backend (`supabase-backend.ts`'s `forTenant`
 *     block): queries the existing `observation_runs` table with
 *     `.eq("tenant_id", tenantId)` AND
 *     `.eq("run_type", "citation_sample_import")`, then maps each
 *     row through `mapObservationRunRowToProfoundImportRun` into
 *     the `ProfoundImportRun` shape. The mapper is exported from
 *     `supabase-backend.ts` for unit-testing. Source-to-platform
 *     mapping handles perplexity-native-poll → perplexity and
 *     openai-native-poll → chatgpt; unknown sources pass through
 *     verbatim.
 *
 * Pins (across both backends):
 *   • Neither file imports `getObservationRuns` from
 *     `@/storage/canonical-store`.
 *   • Neither file consults ambient-routed
 *     `readStore("observation-runs")` or
 *     `readDotDataJson("observation-runs")` for this method.
 *   • Supabase implementation does NOT call `repo.getObservationRuns()`
 *     for this method (wrong type — that's the website-crawl reader).
 *
 * Currently GREEN by construction. Retires never — the
 * explicit-tenant-vs-ambient distinction is structural.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function read(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

const TENANT_REPO = "src/lib/persistence/repositories/tenant-repo.ts";
const SUPABASE_BACKEND = "src/lib/persistence/repositories/supabase-backend.ts";

describe("Architecture — getProfoundImportRuns scopes by explicit tenantId (tenant-repo)", () => {
  const active = stripComments(read(TENANT_REPO));

  it("declares the explicit-tenant disk-read helper", () => {
    expect(active).toContain("function readProfoundImportRunsForTenant");
  });

  it("helper accepts tenantId: string as the first parameter", () => {
    const re =
      /function\s+readProfoundImportRunsForTenant\s*\(\s*\n?\s*tenantId:\s*string/;
    expect(active).toMatch(re);
  });

  it("helper resolves slug via getTenant(tenantId)", () => {
    expect(active).toContain("getTenant(tenantId)");
  });

  it("helper honors BEACON_TENANT_ID / BEACON_TENANT_SLUG bootstrap fallback", () => {
    expect(active).toContain("BEACON_TENANT_ID");
    expect(active).toContain("BEACON_TENANT_SLUG");
  });

  it("helper uses getDataDir(slug) for the per-tenant path", () => {
    expect(active).toContain("getDataDir(slug)");
  });

  it("helper reads the disk file directly via readFileSync", () => {
    expect(active).toContain("readFileSync");
  });

  it("getProfoundImportRuns method body does NOT call readStore(\"observation-runs\")", () => {
    const callRe =
      /readStore\s*(?:<[^>]*>\s*)?\(\s*["']observation-runs["']\s*\)/;
    expect(active).not.toMatch(callRe);
  });

  it("getProfoundImportRuns method body does NOT call readDotDataJson(\"observation-runs\")", () => {
    const callRe =
      /readDotDataJson\s*(?:<[^>]*>\s*)?\(\s*["']observation-runs["']\s*\)/;
    expect(active).not.toMatch(callRe);
  });

  it("source does NOT import from @/storage/canonical-store", () => {
    const offending =
      active.includes('"@/storage/canonical-store"') ||
      active.includes("'@/storage/canonical-store'");
    expect(offending).toBe(false);
  });
});

describe("Architecture — supabase-backend reads observation_runs with explicit tenant + run_type filters", () => {
  const active = stripComments(read(SUPABASE_BACKEND));

  it("declares the row→ProfoundImportRun mapper helper", () => {
    expect(active).toContain("function mapObservationRunRowToProfoundImportRun");
  });

  it("forTenant.getProfoundImportRuns queries the observation_runs table", () => {
    expect(active).toMatch(/\.from\(\s*["']observation_runs["']\s*\)/);
  });

  it("query scopes by explicit tenantId via .eq(\"tenant_id\", tenantId)", () => {
    expect(active).toMatch(/\.eq\(\s*["']tenant_id["']\s*,\s*tenantId\s*\)/);
  });

  it("query filters to native-poll rows via .eq(\"run_type\", \"citation_sample_import\")", () => {
    expect(active).toMatch(
      /\.eq\(\s*["']run_type["']\s*,\s*["']citation_sample_import["']\s*\)/,
    );
  });

  it("getProfoundImportRuns body invokes the mapper", () => {
    // Anchor the call site after the getProfoundImportRuns method
    // declaration so we don't false-positive on the mapper's own
    // definition further up the file.
    const methodOffset = active.indexOf("getProfoundImportRuns:");
    expect(methodOffset).toBeGreaterThan(0);
    const callOffset = active.indexOf(
      "mapObservationRunRowToProfoundImportRun(",
      methodOffset,
    );
    expect(callOffset).toBeGreaterThan(methodOffset);
  });

  it("does NOT call readStore(\"observation-runs\") (ambient-routed)", () => {
    const callRe =
      /readStore\s*(?:<[^>]*>\s*)?\(\s*["']observation-runs["']\s*\)/;
    expect(active).not.toMatch(callRe);
  });

  it("does NOT call readDotDataJson(\"observation-runs\") (ambient-routed)", () => {
    const callRe =
      /readDotDataJson\s*(?:<[^>]*>\s*)?\(\s*["']observation-runs["']\s*\)/;
    expect(active).not.toMatch(callRe);
  });

  it("forTenant.getProfoundImportRuns body does NOT call .getObservationRuns(", () => {
    // The website-crawl reader. Section 5 must NOT consume that
    // shape. Negative-lookbehind tolerates `.getProfoundImportRuns(`
    // (the legitimate Section 5 method name).
    const methodOffset = active.indexOf("getProfoundImportRuns:");
    expect(methodOffset).toBeGreaterThan(0);
    const body = active.slice(
      methodOffset,
      Math.min(active.length, methodOffset + 2000),
    );
    expect(body).not.toMatch(/(?<!Profound)\.getObservationRuns\s*\(/);
  });

  it("does NOT import from @/storage/canonical-store", () => {
    const offending =
      active.includes('"@/storage/canonical-store"') ||
      active.includes("'@/storage/canonical-store'");
    expect(offending).toBe(false);
  });
});
