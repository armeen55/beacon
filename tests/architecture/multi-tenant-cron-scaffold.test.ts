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
 *   1. ops/active-tenants.json shape:
 *      - is valid JSON
 *      - is an array
 *      - exactly one entry today
 *      - that entry is Ritz (tenantId === "tenant-ritz-founder",
 *        slug === "ritz-builders", siteDomain === "ritzbuilders.com",
 *        enabled === true)
 *      - no customer-2 slug or id appears
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

  it("contains exactly one tenant today (Ritz only)", () => {
    const parsed = JSON.parse(ACTIVE_TENANTS_RAW) as ReadonlyArray<unknown>;
    expect(parsed.length).toBe(1);
  });

  it("the single tenant is Ritz with all four required fields + enabled=true", () => {
    const parsed = JSON.parse(ACTIVE_TENANTS_RAW) as ReadonlyArray<{
      tenantId?: string;
      slug?: string;
      siteDomain?: string;
      enabled?: boolean;
    }>;
    expect(parsed.length).toBe(1);
    const t = parsed[0];
    expect(t.tenantId).toBe("tenant-ritz-founder");
    expect(t.slug).toBe("ritz-builders");
    expect(t.siteDomain).toBe("ritzbuilders.com");
    expect(t.enabled).toBe(true);
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
    expect(POLL_YAML).toMatch(/ops\/active-tenants\.json is missing/);
    expect(POLL_YAML).toMatch(/No tenants with enabled=true/);
  });

  it("poll-perplexity + poll-openai consume the matrix from compute-matrix", () => {
    expect(POLL_YAML).toMatch(
      /poll-perplexity:[\s\S]{0,600}strategy:[\s\S]{0,200}matrix:[\s\S]{0,200}tenant:\s*\$\{\{\s*fromJSON\(needs\.compute-matrix\.outputs\.tenants\)\s*\}\}/,
    );
    expect(POLL_YAML).toMatch(
      /poll-openai:[\s\S]{0,600}strategy:[\s\S]{0,200}matrix:[\s\S]{0,200}tenant:\s*\$\{\{\s*fromJSON\(needs\.compute-matrix\.outputs\.tenants\)\s*\}\}/,
    );
  });

  it("contains NO hardcoded `tenantId\":\"tenant-ritz-founder\"` curl bodies", () => {
    // The pre-2026-05-06 shape literally embedded the Ritz id in 8 curl
    // bodies. Post-refactor every body is built via `jq -nc --arg tid`.
    // This invariant prevents any future regression that re-hardcodes
    // a tenant id in a curl body.
    expect(POLL_YAML).not.toMatch(/"tenantId":"tenant-[a-z0-9-]+"/);
    expect(POLL_YAML).not.toContain("\"tenantId\":\"tenant-ritz-founder\"");
    // jq form must be present (so we know the substitution actually happens).
    expect(POLL_YAML).toMatch(
      /jq -nc --arg tid "\$\{\{\s*matrix\.tenant\.tenantId\s*\}\}"/,
    );
  });

  it("all 8 native poll chunks are still defined (4 perplexity + 4 chatgpt)", () => {
    // Each platform must have offset=0, 25, 50, 75 chunks. The string
    // form `offset:0` / `offset:25` / etc. inside the jq body proves
    // the chunk is still wired.
    for (const offset of [0, 25, 50, 75]) {
      const perp = new RegExp(
        `platform:"perplexity"[\\s\\S]{0,80}offset:${offset}\\b`,
      );
      const oai = new RegExp(
        `platform:"openai"[\\s\\S]{0,80}offset:${offset}\\b`,
      );
      expect(perp.test(POLL_YAML)).toBe(true);
      expect(oai.test(POLL_YAML)).toBe(true);
    }
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
  it("declares a `compute-matrix` job with the Ritz fail-loud guard", () => {
    expect(/^\s*compute-matrix:/m.test(SCAN_YAML)).toBe(true);
    expect(SCAN_YAML).toContain("ops/active-tenants.json");
    expect(SCAN_YAML).toMatch(
      /Ritz \(tenant-ritz-founder\) is missing or disabled/,
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
