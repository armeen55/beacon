/**
 * Architecture invariants — Gap F.1 QA reset-test-tenant safety
 * (2026-05-07).
 *
 * Pins the source-level safety contracts of `scripts/reset-test-
 * tenant.ts`. Behavioral coverage of the pure helpers lives in
 * `tests/scripts/reset-test-tenant.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const SCRIPT = join(REPO_ROOT, "scripts/reset-test-tenant.ts");
const SCRIPT_SRC = readFileSync(SCRIPT, "utf8");

describe("reset-test-tenant — file + structure", () => {
  it("script exists at scripts/reset-test-tenant.ts", () => {
    expect(existsSync(SCRIPT)).toBe(true);
  });

  it("exports the safety helpers", () => {
    expect(SCRIPT_SRC).toMatch(/export function isProtectedSlug/);
    expect(SCRIPT_SRC).toMatch(/export function parseArg/);
    expect(SCRIPT_SRC).toMatch(/export const RITZ_FORBIDDEN_PATTERNS/);
    expect(SCRIPT_SRC).toMatch(/export const RESETTABLE_STATUSES/);
    expect(SCRIPT_SRC).toMatch(/export const MAX_OBSERVATIONS_FOR_RESET/);
    expect(SCRIPT_SRC).toMatch(/export const ALLOWED_DELETE_TABLES/);
  });

  it("only runs main() when invoked directly (test-import safety)", () => {
    expect(SCRIPT_SRC).toMatch(/require\.main\s*===\s*module/);
  });
});

describe("reset-test-tenant — never touches Ritz", () => {
  it("RITZ_FORBIDDEN_PATTERNS contains the case-insensitive ritz pattern", () => {
    expect(SCRIPT_SRC).toMatch(/\/ritz\/i/);
  });

  it("RITZ_FORBIDDEN_PATTERNS contains the tenant-ritz- prefix pattern", () => {
    expect(SCRIPT_SRC).toMatch(/\/\^tenant-ritz-\//);
  });

  it("isProtectedSlug runs before any DB call (slug check is first guard)", () => {
    // Source-order pin: the protected-slug CALL SITE in main() must
    // appear BEFORE any Supabase admin client construction or table
    // query CALL SITE. We grep for `if (isProtectedSlug(slug))` to
    // hit the call site (not the function definition).
    const protectedCallIdx = SCRIPT_SRC.indexOf("if (isProtectedSlug(slug))");
    const adminCallIdx = SCRIPT_SRC.indexOf("await loadAdminClient()");
    const fromTenantsIdx = SCRIPT_SRC.indexOf('.from("tenants")');
    expect(protectedCallIdx).toBeGreaterThan(-1);
    expect(adminCallIdx).toBeGreaterThan(-1);
    expect(fromTenantsIdx).toBeGreaterThan(-1);
    expect(protectedCallIdx).toBeLessThan(adminCallIdx);
    expect(protectedCallIdx).toBeLessThan(fromTenantsIdx);
  });
});

describe("reset-test-tenant — only deletes from the 3 allowed tables", () => {
  it("ALLOWED_DELETE_TABLES set is exactly tracked_prompts + tenant_members + tenants", () => {
    expect(SCRIPT_SRC).toMatch(/"tracked_prompts"/);
    expect(SCRIPT_SRC).toMatch(/"tenant_members"/);
    expect(SCRIPT_SRC).toMatch(/"tenants"/);
  });

  it("does NOT delete from observations / snapshots / changelog / recs / entities / topics", () => {
    // Pin negative: no .delete() call against any of these tables.
    expect(SCRIPT_SRC).not.toMatch(
      /\.from\("prompt_answer_observations"\)[\s\S]{0,200}\.delete\(/,
    );
    expect(SCRIPT_SRC).not.toMatch(
      /\.from\("daily_metric_snapshots"\)[\s\S]{0,200}\.delete\(/,
    );
    expect(SCRIPT_SRC).not.toMatch(
      /\.from\("changelog_entries"\)[\s\S]{0,200}\.delete\(/,
    );
    expect(SCRIPT_SRC).not.toMatch(
      /\.from\("recommended_edits"\)[\s\S]{0,200}\.delete\(/,
    );
    expect(SCRIPT_SRC).not.toMatch(
      /\.from\("tracked_entities"\)[\s\S]{0,200}\.delete\(/,
    );
  });

  it("does NOT touch auth.users (script docstring + no admin.auth references)", () => {
    expect(SCRIPT_SRC).not.toMatch(/auth\.admin\./);
    expect(SCRIPT_SRC).not.toMatch(/deleteUser/);
  });
});

describe("reset-test-tenant — defaults to dry-run", () => {
  it("requires --confirm for actual delete (dry-run by default)", () => {
    // The early `if (!confirm)` branch must short-circuit BEFORE any
    // .delete() call site. Strip comments first (the docstring
    // mentions ".delete().eq()" as documentation).
    const stripped = SCRIPT_SRC
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const confirmCheckIdx = stripped.indexOf("if (!confirm)");
    const firstDeleteIdx = stripped.indexOf(".delete()");
    expect(confirmCheckIdx).toBeGreaterThan(-1);
    expect(firstDeleteIdx).toBeGreaterThan(-1);
    expect(confirmCheckIdx).toBeLessThan(firstDeleteIdx);
  });

  it("prints 'DRY RUN' message in the dry-run path", () => {
    expect(SCRIPT_SRC).toMatch(/DRY RUN/);
  });
});

describe("reset-test-tenant — observation-count safety", () => {
  it("refuses to reset a tenant with > MAX_OBSERVATIONS_FOR_RESET observations", () => {
    expect(SCRIPT_SRC).toMatch(/too_many_observations/);
    expect(SCRIPT_SRC).toMatch(
      /obsCountVal\s*>\s*MAX_OBSERVATIONS_FOR_RESET/,
    );
  });
});

describe("reset-test-tenant — status guard", () => {
  it("refuses to reset paused or cancelled tenants", () => {
    expect(SCRIPT_SRC).toMatch(/RESETTABLE_STATUSES\.has\(tenant\.status\)/);
    expect(SCRIPT_SRC).toMatch(/tenant_status_off_limits/);
  });
});

describe("reset-test-tenant — no paid APIs / no external HTTP", () => {
  it("does NOT import paid-API adapter modules", () => {
    expect(SCRIPT_SRC).not.toMatch(/from\s+["']@\/adapters\/openai/);
    expect(SCRIPT_SRC).not.toMatch(/from\s+["']@\/adapters\/perplexity/);
    expect(SCRIPT_SRC).not.toMatch(/from\s+["']openai["']/);
    expect(SCRIPT_SRC).not.toMatch(/from\s+["']@anthropic/);
  });

  it("does NOT call fetch / runNativePoll / paid runners", () => {
    expect(SCRIPT_SRC).not.toMatch(/\bfetch\(/);
    expect(SCRIPT_SRC).not.toContain("runNativePoll");
    expect(SCRIPT_SRC).not.toContain("runWebsiteScan");
  });
});
