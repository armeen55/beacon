/**
 * Migration contract tests — Phase 2 Stage A: llm_budget_ledger table.
 *
 * Migration file:
 *   migrations/2026-05-16_phase2_stage_a_llm_budget_ledger.sql
 *
 * Static-analysis tests. Pins the additive shape:
 *   1. File shape (single transaction, ROLLBACK marker, all-commented rollback).
 *   2. Creates exactly the llm_budget_ledger table; no other tables touched.
 *   3. Primary key (tenant_id, date_utc, platform).
 *   4. Nonempty tenant_id CHECK.
 *   5. Nonnegative checks on all counter columns + daily_cap_usd.
 *   6. Platform enum CHECK lists the 4 expected values.
 *   7. Indexes on (tenant_id, date_utc DESC) and (date_utc DESC).
 *   8. RLS enabled + forced; deny_anon + tenant_authenticated_rw policies
 *      using public.is_tenant_member(tenant_id) in USING + WITH CHECK.
 *   9. No data mutation, no other table touched, no other policy/function/grant.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-16_phase2_stage_a_llm_budget_ledger.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

const ACTIVE_SQL = MIGRATION_SQL.split(/\n-- ROLLBACK[^\n]*\n/)[0];
const ACTIVE_SQL_NO_COMMENTS = ACTIVE_SQL
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

// ─── 1. File shape ─────────────────────────────────────────────────────

describe("Phase 2 Stage A — Invariant 1: file shape", () => {
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

// ─── 2. Creates exactly the llm_budget_ledger table ───────────────────

describe("Phase 2 Stage A — Invariant 2: creates llm_budget_ledger only", () => {
  it("creates table public.llm_budget_ledger", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /CREATE TABLE\s+public\.llm_budget_ledger\b/,
    );
  });

  it("does not CREATE TABLE for any other table", () => {
    const matches = ACTIVE_SQL_NO_COMMENTS.match(/CREATE\s+TABLE\s+\S+/gi) ?? [];
    expect(matches.length).toBe(1);
    expect(matches[0]).toMatch(/llm_budget_ledger/);
  });

  it("does not reference any pre-existing table by name", () => {
    // Allow public.is_tenant_member(text) — that's the helper, not a table.
    const referenced = new Set<string>();
    const re = /public\.([a-z_][a-z0-9_]*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(ACTIVE_SQL_NO_COMMENTS)) !== null) {
      if (m[1] === "is_tenant_member") continue;
      referenced.add(m[1]);
    }
    expect([...referenced]).toEqual(["llm_budget_ledger"]);
  });
});

// ─── 3. Primary key (tenant_id, date_utc, platform) ───────────────────

describe("Phase 2 Stage A — Invariant 3: primary key shape", () => {
  it("declares PRIMARY KEY (tenant_id, date_utc, platform)", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /PRIMARY KEY\s*\(\s*tenant_id\s*,\s*date_utc\s*,\s*platform\s*\)/,
    );
  });
});

// ─── 4. Nonempty tenant_id CHECK ──────────────────────────────────────

describe("Phase 2 Stage A — Invariant 4: tenant_id nonempty CHECK", () => {
  it("declares tenant_id <> '' CHECK", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /CONSTRAINT\s+llm_budget_ledger_tenant_id_nonempty_chk[\s\S]{0,80}CHECK\s*\(\s*tenant_id\s*<>\s*''\s*\)/,
    );
  });

  it("declares tenant_id NOT NULL", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(/tenant_id\s+text\s+NOT NULL/);
  });
});

// ─── 5. Nonnegative checks ────────────────────────────────────────────

describe("Phase 2 Stage A — Invariant 5: nonnegative counter CHECKs", () => {
  for (const col of ["spent_usd", "call_count", "prompt_count", "chunk_count"]) {
    it(`declares CHECK ${col} >= 0`, () => {
      const re = new RegExp(
        `CHECK\\s*\\(\\s*${col}\\s*>=\\s*0\\s*\\)`,
      );
      expect(ACTIVE_SQL_NO_COMMENTS).toMatch(re);
    });
  }

  it("daily_cap_usd CHECK allows null OR >= 0", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /CHECK\s*\(\s*daily_cap_usd\s+IS NULL\s+OR\s+daily_cap_usd\s*>=\s*0\s*\)/i,
    );
  });
});

// ─── 6. Platform enum CHECK ───────────────────────────────────────────

describe("Phase 2 Stage A — Invariant 6: platform enum CHECK", () => {
  it("declares the 4 expected platform values", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /CHECK\s*\(\s*platform\s+IN\s*\([\s\S]{0,200}'perplexity'[\s\S]{0,80}'openai'[\s\S]{0,80}'adjudicator-openai'[\s\S]{0,80}'other'/,
    );
  });
});

// ─── 7. Indexes ───────────────────────────────────────────────────────

describe("Phase 2 Stage A — Invariant 7: indexes", () => {
  it("creates llm_budget_ledger_tenant_date_idx", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /CREATE\s+INDEX\s+llm_budget_ledger_tenant_date_idx[\s\S]{0,160}\(\s*tenant_id\s*,\s*date_utc\s+DESC\s*\)/,
    );
  });

  it("creates llm_budget_ledger_date_idx", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /CREATE\s+INDEX\s+llm_budget_ledger_date_idx[\s\S]{0,160}\(\s*date_utc\s+DESC\s*\)/,
    );
  });
});

// ─── 8. RLS posture ───────────────────────────────────────────────────

describe("Phase 2 Stage A — Invariant 8: RLS posture", () => {
  it("ENABLE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /ALTER TABLE\s+public\.llm_budget_ledger\s+ENABLE\s+ROW LEVEL SECURITY/,
    );
  });

  it("FORCE ROW LEVEL SECURITY", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).toMatch(
      /ALTER TABLE\s+public\.llm_budget_ledger\s+FORCE\s+ROW LEVEL SECURITY/,
    );
  });

  it("creates deny_anon policy targeting anon role", () => {
    const re = /CREATE POLICY\s+"deny_anon"\s+ON\s+public\.llm_budget_ledger[\s\S]*?;/;
    const block = ACTIVE_SQL_NO_COMMENTS.match(re)?.[0] ?? "";
    expect(block).toMatch(/TO\s+anon\b/);
    expect(block).toMatch(/USING\s*\(\s*false\s*\)/);
    expect(block).toMatch(/WITH CHECK\s*\(\s*false\s*\)/);
  });

  it("creates tenant_authenticated_rw policy using is_tenant_member", () => {
    const re = /CREATE POLICY\s+"tenant_authenticated_rw"\s+ON\s+public\.llm_budget_ledger[\s\S]*?;/;
    const block = ACTIVE_SQL_NO_COMMENTS.match(re)?.[0] ?? "";
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

// ─── 9. No data mutations / no other table changes ────────────────────

describe("Phase 2 Stage A — Invariant 9: no data or sibling-schema mutations", () => {
  it("no INSERT/UPDATE/DELETE/TRUNCATE", () => {
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*INSERT\s+INTO/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*UPDATE\s+/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*DELETE\s+FROM/im);
    expect(ACTIVE_SQL_NO_COMMENTS).not.toMatch(/^\s*TRUNCATE/im);
  });

  it("no ALTER TABLE on any pre-existing table", () => {
    // Only the new table may receive ALTER (for ENABLE/FORCE RLS).
    const alters = ACTIVE_SQL_NO_COMMENTS.match(/ALTER\s+TABLE\s+\S+/gi) ?? [];
    for (const a of alters) {
      expect(a).toMatch(/llm_budget_ledger/);
    }
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
