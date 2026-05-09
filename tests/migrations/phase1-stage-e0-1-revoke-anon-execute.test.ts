/**
 * Migration contract tests — RLS Phase 1 Stage E0.1: revoke anon EXECUTE
 * on public.is_tenant_member(text).
 *
 * Migration file:
 *   migrations/2026-05-12_phase1_stage_e0_1_revoke_anon_execute_is_tenant_member.sql
 *
 * Static-analysis tests. Verifies:
 *   1. File exists, single transaction, rollback marker.
 *   2. REVOKE EXECUTE ... FROM anon present.
 *   3. No REVOKE from authenticated / service_role / postgres in active SQL.
 *   4. No CREATE/DROP/ALTER POLICY anywhere.
 *   5. No table or data mutations (ALTER TABLE / INSERT / UPDATE / DELETE /
 *      TRUNCATE / CREATE INDEX / CREATE FUNCTION / DROP FUNCTION).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-12_phase1_stage_e0_1_revoke_anon_execute_is_tenant_member.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

const ACTIVE_SQL = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[0];
const ACTIVE_SQL_NO_COMMENTS = ACTIVE_SQL
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("Phase 1 Stage E0.1 — file shape", () => {
  it("file exists", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("single BEGIN/COMMIT in active SQL", () => {
    expect((ACTIVE_SQL.match(/^BEGIN;/gm) ?? []).length).toBe(1);
    expect((ACTIVE_SQL.match(/^COMMIT;/gm) ?? []).length).toBe(1);
  });

  it("contains -- ROLLBACK marker", () => {
    expect(MIGRATION_SQL).toMatch(/-- ROLLBACK/);
  });

  it("rollback section is fully commented", () => {
    const rollback = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[1] ?? "";
    const uncommented = rollback.split("\n").filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith("--");
    });
    expect(uncommented).toEqual([]);
  });
});

describe("Phase 1 Stage E0.1 — revokes anon EXECUTE", () => {
  it("REVOKE EXECUTE ... FROM anon present", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /REVOKE\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_tenant_member\(text\)\s+FROM\s+anon\b/,
    );
  });

  it("does NOT revoke from authenticated", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /REVOKE[\s\S]{0,120}FROM\s+authenticated\b/,
    );
  });

  it("does NOT revoke from service_role", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /REVOKE[\s\S]{0,120}FROM\s+service_role\b/,
    );
  });

  it("does NOT revoke from postgres (function owner)", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /REVOKE[\s\S]{0,120}FROM\s+postgres\b/,
    );
  });
});

describe("Phase 1 Stage E0.1 — no policy or RLS-state changes", () => {
  it("no CREATE POLICY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("no DROP POLICY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+POLICY/i);
  });

  it("no ALTER POLICY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ALTER\s+POLICY/i);
  });

  it("no ENABLE/DISABLE/FORCE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
  });
});

describe("Phase 1 Stage E0.1 — no table or data mutations", () => {
  it("no ALTER TABLE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ALTER\s+TABLE/i);
  });

  it("no INSERT/UPDATE/DELETE/TRUNCATE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*INSERT\s+INTO/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*UPDATE\s+/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DELETE\s+FROM/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*TRUNCATE/im);
  });

  it("no CREATE/DROP INDEX", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/CREATE\s+(?:UNIQUE\s+)?INDEX/i);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+INDEX/i);
  });

  it("no CREATE/REPLACE/DROP FUNCTION", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+FUNCTION/i);
  });

  it("no GRANT statements (E0.1 is revoke-only)", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*GRANT\s+/im);
  });
});
