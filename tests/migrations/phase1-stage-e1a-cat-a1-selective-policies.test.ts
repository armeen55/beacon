/**
 * Migration contract tests — RLS Phase 1 Stage E1.A: selective tenant
 * policies on the 5 Cat-A1 tables.
 *
 * Migration file:
 *   migrations/2026-05-12_phase1_stage_e1a_cat_a1_selective_policies.sql
 *
 * Static-analysis tests (no live DB connection required). Verifies the
 * 8 invariants the operator brief locked in:
 *
 *   1. Migration file exists, is a single BEGIN/COMMIT, has rollback marker.
 *   2. Only the 5 Cat-A1 tables are referenced in the active SQL.
 *   3. Each Cat-A1 table gets exactly ONE
 *      `CREATE POLICY "tenant_authenticated_rw"` to authenticated, with
 *      both USING and WITH CHECK calling `public.is_tenant_member(tenant_id)`.
 *   4. Each Cat-A1 table gets exactly ONE
 *      `DROP POLICY "deny_authenticated"`.
 *   5. `deny_anon` is NEVER referenced in active SQL (DROP/ALTER/CREATE).
 *   6. No data mutations (INSERT/UPDATE/DELETE/TRUNCATE) and no schema
 *      mutations (ALTER TABLE / ADD COLUMN / DROP COLUMN / CREATE INDEX
 *      / DROP INDEX / CREATE/REPLACE FUNCTION).
 *   7. No RLS state changes (no ENABLE/DISABLE/FORCE ROW LEVEL SECURITY).
 *   8. Net policy count change is 0 (5 CREATE POLICY + 5 DROP POLICY in
 *      active SQL).
 *
 * Plan: docs/RLS_PHASE_1_PLAN_2026_05_08.md
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-12_phase1_stage_e1a_cat_a1_selective_policies.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

// Split on the rollback section header line (full line consumed so its
// trailing text doesn't bleed into either part).
const ACTIVE_SQL = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[0];

// Strip SQL line comments before scanning for executable references —
// comments are documentation and must not count as table refs.
const ACTIVE_SQL_NO_COMMENTS = ACTIVE_SQL
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n");

const CAT_A1_TABLES = [
  "changelog_entries",
  "import_runs",
  "recommendation_responses",
  "results",
  "scan_findings",
] as const;

// ─── Invariant 1 — file shape ────────────────────────────────────────────

describe("Phase 1 Stage E1.A — Invariant 1: migration file shape", () => {
  it("file exists at expected path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("is a single transaction (BEGIN/COMMIT in active SQL)", () => {
    const beginCount = (ACTIVE_SQL.match(/^BEGIN;/gm) ?? []).length;
    const commitCount = (ACTIVE_SQL.match(/^COMMIT;/gm) ?? []).length;
    expect(beginCount).toBe(1);
    expect(commitCount).toBe(1);
  });

  it("contains a -- ROLLBACK section marker", () => {
    expect(MIGRATION_SQL).toMatch(/-- ROLLBACK/);
  });

  it("rollback section contains no uncommented executable SQL", () => {
    const rollback = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[1] ?? "";
    const uncommented = rollback.split("\n").filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    });
    expect(uncommented).toEqual([]);
  });
});

// ─── Invariant 2 — table allow-list ──────────────────────────────────────

describe("Phase 1 Stage E1.A — Invariant 2: only Cat-A1 tables referenced", () => {
  it("references each of the 5 Cat-A1 tables in active SQL", () => {
    for (const tbl of CAT_A1_TABLES) {
      expect(ACTIVE_SQL).toMatch(new RegExp(`public\\.${tbl}\\b`));
    }
  });

  it("does not reference any other public.<table> in active SQL", () => {
    const referenced = new Set<string>();
    const re = /public\.([a-z_][a-z0-9_]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ACTIVE_SQL_NO_COMMENTS)) !== null) {
      // Skip the helper function name.
      if (m[1] === "is_tenant_member") continue;
      referenced.add(m[1]);
    }
    expect([...referenced].sort()).toEqual([...CAT_A1_TABLES].sort());
  });
});

// ─── Invariant 3 — tenant_authenticated_rw policies ──────────────────────

describe("Phase 1 Stage E1.A — Invariant 3: tenant_authenticated_rw policies", () => {
  for (const tbl of CAT_A1_TABLES) {
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
      expect(block).toMatch(/USING\s*\(\s*public\.is_tenant_member\(\s*tenant_id\s*\)\s*\)/);
      expect(block).toMatch(/WITH CHECK\s*\(\s*public\.is_tenant_member\(\s*tenant_id\s*\)\s*\)/);
      expect(block).toMatch(/FOR\s+ALL\b/);
    });
  }
});

// ─── Invariant 4 — deny_authenticated drops ──────────────────────────────

describe("Phase 1 Stage E1.A — Invariant 4: deny_authenticated dropped per table", () => {
  for (const tbl of CAT_A1_TABLES) {
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

describe("Phase 1 Stage E1.A — Invariant 5: deny_anon untouched in active SQL", () => {
  it("no DROP POLICY deny_anon in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/DROP POLICY[\s\S]{0,40}deny_anon/);
  });

  it("no ALTER POLICY deny_anon in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/ALTER POLICY[\s\S]{0,40}deny_anon/);
  });

  it("no CREATE POLICY deny_anon in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/CREATE POLICY[\s\S]{0,40}deny_anon/);
  });
});

// ─── Invariant 6 — no schema or data mutations ───────────────────────────

describe("Phase 1 Stage E1.A — Invariant 6: no data or schema mutations", () => {
  it("no INSERT", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*INSERT\s+INTO/im);
  });

  it("no UPDATE", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*UPDATE\s+/im);
  });

  it("no DELETE", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*DELETE\s+FROM/im);
  });

  it("no TRUNCATE", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*TRUNCATE/im);
  });

  it("no ALTER TABLE", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*ALTER\s+TABLE/im);
  });

  it("no ADD COLUMN / DROP COLUMN / RENAME COLUMN", () => {
    expect(ACTIVE_SQL).not.toMatch(/ADD\s+COLUMN/i);
    expect(ACTIVE_SQL).not.toMatch(/DROP\s+COLUMN/i);
    expect(ACTIVE_SQL).not.toMatch(/RENAME\s+COLUMN/i);
  });

  it("no CREATE/DROP INDEX", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX/im);
    expect(ACTIVE_SQL).not.toMatch(/^\s*DROP\s+INDEX/im);
  });

  it("no CREATE/REPLACE/DROP FUNCTION", () => {
    expect(ACTIVE_SQL).not.toMatch(/CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION/i);
    expect(ACTIVE_SQL).not.toMatch(/DROP\s+FUNCTION/i);
  });

  it("no CHECK constraint changes", () => {
    expect(ACTIVE_SQL).not.toMatch(/ADD\s+CONSTRAINT/i);
    expect(ACTIVE_SQL).not.toMatch(/DROP\s+CONSTRAINT/i);
  });
});

// ─── Invariant 7 — no RLS state changes ──────────────────────────────────

describe("Phase 1 Stage E1.A — Invariant 7: no RLS state changes", () => {
  it("no ENABLE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL).not.toMatch(/ENABLE ROW LEVEL SECURITY/i);
  });

  it("no DISABLE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL).not.toMatch(/DISABLE ROW LEVEL SECURITY/i);
  });

  it("no FORCE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL).not.toMatch(/FORCE ROW LEVEL SECURITY/i);
  });
});

// ─── Invariant 8 — net policy count delta = 0 ────────────────────────────

describe("Phase 1 Stage E1.A — Invariant 8: policy count delta is zero", () => {
  it("active SQL contains exactly 5 CREATE POLICY statements", () => {
    const matches = ACTIVE_SQL.match(/^\s*CREATE POLICY\b/gim) ?? [];
    expect(matches.length).toBe(5);
  });

  it("active SQL contains exactly 5 DROP POLICY statements", () => {
    const matches = ACTIVE_SQL.match(/^\s*DROP POLICY\b/gim) ?? [];
    expect(matches.length).toBe(5);
  });
});
