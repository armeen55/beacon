/**
 * Multi-tenant cron scaffold invariants (2026-05-06).
 *
 * Pins the contract introduced when daily-native-poll.yml + daily-scan.yml
 * were refactored from hardcoded `tenant-ritz-founder` request bodies to
 * a matrix-from-JSON shape sourced from `ops/active-tenants.json`.
 *
 * Goals (operator brief):
 *   • Customer-2-ready cron architecture WITHOUT actually running paid
 *     polls for a second tenant.
 *   • Ritz remains the only enabled tenant by default.
 *   • Tomorrow's cron must not silently skip Ritz — fail loud if Ritz
 *     is missing or disabled in the active-tenants config.
 *
 * What's pinned here:
 *   1. ops/active-tenants.json shape (updated 2026-06-10, P0 wall 2):
 *      - is valid JSON
 *      - is an array
 *      - exactly two entries today: Ritz + Iranopedia, both enabled,
 *        all four required fields each; Iranopedia carries the
 *        scanMaxPages crawl-ceiling ops override
 *      - no placeholder/test tenant appears
 *
 *   2. daily-native-poll.yml:
 *      - has a `compute-matrix` job
 *      - reads `ops/active-tenants.json`
 *      - has a `Ritz (tenant-ritz-founder)` fail-loud guard
 *      - poll-perplexity + poll-openai use `strategy.matrix.tenant` from
 *        compute-matrix outputs
 *      - NO hardcoded `"tenantId":"tenant-ritz-founder"` curl bodies
 *      - all 8 chunks (4 perplexity + 4 chatgpt, offsets 0/25/50/75) are
 *        still defined
 *      - rebuild + verify-persistence are still wired (no jobs dropped)
 *
 *   3. daily-scan.yml:
 *      - has a `compute-matrix` job + same fail-loud Ritz guard
 *      - scheduled-scan uses `strategy.matrix.tenant`
 *      - tenant identity comes from the matrix (not from
 *        `secrets.BEACON_TENANT_ID` etc.)
 *
 *   4. poll-canary.yml:
 *      - has a `compute-matrix` job + same fail-loud Ritz guard
 *      - persistence-write canary's BEACON_TENANT_ID is sourced from the
 *        compute-matrix output (NOT a hardcoded `tenant-ritz-founder`
 *        literal)
 *      - documented as single-tenant-by-design (comment block present)
 *
 *   5. Profound runtime isolation invariants still pass against the new
 *      YAML (sanity — no Profound references in the matrix-refactored
 *      cron). This is enforced by the existing
 *      `profound-runtime-isolation.test.ts` file; this test does NOT
 *      duplicate that contract.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");

const ACTIVE_TENANTS_PATH = resolve(REPO_ROOT, "ops/active-tenants.json");
const POLL_YAML_PATH = resolve(
  REPO_ROOT,
  ".github/workflows/daily-native-poll.yml",
);
const SCAN_YAML_PATH = resolve(REPO_ROOT, ".github/workflows/daily-scan.yml");
const CANARY_YAML_PATH = resolve(
  REPO_ROOT,
  ".github/workflows/poll-canary.yml",
);

const ACTIVE_TENANTS_RAW = readFileSync(ACTIVE_TENANTS_PATH, "utf8");
const POLL_YAML = readFileSync(POLL_YAML_PATH, "utf8");

/**
 * Strip YAML `#` comments + trailing-line `#` comments. Does not handle
 * `#` inside YAML string literals; sufficient for these workflow files
 * which use no string-quoted hashes in the active config.
 *
 * Used by Bundle 2 (2026-05-07) invariants to assert against the active
 * configuration only — comments are documentation, not contract.
 */
