/**
 * Migration contract tests — RLS Phase 1 Stage E1.D: selective tenant
 * policies on the 3 dual-key tables.
 *
 * Migration file:
 *   migrations/2026-05-15_phase1_stage_e1d_dual_key_selective_policies.sql
 *
 * Static-analysis tests. Mirrors E1.B/E1.C with the dual-key list and
 * an extra guard that account_id is left untouched.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-15_phase1_stage_e1d_dual_key_selective_policies.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

const ACTIVE_SQL = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[0];
const ACTIVE_SQL_NO_COMMENTS = ACTIVE_SQL
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

const DUAL_KEY_TABLES = [
  "change_contracts",
  "tracked_entities",
  "tracked_prompts",
] as const;

const CAT_A1_TABLES = [
  "changelog_entries",
  "import_runs",
  "recommendation_responses",
  "results",
  "scan_findings",
] as const;

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

const CAT_B_TABLES = [
  "attribution_decisions",
  "candidate_links",
  "competitor_config",
  "competitors",
  "opportunities",
  "page_issues",
  "page_visibility",
] as const;

const OUT_OF_SCOPE_TABLES = [
  "answer_intelligence_index",
  "answer_texts",
  "business_config",
  "change_patterns",
  "citation_evidence_index",
  "confidence_calibration",
  "tenant_members",
  "tenants",
  "triage_rules",
] as const;

// ─── Invariant 1 — file shape ────────────────────────────────────────────

describe("Phase 1 Stage E1.D — Invariant 1: migration file shape", () => {
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

describe("Phase 1 Stage E1.D — Invariant 2: only dual-key tables referenced", () => {
  it("references each of the 3 dual-key tables in active SQL", () => {
    for (const tbl of DUAL_KEY_TABLES) {
      expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
        new RegExp(`public\\.${tbl}\\b`),
      );
    }
  });

  it("does NOT reference any Cat-A1 table (already in E1.A)", () => {
    for (const tbl of CAT_A1_TABLES) {
      expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
        new RegExp(`public\\.${tbl}\\b`),
      );
    }
  });

  it("does NOT reference any Cat-A2 table (already in E1.B)", () => {
    for (const tbl of CAT_A2_TABLES) {
      expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
        new RegExp(`public\\.${tbl}\\b`),
      );
    }
  });

  it("does NOT reference any Cat-B table (drafted in E1.C)", () => {
    for (const tbl of CAT_B_TABLES) {
      expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(
        new RegExp(`public\\.${tbl}\\b`),
      );
    }
  });

  it("does NOT reference any global / singleton / shared / FK-chained / meta table", () => {
    for (const tbl of OUT_OF_SCOPE_TABLES) {
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
    expect([...referenced].sort()).toEqual([...DUAL_KEY_TABLES].sort());
  });
});

// ─── Invariant 3 — tenant_authenticated_rw policies ──────────────────────

describe("Phase 1 Stage E1.D — Invariant 3: tenant_authenticated_rw policies", () => {
  for (const tbl of DUAL_KEY_TABLES) {
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

describe("Phase 1 Stage E1.D — Invariant 4: deny_authenticated dropped per table", () => {
  for (const tbl of DUAL_KEY_TABLES) {
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

describe("Phase 1 Stage E1.D — Invariant 5: deny_anon untouched", () => {
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

  it("members_self_read also untouched", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/members_self_read/);
  });
});

// ─── Invariant 6 — account_id untouched ──────────────────────────────────

describe("Phase 1 Stage E1.D — Invariant 6: account_id column not modified", () => {
  it("no DROP COLUMN account_id", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/DROP\s+COLUMN[\s\S]{0,40}account_id/i);
  });

  it("no RENAME COLUMN account_id", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/RENAME\s+COLUMN[\s\S]{0,40}account_id/i);
  });

  it("policy clauses do not reference account_id", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/account_id/);
  });
});

// ─── Invariant 7 — no schema or data mutations ───────────────────────────

describe("Phase 1 Stage E1.D — Invariant 7: no data or schema mutations", () => {
  it("no INSERT/UPDATE/DELETE/TRUNCATE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*INSERT\s+INTO/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*UPDATE\s+/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DELETE\s+FROM/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*TRUNCATE/im);
  });

  it("no ALTER TABLE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*ALTER\s+TABLE/im);
  });

  it("no ADD/DROP/RENAME COLUMN (any column)", () => {
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

// ─── Invariant 8 — no RLS state changes ──────────────────────────────────

describe("Phase 1 Stage E1.D — Invariant 8: no RLS state changes", () => {
  it("no ENABLE / DISABLE / FORCE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/ROW\s+LEVEL\s+SECURITY/i);
  });
});

// ─── Invariant 9 — net policy count delta = 0 ────────────────────────────

describe("Phase 1 Stage E1.D — Invariant 9: policy count delta is zero", () => {
  it("active SQL contains exactly 3 CREATE POLICY statements", () => {
    const matches = ACTIVE_SQL.match(/^\s*CREATE POLICY\b/gim) ?? [];
    expect(matches.length).toBe(3);
  });

  it("active SQL contains exactly 3 DROP POLICY statements", () => {
    const matches = ACTIVE_SQL.match(/^\s*DROP POLICY\b/gim) ?? [];
    expect(matches.length).toBe(3);
  });
});
