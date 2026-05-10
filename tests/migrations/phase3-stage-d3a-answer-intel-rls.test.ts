/**
 * Migration contract tests — Phase 3 Stage D3.A RLS companion.
 *
 * Migration file:
 *   migrations/2026-05-18_phase3_stage_d3a_answer_intel_rls.sql
 *
 * Static-analysis tests. Pins:
 *   1. File shape (single transaction, ROLLBACK marker, all-commented rollback).
 *   2. Only `answer_intelligence_index` is referenced; D3.B/D3.C and other
 *      out-of-scope tables explicitly excluded.
 *   3. Exactly one CREATE POLICY tenant_authenticated_rw with the helper in
 *      both USING and WITH CHECK, targeting authenticated, FOR ALL.
 *   4. Exactly one DROP POLICY deny_authenticated.
 *   5. deny_anon never CREATE/ALTER/DROP'd; members_self_read untouched.
 *   6. No schema/data mutations (ALTER TABLE / ADD/DROP COLUMN / INSERT /
 *      UPDATE / DELETE / TRUNCATE / CREATE/DROP INDEX / CREATE/REPLACE/DROP
 *      FUNCTION / GRANT / REVOKE).
 *   7. No RLS state changes (no ENABLE/DISABLE/FORCE ROW LEVEL SECURITY).
 *   8. Rollback section is fully commented.
 *   9. Header explicitly documents dependency on the D3.A schema migration.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-18_phase3_stage_d3a_answer_intel_rls.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

const ACTIVE_SQL = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[0];
const ACTIVE_SQL_NO_COMMENTS = ACTIVE_SQL
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

// Tables that must NOT appear in the active SQL.
const FORBIDDEN_TABLES = [
  "business_config",
  "citation_evidence_index",
  "tenant_members",
  "tenants",
  "answer_texts",
  "change_patterns",
  "confidence_calibration",
  "triage_rules",
  "scan_findings",
  "page_snapshots",
  "prompt_answer_observations",
  "competitors",
  "tracked_prompts",
  "change_contracts",
] as const;

// ─── 1. File shape ───────────────────────────────────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 1: file shape", () => {
  it("file exists at expected path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("single BEGIN/COMMIT in active SQL", () => {
    expect((ACTIVE_SQL.match(/^BEGIN;/gm) ?? []).length).toBe(1);
    expect((ACTIVE_SQL.match(/^COMMIT;/gm) ?? []).length).toBe(1);
  });

  it("contains -- ROLLBACK marker", () => {
    expect(MIGRATION_SQL).toMatch(/-- ROLLBACK/);
  });
});

// ─── 2. Only answer_intelligence_index referenced ────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 2: only answer_intelligence_index", () => {
  it("references public.answer_intelligence_index", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /public\.answer_intelligence_index\b/,
    );
  });

  it("does NOT reference any forbidden sibling table", () => {
    for (const tbl of FORBIDDEN_TABLES) {
      expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
        new RegExp(`public\\.${tbl}\\b`),
      );
    }
  });

  it("only public.<table> references are answer_intelligence_index (helper excluded)", () => {
    const referenced = new Set<string>();
    const re = /public\.([a-z_][a-z0-9_]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ACTIVE_SQL_NO_COMMENTS)) !== null) {
      if (m[1] === "is_tenant_member") continue;
      referenced.add(m[1]);
    }
    expect([...referenced]).toEqual(["answer_intelligence_index"]);
  });
});

// ─── 3. tenant_authenticated_rw shape ────────────────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 3: tenant_authenticated_rw policy", () => {
  it("creates exactly one tenant_authenticated_rw policy", () => {
    const matches =
      ACTIVE_SQL.match(
        /CREATE POLICY\s+"tenant_authenticated_rw"\s+ON\s+public\.answer_intelligence_index\b/g,
      ) ?? [];
    expect(matches.length).toBe(1);
  });

  it("policy targets authenticated, FOR ALL, with helper in USING + WITH CHECK", () => {
    const re =
      /CREATE POLICY\s+"tenant_authenticated_rw"\s+ON\s+public\.answer_intelligence_index[\s\S]*?;/;
    const block = ACTIVE_SQL.match(re)?.[0] ?? "";
    expect(block).toMatch(/TO\s+authenticated\b/);
    expect(block).toMatch(/FOR\s+ALL\b/);
    expect(block).toMatch(
      /USING\s*\(\s*public\.is_tenant_member\(\s*tenant_id\s*\)\s*\)/,
    );
    expect(block).toMatch(
      /WITH CHECK\s*\(\s*public\.is_tenant_member\(\s*tenant_id\s*\)\s*\)/,
    );
  });
});

// ─── 4. deny_authenticated dropped ───────────────────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 4: deny_authenticated dropped", () => {
  it("drops deny_authenticated exactly once", () => {
    const matches =
      ACTIVE_SQL.match(
        /DROP POLICY\s+"deny_authenticated"\s+ON\s+public\.answer_intelligence_index\b/g,
      ) ?? [];
    expect(matches.length).toBe(1);
  });
});

// ─── 5. deny_anon untouched ──────────────────────────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 5: deny_anon + members_self_read untouched", () => {
  it("no DROP POLICY deny_anon", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /DROP POLICY[\s\S]{0,40}deny_anon/,
    );
  });

  it("no ALTER POLICY deny_anon", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /ALTER POLICY[\s\S]{0,40}deny_anon/,
    );
  });

  it("no CREATE POLICY deny_anon", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /CREATE POLICY[\s\S]{0,40}deny_anon/,
    );
  });

  it("members_self_read never referenced", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/members_self_read/);
  });
});

// ─── 6. No schema/data mutations ─────────────────────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 6: no schema/data mutations", () => {
  it("no ALTER TABLE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*ALTER\s+TABLE/im);
  });

  it("no ADD/DROP/RENAME COLUMN", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ADD\s+COLUMN/i);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+COLUMN/i);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/RENAME\s+COLUMN/i);
  });

  it("no INSERT/UPDATE/DELETE/TRUNCATE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*INSERT\s+INTO/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*UPDATE\s+/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DELETE\s+FROM/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*TRUNCATE/im);
  });

  it("no CREATE/DROP INDEX", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX/im,
    );
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DROP\s+INDEX/im);
  });

  it("no CREATE/REPLACE/DROP FUNCTION", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i,
    );
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+FUNCTION/i);
  });

  it("no GRANT or REVOKE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*GRANT\s+/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*REVOKE\s+/im);
  });

  it("no constraint changes", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ADD\s+CONSTRAINT/i);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+CONSTRAINT/i);
  });
});

// ─── 7. No RLS state changes ─────────────────────────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 7: no RLS state changes", () => {
  it("no ENABLE/DISABLE/FORCE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
  });
});

// ─── 8. Rollback fully commented ─────────────────────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 8: rollback fully commented", () => {
  it("rollback section contains no uncommented SQL", () => {
    const rollback = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[1] ?? "";
    const uncommented = rollback.split("\n").filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith("--");
    });
    expect(uncommented).toEqual([]);
  });
});

// ─── 9. Explicit dependency comment ──────────────────────────────────────

describe("Phase 3 Stage D3.A RLS — Invariant 9: schema-migration dependency documented", () => {
  it("header references the D3.A schema migration filename", () => {
    expect(MIGRATION_SQL).toMatch(
      /2026-05-17_phase3_stage_d3a_answer_intel_per_tenant_schema\.sql/,
    );
  });

  it("header documents the apply-after-schema rule", () => {
    expect(MIGRATION_SQL).toMatch(/ONLY AFTER/i);
    expect(MIGRATION_SQL).toMatch(/schema migration/i);
  });
});
