/**
 * Recommendation Lifecycle OS — Phase 5 (2026-04-28).
 *
 * Architecture invariants for the scheduled-scan + cron infrastructure.
 * Pure source-scan — no I/O, no DB, no HTTP.
 *
 *   - .github/workflows/daily-scan.yml is parseable YAML
 *   - daily-scan workflow targets the correct script entry
 *   - daily-scan cron runs BEFORE the daily-native-poll cron
 *   - daily-scan workflow exports the env vars run-scheduled-scan.ts
 *     fail-louds on (BEACON_TENANT_ID, BEACON_TENANT_SLUG)
 *   - scripts/run-scheduled-scan.ts has the kill-switch check + the
 *     fail-loud guards in the right order
 *   - /api/cron/scan/route.ts has the auth-then-kill-switch ordering
 *     (security: don't leak operational state to unauth probes)
 *   - the route imports runWebsiteScan (the same path the operator
 *     verified via Steps 1–5 of the safety gate)
 *   - no LLM provider imports anywhere in the cron path
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(__dirname, "../..");

function read(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

const WORKFLOW = read(".github/workflows/daily-scan.yml");
const POLL_WORKFLOW = read(".github/workflows/daily-native-poll.yml");
const SCRIPT = read("scripts/run-scheduled-scan.ts");
const ROUTE = read("src/app/api/cron/scan/route.ts");

describe("Phase 5 — daily-scan workflow YAML structure", () => {
  it("declares schedule + workflow_dispatch triggers", () => {
    expect(WORKFLOW).toMatch(/^on:\s*$/m);
    // The cron is preceded by comment lines under `schedule:`; allow any
    // intervening whitespace + comment lines.
    expect(WORKFLOW).toMatch(/schedule:[\s\S]*?-\s*cron:\s*["']?0\s+4\s+\*\s+\*\s+\*["']?/);
    expect(WORKFLOW).toMatch(/workflow_dispatch:/);
  });

  it("declares concurrency group to prevent overlapping runs", () => {
    expect(WORKFLOW).toMatch(/^concurrency:/m);
    // 2026-06-11: the group is conditional — tenant-scoped dispatches get
    // their own group so a launch-time first scan can NEVER cancel the
    // nightly fleet run; the scheduled path keeps the EXACT historical
    // group string (pinned below).
    expect(WORKFLOW).toMatch(/'daily-scheduled-scan'/);
    expect(WORKFLOW).toMatch(/scan-tenant-\{0\}/);
    expect(WORKFLOW).toMatch(/cancel-in-progress:\s+true/);
  });

  it("tenant-scoped dispatch contract: only_tenant input + matrix filter + fleet-only required-tenant guard", () => {
    expect(WORKFLOW).toMatch(/only_tenant:/);
    expect(WORKFLOW).toMatch(/required:\s+false/);
    // The matrix filter applies ONLY when ONLY_TENANT is set…
    expect(WORKFLOW).toMatch(/if \[ -n "\$\{ONLY_TENANT:-\}" \]; then/);
    // …and the required-tenant (anchor-customer) guard applies ONLY to
    // fleet runs — requiring Ritz inside a single-tenant run would block
    // every other tenant's first scan.
    expect(WORKFLOW).toMatch(/if \[ -z "\$\{ONLY_TENANT:-\}" \]; then/);
    expect(WORKFLOW).toMatch(/ONLY_TENANT:\s+\$\{\{ inputs\.only_tenant \}\}/);
  });

  it("invokes scripts/run-scheduled-scan.ts (the canonical entry)", () => {
    expect(WORKFLOW).toMatch(/scripts\/run-scheduled-scan\.ts/);
  });

  it("uses the same require-shim pattern as npm run data:scan", () => {
    expect(WORKFLOW).toMatch(/--require\s+\.\/scripts\/mock-server-only\.cjs/);
    expect(WORKFLOW).toMatch(/--require\s+\.\/scripts\/apply-scan-site-domain\.cjs/);
  });

  it("exports required env vars (fail-loud surface in run-scheduled-scan.ts)", () => {
    // 2026-05-06 multi-tenant-cron-scaffold refactor:
    //   - Tenant identity (BEACON_TENANT_ID / BEACON_TENANT_SLUG /
    //     BEACON_SITE_DOMAIN) is now sourced from the matrix entry the
    //     compute-matrix job emits, NOT from GH secrets. Matched as
    //     `${{ matrix.tenant.<key> }}`.
    //   - Credentials + dual-write toggles continue to come from
    //     secrets / hardcoded literals.
    const tenantBindings: Record<string, string> = {
      BEACON_TENANT_ID: "tenantId",
      BEACON_TENANT_SLUG: "slug",
    };
    for (const [envKey, matrixKey] of Object.entries(tenantBindings)) {
      expect(WORKFLOW, `${envKey} env binding (matrix)`).toMatch(
        new RegExp(
          `${envKey}:\\s+\\$\\{\\{\\s*matrix\\.tenant\\.${matrixKey}\\s*\\}\\}`,
        ),
      );
    }
    for (const v of [
      "NEXT_PUBLIC_SUPABASE_URL",
      "SUPABASE_SERVICE_ROLE_KEY",
      "DATA_SOURCE",
      "DUAL_WRITE",
    ]) {
      expect(WORKFLOW, `${v} env binding`).toMatch(
        new RegExp(
          `${v}:\\s+(["']?supabase["']?|"true"|\\$\\{\\{ secrets\\.${v} \\}\\})`,
        ),
      );
    }
  });

  it("exports optional lifecycle/kill-switch env vars (operator can flip later)", () => {
    // 2026-05-06: BEACON_SITE_DOMAIN moved to matrix.tenant.siteDomain;
    // remaining lifecycle / kill-switch flags still come from secrets
    // so the operator can toggle without editing ops/active-tenants.json.
    expect(WORKFLOW, "BEACON_SITE_DOMAIN env binding (matrix)").toMatch(
      /BEACON_SITE_DOMAIN:\s+\$\{\{\s*matrix\.tenant\.siteDomain\s*\}\}/,
    );
    for (const v of [
      "BEACON_LIFECYCLE_ENABLED",
      "BEACON_LIFECYCLE_VERDICT_ENABLED",
      "BEACON_SCAN_DISABLED",
    ]) {
      expect(WORKFLOW, `${v} env binding`).toMatch(
        new RegExp(`${v}:\\s+\\$\\{\\{ secrets\\.${v} \\}\\}`),
      );
    }
  });
});

describe("Phase 5 — cron schedule ordering vs native poll", () => {
  it("daily-scan runs at 04:00 UTC; daily-native-poll runs at 07:00 UTC; scan runs FIRST", () => {
    // Extract the cron strings from both workflow YAMLs and assert the
    // scan's hour is strictly less than the poll's hour. This pins the
    // ordering operator chose: scan before poll so fresh inventory +
    // lifecycle stamps land before the day's observations are captured.
    const scanCron = WORKFLOW.match(/cron:\s*["']?(0\s+\d+\s+\*\s+\*\s+\*)["']?/);
    const pollCron = POLL_WORKFLOW.match(/cron:\s*["']?(0\s+\d+\s+\*\s+\*\s+\*)["']?/);
    expect(scanCron, "daily-scan cron not found").not.toBeNull();
    expect(pollCron, "daily-native-poll cron not found").not.toBeNull();
    const scanHour = parseInt(scanCron![1].split(/\s+/)[1], 10);
    const pollHour = parseInt(pollCron![1].split(/\s+/)[1], 10);
    expect(scanHour).toBeLessThan(pollHour);
  });
});

describe("Phase 5 — scripts/run-scheduled-scan.ts structure", () => {
  it("checks BEACON_SCAN_DISABLED kill switch BEFORE invoking runWebsiteScan", () => {
    // Anchor on actual code, not docstring/import strings:
    //   - kill-switch RUNTIME check: `BEACON_SCAN_DISABLED?.trim()`
    //   - runWebsiteScan INVOCATION: `await runWebsiteScan({`
    const killIdx = SCRIPT.indexOf("BEACON_SCAN_DISABLED?.trim()");
    const runIdx = SCRIPT.indexOf("await runWebsiteScan({");
    expect(killIdx).toBeGreaterThan(-1);
    expect(runIdx).toBeGreaterThan(-1);
    expect(killIdx).toBeLessThan(runIdx);
  });

  it("supports all 4 truthy kill-switch values (1/true/yes/on)", () => {
    expect(SCRIPT).toMatch(/===\s*["']1["']/);
    expect(SCRIPT).toMatch(/===\s*["']true["']/);
    expect(SCRIPT).toMatch(/===\s*["']yes["']/);
    expect(SCRIPT).toMatch(/===\s*["']on["']/);
  });

  it("fail-louds on missing BEACON_TENANT_ID + BEACON_TENANT_SLUG", () => {
    expect(SCRIPT).toMatch(
      /BEACON_TENANT_ID is required[\s\S]*process\.exit\(1\)/,
    );
    expect(SCRIPT).toMatch(
      /BEACON_TENANT_SLUG is required[\s\S]*process\.exit\(1\)/,
    );
  });

  it("invokes runWebsiteScan with trigger='cron' (the new ScanTrigger value)", () => {
    expect(SCRIPT).toMatch(/runWebsiteScan\(\s*\{\s*trigger:\s*["']cron["']\s*\}\s*\)/);
  });

  it("loads .env.local for local dev / GH Actions parity", () => {
    expect(SCRIPT).toMatch(/loadEnvLocal\s*\(\s*\)/);
  });

  it("exits non-zero when result.ok is false (so GH surfaces the failure)", () => {
    expect(SCRIPT).toMatch(/result\.ok[\s\S]*process\.exit\(1\)/);
  });
});

describe("Phase 5 — /api/cron/scan/route.ts structure", () => {
  it("auth check fires BEFORE kill-switch (security: don't leak operational state)", () => {
    // Anchor on RUNTIME code, not import or docstring strings:
    //   - auth runtime check: `expectedSecret = process.env.CRON_SECRET`
    //   - kill-switch invocation: `if (isScanDisabled())`
    const authIdx = ROUTE.indexOf("expectedSecret = process.env.CRON_SECRET");
    const killIdx = ROUTE.indexOf("if (isScanDisabled())");
    expect(authIdx).toBeGreaterThan(-1);
    expect(killIdx).toBeGreaterThan(-1);
    expect(authIdx).toBeLessThan(killIdx);
  });

  it("calls runWebsiteScan with trigger='cron'", () => {
    expect(ROUTE).toMatch(/runWebsiteScan\(\s*\{\s*trigger:\s*["']cron["']\s*\}\s*\)/);
  });

  it("kill-switch returns 200 OK (cron --fail-with-body doesn't trip)", () => {
    // Find the disabled-branch return; assert it's NextResponse.json (no
    // status 4xx/5xx — defaults to 200).
    const disabledBlock = ROUTE.match(
      /isScanDisabled\(\)\)[\s\S]{0,400}?return NextResponse\.json\([\s\S]{0,200}?\}\)/,
    );
    expect(disabledBlock).not.toBeNull();
    // Ensure no `status:` second-arg on this NextResponse.json call.
    expect(disabledBlock![0]).not.toMatch(/\{\s*status:\s*\d+/);
  });

  it("Bearer token must match CRON_SECRET exactly (no startsWith / regex weakness)", () => {
    expect(ROUTE).toMatch(/auth\s*!==\s*`Bearer \$\{expectedSecret\}`/);
  });

  it("declares Vercel hosted limitation in the route docstring (architectural awareness)", () => {
    expect(ROUTE).toMatch(/read-only/);
    expect(ROUTE).toMatch(/GitHub Actions/);
  });

  it("imports runWebsiteScan (the validated scan path)", () => {
    expect(ROUTE).toMatch(
      /from\s+["']@\/domains\/scanning\/orchestrate-scan["']/,
    );
  });
});

describe("Phase 5 — no provider-call leakage in cron path", () => {
  for (const file of [
    "src/app/api/cron/scan/route.ts",
    "scripts/run-scheduled-scan.ts",
    ".github/workflows/daily-scan.yml",
  ]) {
    it(`${file}: no LLM provider imports`, () => {
      const src = read(file);
      expect(src, `${file} imports openai`).not.toMatch(
        /from\s+["']openai["']/,
      );
      expect(src, `${file} imports anthropic-ai/sdk`).not.toMatch(
        /from\s+["']@anthropic-ai\//,
      );
      // Workflow file should not curl any provider endpoint.
      if (file.endsWith(".yml")) {
        expect(src).not.toMatch(/api\.openai\.com/);
        expect(src).not.toMatch(/api\.anthropic\.com/);
        expect(src).not.toMatch(/api\.perplexity\.ai/);
      }
    });
  }
});