function stripComments(yaml: string): string {
  return yaml
    .split("\n")
    .map((l) => l.replace(/(^|[^"'#])#.*$/, "$1"))
    .join("\n");
}
const SCAN_YAML = readFileSync(SCAN_YAML_PATH, "utf8");
const CANARY_YAML = readFileSync(CANARY_YAML_PATH, "utf8");

// ── 1. ops/active-tenants.json shape ───────────────────────────────

describe("ops/active-tenants.json — shape contract", () => {
  it("is valid JSON", () => {
    expect(() => JSON.parse(ACTIVE_TENANTS_RAW)).not.toThrow();
  });

  it("is an array", () => {
    const parsed = JSON.parse(ACTIVE_TENANTS_RAW);
    expect(Array.isArray(parsed)).toBe(true);
  });

  // 2026-06-10 (P0 wall 2): the scan fleet is two tenants — Ritz + Iranopedia.
  it("contains exactly two tenants today (Ritz + Iranopedia)", () => {
    const parsed = JSON.parse(ACTIVE_TENANTS_RAW) as ReadonlyArray<unknown>;
    expect(parsed.length).toBe(2);
  });

  it("Ritz and Iranopedia both carry all four required fields + enabled=true", () => {
    const parsed = JSON.parse(ACTIVE_TENANTS_RAW) as ReadonlyArray<{
      tenantId?: string;
      slug?: string;
      siteDomain?: string;
      enabled?: boolean;
      scanMaxPages?: number;
    }>;
    const ritz = parsed.find((t) => t.tenantId === "tenant-ritz-founder");
    expect(ritz).toBeDefined();
    expect(ritz!.slug).toBe("ritz-builders");
    expect(ritz!.siteDomain).toBe("ritzbuilders.com");
    expect(ritz!.enabled).toBe(true);

    const iranopedia = parsed.find((t) => t.tenantId === "tenant-iranopedia");
    expect(iranopedia).toBeDefined();
    expect(iranopedia!.slug).toBe("iranopedia");
    expect(iranopedia!.siteDomain).toBe("iranopedia.com");
    expect(iranopedia!.enabled).toBe(true);
    // Encyclopedia-scale crawl ceiling rides the ops file (P0 wall 2).
    expect(iranopedia!.scanMaxPages).toBe(800);
  });

  it("does NOT contain any customer-2 / acme / placeholder tenants (today's posture)", () => {
    // Catches accidental commits of a placeholder second tenant before
    // the operator intends to flip the customer-2 switch.
    const parsed = JSON.parse(ACTIVE_TENANTS_RAW) as ReadonlyArray<{
      tenantId?: string;
      slug?: string;
    }>;
    const blocklist = [
      "tenant-acme",
      "acme",
      "tenant-test",
      "tenant-customer-2",
      "tenant-customer2",
      "customer-2",
      "demo",
      "tenant-demo",
    ];
    for (const t of parsed) {
      for (const blocked of blocklist) {
        expect(
          t.tenantId === blocked,
          `Blocked tenantId "${blocked}" found in active-tenants.json — ` +
            `customer-2 onboarding is gated; remove this row.`,
        ).toBe(false);
        expect(
          t.slug === blocked,
          `Blocked slug "${blocked}" found in active-tenants.json — ` +
            `customer-2 onboarding is gated; remove this row.`,
        ).toBe(false);
      }
    }
  });

  it("every row has a non-empty tenantId, slug, siteDomain, and a boolean enabled", () => {
    const parsed = JSON.parse(ACTIVE_TENANTS_RAW) as ReadonlyArray<{
      tenantId?: unknown;
      slug?: unknown;
      siteDomain?: unknown;
      enabled?: unknown;
    }>;
    for (const t of parsed) {
      expect(typeof t.tenantId).toBe("string");
      expect((t.tenantId as string).length).toBeGreaterThan(0);
      expect(typeof t.slug).toBe("string");
      expect((t.slug as string).length).toBeGreaterThan(0);
      expect(typeof t.siteDomain).toBe("string");
      expect((t.siteDomain as string).length).toBeGreaterThan(0);
      expect(typeof t.enabled).toBe("boolean");
    }
  });
});

// ── 2. daily-native-poll.yml — matrix shape ────────────────────────

describe("daily-native-poll.yml — matrix shape", () => {
  it("declares a `compute-matrix` job that reads ops/active-tenants.json", () => {
    expect(/^\s*compute-matrix:/m.test(POLL_YAML)).toBe(true);
    expect(POLL_YAML).toContain("ops/active-tenants.json");
  });

  it("compute-matrix has a Ritz-must-be-enabled fail-loud guard", () => {
    // The exact error string is part of the contract — it's what the
    // operator reads in the GitHub Actions failure email when Ritz gets
    // accidentally removed or disabled.
    expect(POLL_YAML).toMatch(
      /Ritz \(tenant-ritz-founder\) is missing or disabled/,
    );
    // The guard must `exit 1` — fail-loud, not a warning.
    expect(POLL_YAML).toMatch(/RITZ_OK[\s\S]{0,400}exit 1/);
  });

  it("compute-matrix fails loud on missing config and zero enabled tenants", () => {
    // Gap A (2026-05-07) — compute-matrix moved from `jq -c '… select(.enabled == true)'`
    // against ops/active-tenants.json to `npx tsx scripts/list-active-tenants.ts`
    // (DB-preferred, JSON-fallback). The "missing config" guard now lives
    // INSIDE the lister script (logs ::error if both DB and JSON fail).
    // The "zero enabled tenants" guard moved to the lister too. The
    // workflow keeps its own empty-matrix guard as defense-in-depth.
    //
    // Both guards still exist, just with updated wording. Pin both.
    expect(POLL_YAML).toMatch(/No active tenants — refusing to run cron with empty matrix/);
    expect(POLL_YAML).toMatch(
      /Ritz \(tenant-ritz-founder\) is missing or disabled — refusing to run cron without Ritz/,
    );
  });

  it("poll-perplexity + poll-openai consume the matrix from compute-matrix", () => {
    expect(POLL_YAML).toMatch(
      /poll-perplexity:[\s\S]{0,600}strategy:[\s\S]{0,200}matrix:[\s\S]{0,200}tenant:\s*\$\{\{\s*fromJSON\(needs\.compute-matrix\.outputs\.tenants\)\s*\}\}/,
    );
    expect(POLL_YAML).toMatch(
      /poll-openai:[\s\S]{0,600}strategy:[\s\S]{0,200}matrix:[\s\S]{0,200}tenant:\s*\$\{\{\s*fromJSON\(needs\.compute-matrix\.outputs\.tenants\)\s*\}\}/,
    );
  });

  it("contains NO hardcoded `tenant-ritz-founder` literal in poll-job env or args", () => {
    // The pre-2026-05-06 shape literally embedded the Ritz id in 8 curl
    // bodies (jq form). Bundle 2 (2026-05-07) replaced curl chunks with
    // `npm run cron:poll -- --tenant=${{ matrix.tenant.tenantId }}` so the
    // tenant id flows from the matrix substitution, never as a literal.
    //
    // Both intents (no hardcoded tenant; substitution actually happens)
    // are still pinned — just against the new shape.
    expect(POLL_YAML).not.toMatch(/"tenantId":"tenant-[a-z0-9-]+"/);
    expect(POLL_YAML).not.toContain("--tenant=tenant-ritz-founder");
    // Matrix substitution form must be present in BOTH poll jobs so the
    // multi-tenant scaffold actually drives per-tenant runs.
    expect(POLL_YAML).toMatch(
      /--tenant=\$\{\{\s*matrix\.tenant\.tenantId\s*\}\}\s+--platform=perplexity/,
    );
    expect(POLL_YAML).toMatch(
      /--tenant=\$\{\{\s*matrix\.tenant\.tenantId\s*\}\}\s+--platform=openai/,
    );
  });

  it("each platform has exactly one CLI invocation per matrix iteration (Bundle 2 architecture)", () => {
    // Bundle 2 (2026-05-07) replaced the 4-chunk curl architecture with a
    // single `npm run cron:poll` per platform per matrix iteration. The
    // GitHub-runner has no 300s cap, so chunking is unnecessary. This
    // invariant pins the new shape so we don't regress to chunked-curl.
    //
    // Pre-Bundle-2 the jq bodies referenced `platform:"perplexity"` and
    // `offset:N` literals; those must be absent from the active
    // configuration of poll-perplexity / poll-openai jobs (comments OK).
    const code = stripComments(POLL_YAML);
    expect(code).not.toMatch(/jq -nc --arg tid/);
    expect(code).not.toMatch(/--max-time 320/);
    expect(code).not.toMatch(/api\/poll\/run/);
    expect(code).not.toMatch(/platform:"perplexity"[\s\S]{0,80}offset:/);
    expect(code).not.toMatch(/platform:"openai"[\s\S]{0,80}offset:/);
    // Exactly one cron:poll call per platform job — match in active code.
    const perpCalls = (
      code.match(/--platform=perplexity\b/g) ?? []
    ).length;
    const oaiCalls = (
      code.match(/--platform=openai\b/g) ?? []
    ).length;
    expect(perpCalls).toBe(1);
    expect(oaiCalls).toBe(1);
  });

  it("rebuild-citation-evidence-index + verify-persistence jobs still exist", () => {
    expect(/^\s*rebuild-citation-evidence-index:/m.test(POLL_YAML)).toBe(true);
    expect(/^\s*verify-persistence:/m.test(POLL_YAML)).toBe(true);
  });

  it("verify-persistence depends on compute-matrix + both poll jobs + rebuild", () => {
    expect(POLL_YAML).toMatch(
      /verify-persistence:[\s\S]{0,400}needs:\s*\[\s*compute-matrix\s*,\s*poll-perplexity\s*,\s*poll-openai\s*,\s*rebuild-citation-evidence-index\s*\]/,
    );
  });
});

// ── 3. daily-scan.yml — matrix shape ────────────────────────────────

describe("daily-scan.yml — matrix shape", () => {
  // 2026-06-10 (P0 wall 2): the scan matrix is DB-driven via the SAME
  // lister the poll uses; the Ritz literal guard became a configurable
  // required-tenant guard (repo var BEACON_REQUIRED_TENANT_ID, default
  // tenant-ritz-founder).
  it("declares a `compute-matrix` job using the DB-first lister + required-tenant guard", () => {
    expect(/^\s*compute-matrix:/m.test(SCAN_YAML)).toBe(true);
    expect(SCAN_YAML).toContain("scripts/list-active-tenants.ts");
    expect(SCAN_YAML).toMatch(
      /Required tenant \(\$REQUIRED_TENANT_ID\) is missing or inactive/,
    );
    expect(SCAN_YAML).toMatch(
      /REQUIRED_TENANT_ID:\s*\$\{\{\s*vars\.BEACON_REQUIRED_TENANT_ID\s*\|\|\s*'tenant-ritz-founder'\s*\}\}/,
    );
  });

  it("scheduled-scan job passes the per-tenant crawl ceiling from the matrix", () => {
    expect(SCAN_YAML).toMatch(
      /BEACON_SCAN_MAX_PAGES:\s*\$\{\{\s*matrix\.tenant\.scanMaxPages\s*\|\|\s*''\s*\}\}/,
    );
  });

  it("scheduled-scan job uses matrix.tenant from compute-matrix outputs", () => {
    expect(SCAN_YAML).toMatch(
      /scheduled-scan:[\s\S]{0,1200}strategy:[\s\S]{0,200}matrix:[\s\S]{0,200}tenant:\s*\$\{\{\s*fromJSON\(needs\.compute-matrix\.outputs\.tenants\)\s*\}\}/,
    );
  });

  it("tenant identity (BEACON_TENANT_ID/SLUG/SITE_DOMAIN) comes from the matrix entry, not GH secrets", () => {
    // Pre-refactor these came from `secrets.BEACON_TENANT_ID` etc.
    // Post-refactor they come from `matrix.tenant.tenantId` etc.
    expect(SCAN_YAML).toMatch(
      /BEACON_TENANT_ID:\s*\$\{\{\s*matrix\.tenant\.tenantId\s*\}\}/,
    );
    expect(SCAN_YAML).toMatch(
      /BEACON_TENANT_SLUG:\s*\$\{\{\s*matrix\.tenant\.slug\s*\}\}/,
    );
    expect(SCAN_YAML).toMatch(
      /BEACON_SITE_DOMAIN:\s*\$\{\{\s*matrix\.tenant\.siteDomain\s*\}\}/,
    );
    // Negative invariant: must NOT pull tenant identity from secrets.
    expect(SCAN_YAML).not.toMatch(
      /BEACON_TENANT_ID:\s*\$\{\{\s*secrets\.BEACON_TENANT_ID\s*\}\}/,
    );
  });
});

// ── 4. poll-canary.yml — single-tenant by documented design ─────────

describe("poll-canary.yml — single-tenant-by-documented-design", () => {
  it("declares a `compute-matrix` job with the Ritz fail-loud guard", () => {
    expect(/^\s*compute-matrix:/m.test(CANARY_YAML)).toBe(true);
    expect(CANARY_YAML).toContain("ops/active-tenants.json");
    expect(CANARY_YAML).toMatch(
      /Ritz \(tenant-ritz-founder\) is missing or disabled/,
    );
  });

  it("documents in a comment block that the canary is single-tenant by design", () => {
    expect(CANARY_YAML).toMatch(/single-tenant by documented design/i);
  });

  it("persistence-write canary BEACON_TENANT_ID comes from compute-matrix output, NOT hardcoded", () => {
    // Negative: the pre-2026-05-06 hardcoded literal must be gone.
    expect(CANARY_YAML).not.toMatch(/BEACON_TENANT_ID:\s*tenant-ritz-founder/);
    // Positive: must read from the compute-matrix output.
    expect(CANARY_YAML).toMatch(
      /BEACON_TENANT_ID:\s*\$\{\{\s*needs\.compute-matrix\.outputs\.first_tenant_id\s*\}\}/,
    );
  });

  it("warns operator if more than one tenant is enabled (multi-tenant readiness gate)", () => {
    // Documented future-proofing: when COUNT > 1, the canary emits a
    // ::warning so the operator knows scripts/check-yesterday-poll.ts
    // and this workflow need a refactor before relying on the canary
    // for multi-tenant coverage.
    expect(CANARY_YAML).toMatch(
      /More than one tenant is enabled[\s\S]{0,200}revisit/,
    );
  });
});
