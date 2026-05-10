/**
 * Migration contract tests — Phase 3 Stage D3.A: answer_intelligence_index
 * per-tenant schema migration.
 *
 * Migration file:
 *   migrations/2026-05-17_phase3_stage_d3a_answer_intel_per_tenant_schema.sql
 *
 * Static-analysis tests. Pins:
 *   1. File shape (single transaction, ROLLBACK marker, all-commented rollback).
 *   2. Only `answer_intelligence_index` is referenced — D3.B / D3.C / Cat-A /
 *      Cat-B tables explicitly excluded.
 *   3. ADD COLUMN tenant_id, plus the single-row backfill UPDATE.
 *   4. ALTER COLUMN tenant_id SET NOT NULL.
 *   5. CHECK (tenant_id <> '') under the canonical name.
 *   6. PK swap from (id) to (tenant_id, id).
 *   7. Index on (tenant_id).
 *   8. id='current' is preserved (no DROP DEFAULT, no rename).
 *   9. NO RLS policy changes (CREATE/DROP/ALTER POLICY absent).
 *  10. NO data deletes/truncates and no other singleton/global tables touched.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-17_phase3_stage_d3a_answer_intel_per_tenant_schema.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

const ACTIVE_SQL = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[0];
const ACTIVE_SQL_NO_COMMENTS = ACTIVE_SQL
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

// Tables that MUST NOT be touched by this migration. Includes other
// D3 singletons + a representative slice of Cat-A and Cat-B tables.
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
] as const;

// ─── 1. File shape ─────────────────────────────────────────────────────

describe("Phase 3 Stage D3.A — Invariant 1: file shape", () => {
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

  it("rollback section is fully commented", () => {
    const rollback = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[1] ?? "";
    const uncommented = rollback.split("\n").filter((l) => {
      const t = l.trim();
      return t.length > 0 && !t.startsWith("--");
    });
    expect(uncommented).toEqual([]);
  });
});

// ─── 2. Only answer_intelligence_index referenced ─────────────────────

describe("Phase 3 Stage D3.A — Invariant 2: only answer_intelligence_index", () => {
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

  it("does not reference any other public.<table> in active SQL", () => {
    const referenced = new Set<string>();
    const re = /public\.([a-z_][a-z0-9_]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ACTIVE_SQL_NO_COMMENTS)) !== null) {
      referenced.add(m[1]);
    }
    expect([...referenced]).toEqual(["answer_intelligence_index"]);
  });
});

// ─── 3. ADD COLUMN + backfill ─────────────────────────────────────────

describe("Phase 3 Stage D3.A — Invariant 3: tenant_id column + backfill", () => {
  it("ADD COLUMN tenant_id text", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /ALTER TABLE\s+public\.answer_intelligence_index[\s\S]*?ADD COLUMN\s+tenant_id\s+text\b/,
    );
  });

  it("backfills existing row to tenant-ritz-founder", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /UPDATE\s+public\.answer_intelligence_index\s+SET\s+tenant_id\s*=\s*'tenant-ritz-founder'\s+WHERE\s+tenant_id\s+IS\s+NULL/i,
    );
  });

  it("backfill is the only data mutation in active SQL", () => {
    const updates = ACTIVE_SQL_NO_COMMENTS.match(/^\s*UPDATE\s+/gim) ?? [];
    expect(updates.length).toBe(1);
  });
});

// ─── 4. NOT NULL ──────────────────────────────────────────────────────

describe("Phase 3 Stage D3.A — Invariant 4: tenant_id NOT NULL", () => {
  it("declares ALTER COLUMN tenant_id SET NOT NULL", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /ALTER COLUMN\s+tenant_id\s+SET\s+NOT NULL/i,
    );
  });
});

// ─── 5. nonempty CHECK ────────────────────────────────────────────────

describe("Phase 3 Stage D3.A — Invariant 5: tenant_id nonempty CHECK", () => {
  it("declares the canonical CHECK constraint", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /CONSTRAINT\s+answer_intelligence_index_tenant_id_nonempty_chk[\s\S]{0,80}CHECK\s*\(\s*tenant_id\s*<>\s*''\s*\)/,
    );
  });
});

// ─── 6. PK swap to (tenant_id, id) ────────────────────────────────────

describe("Phase 3 Stage D3.A — Invariant 6: primary key shape", () => {
  it("DROP CONSTRAINT for the old (id)-only PK", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /DROP CONSTRAINT\s+answer_intelligence_index_pkey/i,
    );
  });

  it("ADD CONSTRAINT new PK on (tenant_id, id)", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /ADD CONSTRAINT\s+answer_intelligence_index_pkey\s+PRIMARY KEY\s*\(\s*tenant_id\s*,\s*id\s*\)/i,
    );
  });
});

// ─── 7. tenant_id index ───────────────────────────────────────────────

describe("Phase 3 Stage D3.A — Invariant 7: tenant_id index", () => {
  it("CREATE INDEX on (tenant_id)", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /CREATE INDEX\s+answer_intelligence_index_tenant_id_idx[\s\S]{0,160}\(\s*tenant_id\s*\)/,
    );
  });
});

// ─── 8. id='current' preserved ────────────────────────────────────────

describe("Phase 3 Stage D3.A — Invariant 8: id='current' default preserved", () => {
  it("does NOT drop the id default", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ALTER COLUMN\s+id[\s\S]{0,40}DROP DEFAULT/i);
  });

  it("does NOT rename the id column", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/RENAME COLUMN\s+id/i);
  });

  it("does NOT drop the id column", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP COLUMN\s+id\b/i);
  });
});

// ─── 9. NO RLS policy changes ─────────────────────────────────────────

describe("Phase 3 Stage D3.A — Invariant 9: no RLS policy changes", () => {
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

// ─── 10. No deletes / truncates / function/grant changes ──────────────

describe("Phase 3 Stage D3.A — Invariant 10: no deletes, truncates, grants", () => {
  it("no DELETE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DELETE\s+FROM/im);
  });

  it("no TRUNCATE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*TRUNCATE/im);
  });

  it("no INSERT (backfill is UPDATE only)", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*INSERT\s+INTO/im);
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

  it("no DROP TABLE / DROP INDEX in active SQL", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DROP\s+TABLE/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DROP\s+INDEX/im);
  });
});
