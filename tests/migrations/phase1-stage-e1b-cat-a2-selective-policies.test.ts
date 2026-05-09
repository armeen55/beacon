/**
 * Migration contract tests — RLS Phase 1 Stage E1.B: selective tenant
 * policies on the 12 Cat-A2 tables (excluding tenant_members).
 *
 * Migration file:
 *   migrations/2026-05-13_phase1_stage_e1b_cat_a2_selective_policies.sql
 *
 * Static-analysis tests. Mirrors the E1.A test shape with the Cat-A2
 * table list:
 *
 *   1. File shape: single BEGIN/COMMIT, ROLLBACK marker, rollback all commented.
 *   2. Only the 12 Cat-A2 tables are referenced in active SQL.
 *      tenant_members is NOT touched (special-cased per plan).
 *      Cat-A1 tables are NOT touched (already covered by E1.A).
 *   3. Each Cat-A2 table gets exactly one CREATE POLICY
 *      "tenant_authenticated_rw" with USING + WITH CHECK calling
 *      public.is_tenant_member(tenant_id), targeting authenticated.
 *   4. Each Cat-A2 table gets exactly one DROP POLICY "deny_authenticated".
 *   5. deny_anon never CREATE/ALTER/DROP'd.
 *   6. No data mutations and no schema mutations.
 *   7. No RLS state changes (ENABLE/DISABLE/FORCE).
 *   8. Net policy count delta = 0 (12 CREATE + 12 DROP).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-13_phase1_stage_e1b_cat_a2_selective_policies.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

const ACTIVE_SQL = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[0];
const ACTIVE_SQL_NO_COMMENTS = ACTIVE_SQL
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const CAT_A2_TABLES = [
  "change_outcomes",
  "daily_metric_snapshots",
  "guardrail_alerts",
  "llm_rejections",
  "observation_runs",
  "page_element_inventory",
  "page_snapshots",
  "pages",
  "prompt_answer_observations",
  "raw_poll_chunks",
  "recommended_edits",
  "url_change_outcomes",
] as const;

const CAT_A1_TABLES = [
  "changelog_entries",
  "import_runs",
  "recommendation_responses",
  "results",
  "scan_findings",
] as const;

// ─── Invariant 1 — file shape ────────────────────────────────────────────

describe("Phase 1 Stage E1.B — Invariant 1: migration file shape", () => {
  it("file exists at expected path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("is a single transaction (BEGIN/COMMIT in active SQL)", () => {
    expect((ACTIVE_SQL.match(/^BEGIN;/gm) ?? []).length).toBe(1);
    expect((ACTIVE_SQL.match(/^COMMIT;/gm) ?? []).length).toBe(1);
  });

  it("contains -- ROLLBACK section marker", () => {
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

// ─── Invariant 2 — table allow-list ──────────────────────────────────────

describe("Phase 1 Stage E1.B — Invariant 2: only Cat-A2 tables referenced", () => {
  it("references each of the 12 Cat-A2 tables in active SQL", () => {
    for (const tbl of CAT_A2_TABLES) {
      expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
        new RegExp(`public\\.${tbl}\\b`),
      );
    }
  });

  it("does NOT reference tenant_members (special-cased per plan)", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/public\.tenant_members\b/);
  });

  it("does NOT reference any Cat-A1 table (already in E1.A)", () => {
    for (const tbl of CAT_A1_TABLES) {
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
      if (m[1] === "is_tenant_member") continue;
      referenced.add(m[1]);
    }
    expect([...referenced].sort()).toEqual([...CAT_A2_TABLES].sort());
  });
});

// ─── Invariant 3 — tenant_authenticated_rw policies ──────────────────────

describe("Phase 1 Stage E1.B — Invariant 3: tenant_authenticated_rw policies", () => {
  for (const tbl of CAT_A2_TABLES) {
    it(`creates exactly one tenant_authenticated_rw policy on ${tbl}`, () => {
      const re = new RegExp(
        `CREATE POLICY\\s+"tenant_authenticated_rw"\\s+ON\\s+public\\.${tbl}\\b`,
        "g",
      );
      const matches = ACTIVE_SQL.match(re) ?? [];
      expect(matches.length).toBe(1);
    });

    it(`${tbl} policy targets authenticated and uses is_tenant_member in USING + WITH CHECK`, () => {
      const re = new RegExp(
        `CREATE POLICY\\s+"tenant_authenticated_rw"\\s+ON\\s+public\\.${tbl}[\\s\\S]*?;`,
      );
      const block = ACTIVE_SQL.match(re)?.[0] ?? "";
      expect(block).toMatch(/TO\s+authenticated\b/);
      expect(block).toMatch(
        /USING\s*\(\s*public\.is_tenant_member\(\s*tenant_id\s*\)\s*\)/,
      );
      expect(block).toMatch(
        /WITH CHECK\s*\(\s*public\.is_tenant_member\(\s*tenant_id\s*\)\s*\)/,
      );
      expect(block).toMatch(/FOR\s+ALL\b/);
    });
  }
});

// ─── Invariant 4 — deny_authenticated drops ──────────────────────────────

describe("Phase 1 Stage E1.B — Invariant 4: deny_authenticated dropped per table", () => {
  for (const tbl of CAT_A2_TABLES) {
    it(`drops deny_authenticated on ${tbl} exactly once`, () => {
      const re = new RegExp(
        `DROP POLICY\\s+"deny_authenticated"\\s+ON\\s+public\\.${tbl}\\b`,
        "g",
      );
      const matches = ACTIVE_SQL.match(re) ?? [];
      expect(matches.length).toBe(1);
    });
  }
});

// ─── Invariant 5 — deny_anon untouched ───────────────────────────────────

describe("Phase 1 Stage E1.B — Invariant 5: deny_anon untouched in active SQL", () => {
  it("no DROP POLICY deny_anon in active SQL", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /DROP POLICY[\s\S]{0,40}deny_anon/,
    );
  });

  it("no ALTER POLICY deny_anon in active SQL", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /ALTER POLICY[\s\S]{0,40}deny_anon/,
    );
  });

  it("no CREATE POLICY deny_anon in active SQL", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
      /CREATE POLICY[\s\S]{0,40}deny_anon/,
    );
  });

  it("members_self_read also untouched (tenant_members special case)", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/members_self_read/);
  });
});

// ─── Invariant 6 — no schema or data mutations ───────────────────────────

describe("Phase 1 Stage E1.B — Invariant 6: no data or schema mutations", () => {
  it("no INSERT/UPDATE/DELETE/TRUNCATE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*INSERT\s+INTO/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*UPDATE\s+/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DELETE\s+FROM/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*TRUNCATE/im);
  });

  it("no ALTER TABLE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*ALTER\s+TABLE/im);
  });

  it("no ADD COLUMN / DROP COLUMN / RENAME COLUMN", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ADD\s+COLUMN/i);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+COLUMN/i);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/RENAME\s+COLUMN/i);
  });

  it("no CHECK constraint changes", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ADD\s+CONSTRAINT/i);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+CONSTRAINT/i);
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
});

// ─── Invariant 7 — no RLS state changes ──────────────────────────────────

describe("Phase 1 Stage E1.B — Invariant 7: no RLS state changes", () => {
  it("no ENABLE / DISABLE / FORCE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
  });
});

// ─── Invariant 8 — net policy count delta = 0 ────────────────────────────

describe("Phase 1 Stage E1.B — Invariant 8: policy count delta is zero", () => {
  it("active SQL contains exactly 12 CREATE POLICY statements", () => {
    const matches = ACTIVE_SQL.match(/^\s*CREATE POLICY\b/gim) ?? [];
    expect(matches.length).toBe(12);
  });

  it("active SQL contains exactly 12 DROP POLICY statements", () => {
    const matches = ACTIVE_SQL.match(/^\s*DROP POLICY\b/gim) ?? [];
    expect(matches.length).toBe(12);
  });
});
