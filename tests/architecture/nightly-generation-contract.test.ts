/**
 * Architecture invariant — nightly generation workflow (P0 wall 1,
 * 2026-06-10). "The queue refills while you sleep."
 *
 * Pins .github/workflows/nightly-generation.yml +
 * scripts/run-scheduled-generation.ts:
 *
 *   1. Schedule sits BETWEEN the 04:00 UTC scan (fresh snapshots) and
 *      the 07:00 UTC poll: 05:30 UTC.
 *   2. Matrix comes from the SAME lister as scan/poll (DB-preferred).
 *   3. Required-tenant guard present (configurable, Ritz default).
 *   4. The generate job pins BEACON_LLM_PROVIDER=deterministic — the
 *      nightly job must never be able to spend LLM money.
 *   5. Live-write mode is explicit env (repo var, default 'true') and
 *      the runner honors the SAME strict gate as the operator surface.
 *   6. Kill switch (BEACON_GENERATION_DISABLED) is wired.
 *   7. Failure alert job exists (deduped GitHub issue).
 *   8. The runner script exists, calls promoteEligibleCandidates, and
 *      fails the job when the Supabase sync degrades (ephemeral runner
 *      FS means a sync warning = the night's rows did not persist).
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const YAML = readFileSync(
  resolve(REPO_ROOT, ".github/workflows/nightly-generation.yml"),
  "utf8",
);
const RUNNER = readFileSync(
  resolve(REPO_ROOT, "scripts/run-scheduled-generation.ts"),
  "utf8",
);

describe("nightly-generation.yml — schedule + matrix", () => {
  it("declares NO cron (2026-06-15: crons off) but keeps workflow_dispatch", () => {
    // Operator disabled all GitHub Actions + removed nightly crons; generation
    // runs on-demand (in-app refresh / manual dispatch). Re-add `cron: "30 5
    // * * *"` only to restore the nightly schedule.
    expect(YAML).not.toMatch(/-\s*cron:/);
    expect(YAML).toMatch(/workflow_dispatch:/);
  });

  it("computes the matrix via the shared lister (DB-preferred)", () => {
    expect(YAML).toContain("scripts/list-active-tenants.ts");
  });

  it("has the configurable required-tenant guard (Ritz default)", () => {
    expect(YAML).toMatch(
      /REQUIRED_TENANT_ID:\s*\$\{\{\s*vars\.BEACON_REQUIRED_TENANT_ID\s*\|\|\s*'tenant-ritz-founder'\s*\}\}/,
    );
    expect(YAML).toMatch(/Required tenant \(\$REQUIRED_TENANT_ID\) is missing or inactive/);
  });

  it("generate job sources tenant identity from the matrix", () => {
    expect(YAML).toMatch(/BEACON_TENANT_ID:\s*\$\{\{\s*matrix\.tenant\.tenantId\s*\}\}/);
    expect(YAML).toMatch(/BEACON_TENANT_SLUG:\s*\$\{\{\s*matrix\.tenant\.slug\s*\}\}/);
  });
});

describe("nightly-generation.yml — safety pins", () => {
  it("pins BEACON_LLM_PROVIDER=deterministic (no LLM spend from this job, ever)", () => {
    expect(YAML).toMatch(/BEACON_LLM_PROVIDER:\s*deterministic/);
  });

  it("live-write mode is the repo var with default 'true' (explicit, flippable without a commit)", () => {
    expect(YAML).toMatch(
      /BEACON_PROMOTION_LIVE_WRITE_ENABLED:\s*\$\{\{\s*vars\.BEACON_PROMOTION_LIVE_WRITE_ENABLED\s*\|\|\s*'true'\s*\}\}/,
    );
  });

  it("kill switch is wired from secrets", () => {
    expect(YAML).toMatch(
      /BEACON_GENERATION_DISABLED:\s*\$\{\{\s*secrets\.BEACON_GENERATION_DISABLED\s*\}\}/,
    );
  });

  it("has the deduped failure-alert job", () => {
    expect(YAML).toMatch(/alert-on-failure:/);
    expect(YAML).toContain("Nightly recommendation generation is failing");
  });
});

describe("run-scheduled-generation.ts — runner contract", () => {
  it("calls promoteEligibleCandidates with the tenant from env", () => {
    expect(RUNNER).toContain("promoteEligibleCandidates");
    expect(RUNNER).toMatch(/tenantId,\s*\n?\s*dryRun: mode\.dryRun/);
  });

  it("honors the strict live-write gate semantics (=== \"true\")", () => {
    expect(RUNNER).toMatch(
      /env\.BEACON_PROMOTION_LIVE_WRITE_ENABLED === "true"/,
    );
  });

  it("fails the job on a Supabase sync warning (ephemeral runner FS)", () => {
    expect(RUNNER).toMatch(/sync_warning[\s\S]{0,400}process\.exit\(1\)/);
  });

  it("never imports an LLM provider or gateway", () => {
    expect(RUNNER).not.toMatch(/openai/i);
    expect(RUNNER).not.toMatch(/llm-draft-gateway/);
  });
});
