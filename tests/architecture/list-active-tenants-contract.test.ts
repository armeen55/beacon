/**
 * Architecture invariant — Gap A (2026-05-07).
 *
 * Pins the active-tenants lister contract:
 *
 *   - scripts/list-active-tenants.ts exists.
 *   - DB-preferred + JSON-fallback precedence.
 *   - Output shape: { tenantId, slug, siteDomain, enabled: true }[].
 *   - Refuses rows missing required fields.
 *   - Fail-loud (exit 1) on zero active tenants.
 *   - daily-native-poll.yml's compute-matrix step calls the script.
 *   - JSON file (ops/active-tenants.json) preserved as fallback.
 *   - Fleet is Ritz + Iranopedia as of 2026-06-10 (P0 wall 2); the
 *     fallback file mirrors the DB fleet.
 *   - No tenant injected by the script itself.
 *   - No paid API calls.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const LISTER_PATH = join(REPO_ROOT, "scripts/list-active-tenants.ts");
const POLL_YAML_PATH = join(REPO_ROOT, ".github/workflows/daily-native-poll.yml");
const ACTIVE_TENANTS_JSON_PATH = join(REPO_ROOT, "ops/active-tenants.json");

const LISTER_SRC = readFileSync(LISTER_PATH, "utf8");
const POLL_YAML = readFileSync(POLL_YAML_PATH, "utf8");
const ACTIVE_TENANTS = JSON.parse(readFileSync(ACTIVE_TENANTS_JSON_PATH, "utf8")) as Array<{
  tenantId: string;
  slug: string;
  siteDomain: string;
  enabled: boolean;
}>;

/** Strip /* ... *​/ + // comments (so docstring mentions don't false-positive). */
function stripJsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

describe("Gap A — list-active-tenants script contract", () => {
  it("file exists at the documented path", () => {
    expect(existsSync(LISTER_PATH)).toBe(true);
  });

  it("declares both Supabase and JSON sources", () => {
    expect(LISTER_SRC).toMatch(/function readFromSupabase\(/);
    expect(LISTER_SRC).toMatch(/function readFromJson\(/);
  });

  it("DB path is preferred over JSON path", () => {
    // The main() function tries Supabase FIRST; only falls back to JSON
    // when DB returns null. Pin the source-text precedence.
    const code = stripJsComments(LISTER_SRC);
    const main = code.match(/async function main\([\s\S]*?\}\s*$/m)?.[0] ?? "";
    const dbIdx = main.indexOf("readFromSupabase");
    const jsonIdx = main.indexOf("readFromJson");
    expect(dbIdx).toBeGreaterThan(0);
    expect(jsonIdx).toBeGreaterThan(0);
    expect(dbIdx).toBeLessThan(jsonIdx);
  });

  it("DB query filters by status='active' (matches the BeaconTenant.status enum)", () => {
    expect(LISTER_SRC).toMatch(/\.eq\(\s*"status"\s*,\s*"active"\s*\)/);
  });

  it("DB query selects only the 4 required fields (id, slug, domain, status)", () => {
    expect(LISTER_SRC).toMatch(/\.select\(\s*"id, slug, domain, status"\s*\)/);
  });

  it("output shape is exactly { tenantId, slug, siteDomain, enabled: true }", () => {
    // Pin via the type alias declaration.
    expect(LISTER_SRC).toMatch(
      /type MatrixTenant = \{[\s\S]{0,200}tenantId: string;[\s\S]{0,200}slug: string;[\s\S]{0,200}siteDomain: string;[\s\S]{0,200}enabled: true;/,
    );
  });

  it("DB column mapping is id→tenantId, slug→slug, domain→siteDomain", () => {
    // Source-text pin against accidental column drift.
    expect(LISTER_SRC).toMatch(/tenantId:\s*row\.id\s*\?\?/);
    expect(LISTER_SRC).toMatch(/slug:\s*row\.slug\s*\?\?/);
    expect(LISTER_SRC).toMatch(/siteDomain:\s*row\.domain\s*\?\?/);
  });

  it("validates required fields (refuses empty tenantId/slug/siteDomain)", () => {
    expect(LISTER_SRC).toMatch(/function isValidEntry/);
    // The validator must check all three string fields are non-empty.
    expect(LISTER_SRC).toMatch(/typeof o\.tenantId === "string"\s*&&\s*o\.tenantId\.length > 0/);
    expect(LISTER_SRC).toMatch(/typeof o\.slug === "string"\s*&&\s*o\.slug\.length > 0/);
    expect(LISTER_SRC).toMatch(/typeof o\.siteDomain === "string"\s*&&\s*o\.siteDomain\.length > 0/);
  });

  it("exits non-zero with structured ::error on zero active tenants", () => {
    const code = stripJsComments(LISTER_SRC);
    expect(code).toMatch(/active\.length === 0[\s\S]{0,400}process\.exit\(1\)/);
  });

  it("logs WARN when falling back from Supabase to JSON", () => {
    expect(LISTER_SRC).toMatch(/Falling back to ops\/active-tenants\.json/);
  });

  it("is read-only — does not mutate any persisted store", () => {
    const code = stripJsComments(LISTER_SRC);
    expect(code).not.toMatch(/\.from\("[^"]+"\)\.upsert/);
    expect(code).not.toMatch(/\.from\("[^"]+"\)\.insert/);
    expect(code).not.toMatch(/\.from\("[^"]+"\)\.delete/);
    expect(code).not.toMatch(/\.from\("[^"]+"\)\.update/);
    expect(code).not.toMatch(/writeStore\(/);
    expect(code).not.toMatch(/writeFileSync\(/);
  });

  it("does NOT call paid APIs / OpenAI / Perplexity / scans", () => {
    const code = stripJsComments(LISTER_SRC);
    expect(code).not.toMatch(/openai/i);
    expect(code).not.toMatch(/perplexity/i);
    expect(code).not.toMatch(/runWebsiteScan/);
    expect(code).not.toMatch(/runNativePoll/);
  });

  it("does NOT inject a second tenant", () => {
    // The script reads existing tenants. It must not contain any
    // hardcoded tenant id that isn't already in the data sources.
    const code = stripJsComments(LISTER_SRC);
    // Allow the Ritz id to appear in a comment (it doesn't post-strip),
    // but it must not be hardcoded in the active code.
    expect(code).not.toContain("tenantId: \"tenant-");
    expect(code).not.toContain("'tenant-ritz");
    expect(code).not.toMatch(/active\.push\(/);
  });
});

describe("Gap A — workflow integration", () => {
  it("compute-matrix calls scripts/list-active-tenants.ts via npx tsx", () => {
    expect(POLL_YAML).toMatch(
      /npx tsx --require \.\/scripts\/mock-server-only\.cjs scripts\/list-active-tenants\.ts/,
    );
  });

  it("compute-matrix sets up Node + npm ci before calling the lister", () => {
    // Anchor on the JOB declaration (2-space indent at line start), not
    // the file-top comment block which also contains the string.
    const computeBlock = POLL_YAML.match(/\n {2}compute-matrix:[\s\S]{0,4000}/)?.[0] ?? "";
    expect(computeBlock).toContain("actions/checkout@v4");
    expect(computeBlock).toContain("actions/setup-node@v4");
    expect(computeBlock).toContain("npm ci --no-audit --no-fund");
  });

  it("compute-matrix env block exposes Supabase secrets to the lister", () => {
    const computeBlock = POLL_YAML.match(/\n {2}compute-matrix:[\s\S]{0,4000}/)?.[0] ?? "";
    expect(computeBlock).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(computeBlock).toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("compute-matrix preserves the Ritz fail-loud guard", () => {
    expect(POLL_YAML).toMatch(
      /Ritz \(tenant-ritz-founder\) is missing or disabled — refusing to run cron/,
    );
  });

  it("compute-matrix preserves the empty-matrix fail-loud guard", () => {
    expect(POLL_YAML).toMatch(/No active tenants — refusing to run cron with empty matrix/);
  });

  it("scheduled poll jobs still use npm run cron:poll (Bundle 2 architecture preserved)", () => {
    expect(POLL_YAML).toMatch(/npm run cron:poll[\s\S]{0,200}--platform=perplexity/);
    expect(POLL_YAML).toMatch(/npm run cron:poll[\s\S]{0,200}--platform=openai/);
  });

  it("scheduled poll jobs still do NOT curl /api/poll/run (Bundle 2 architecture preserved)", () => {
    // Strip YAML comments so file-top documentation referencing /api/poll/run
    // doesn't false-positive.
    const stripped = POLL_YAML
      .split("\n")
      .map((l) => l.replace(/(^|[^"'#])#.*$/, "$1"))
      .join("\n");
    expect(stripped).not.toContain("/api/poll/run");
  });

  it("verify-persistence + rebuild-citation-evidence-index jobs still wired", () => {
    expect(/^\s*verify-persistence:/m.test(POLL_YAML)).toBe(true);
    expect(/^\s*rebuild-citation-evidence-index:/m.test(POLL_YAML)).toBe(true);
  });
});

describe("Gap A — JSON file fallback preserved + Ritz-only invariant", () => {
  it("ops/active-tenants.json file still exists (fallback safety net)", () => {
    expect(existsSync(ACTIVE_TENANTS_JSON_PATH)).toBe(true);
  });

  // 2026-06-10 (P0 wall 2): the fallback file now mirrors the two-tenant
  // fleet (Ritz + Iranopedia) so a Supabase outage degrades to the SAME
  // fleet, not a Ritz-only one.
  it("ops/active-tenants.json has exactly 2 enabled tenants (Ritz + Iranopedia)", () => {
    expect(Array.isArray(ACTIVE_TENANTS)).toBe(true);
    const enabled = ACTIVE_TENANTS.filter((t) => t.enabled === true);
    expect(enabled.length).toBe(2);
    const ids = enabled.map((t) => t.tenantId).sort();
    expect(ids).toEqual(["tenant-iranopedia", "tenant-ritz-founder"]);
  });

  it("ops/active-tenants.json contains NO second-tenant slugs (acme/customer-2/etc.)", () => {
    const raw = readFileSync(ACTIVE_TENANTS_JSON_PATH, "utf8");
    expect(raw).not.toMatch(/acme/i);
    expect(raw).not.toMatch(/customer-2/i);
    expect(raw).not.toMatch(/placeholder/i);
  });
});
