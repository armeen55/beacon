/**
 * Migration contract tests — RLS Phase 1 Stage E0: tenant-membership
 * helper function.
 *
 * Migration file:
 *   migrations/2026-05-11_phase1_stage_e0_tenant_member_helper.sql
 *
 * Static-analysis tests (no live DB connection required). Verifies the
 * 8 invariants the operator brief locked in:
 *
 *   1. Migration file exists.
 *   2. Migration creates `public.is_tenant_member(text) RETURNS boolean`.
 *   3. Function body uses `auth.uid()` and `public.tenant_members`.
 *   4. Function declared SECURITY DEFINER + STABLE + pinned search_path.
 *   5. Migration revokes from PUBLIC + grants EXECUTE only to authenticated.
 *   6. NO CREATE / DROP / ALTER POLICY anywhere in the migration.
 *   7. NO ENABLE / DISABLE / FORCE ROW LEVEL SECURITY.
 *   8. NO data mutations (no INSERT / UPDATE / DELETE / TRUNCATE), no
 *      index creation/drop, no DROP COLUMN/RENAME COLUMN.
 *
 * Plan: docs/RLS_PHASE_1_PLAN_2026_05_08.md
 * Truth: docs/CURRENT_BEACON_TRUTH_2026_05_08.md
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-11_phase1_stage_e0_tenant_member_helper.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

// Active section = everything before the rollback marker.
const ACTIVE_SQL = MIGRATION_SQL.split("-- ROLLBACK")[0];

// ─── Invariant 1 — migration file exists ─────────────────────────────────

describe("Phase 1 Stage E0 — Invariant 1: migration file exists", () => {
  it("file is at the expected path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("file is non-empty SQL with single transaction", () => {
    expect(MIGRATION_SQL.length).toBeGreaterThan(500);
    expect(MIGRATION_SQL).toMatch(/^BEGIN;/m);
    expect(MIGRATION_SQL).toMatch(/^COMMIT;/m);
  });
});

// ─── Invariant 2 — helper function created ───────────────────────────────

describe("Phase 1 Stage E0 — Invariant 2: is_tenant_member function created", () => {
  it("creates public.is_tenant_member(text) returning boolean", () => {
    expect(ACTIVE_SQL).toMatch(
      /CREATE OR REPLACE FUNCTION public\.is_tenant_member\(target_tenant_id text\)\s+RETURNS boolean/,
    );
  });

  it("uses LANGUAGE sql (set-based, optimizer-friendly)", () => {
    expect(ACTIVE_SQL).toMatch(/LANGUAGE sql\b/);
  });

  it("declares STABLE for query-planner inlining", () => {
    expect(ACTIVE_SQL).toMatch(/\bSTABLE\b/);
  });

  it("attaches a COMMENT explaining the helper's contract", () => {
    expect(ACTIVE_SQL).toMatch(
      /COMMENT ON FUNCTION public\.is_tenant_member\(text\)/,
    );
  });
});

// ─── Invariant 3 — body uses auth.uid() + tenant_members ─────────────────

describe("Phase 1 Stage E0 — Invariant 3: body grounds membership in auth.uid() + tenant_members", () => {
  it("function body references auth.uid()", () => {
    expect(ACTIVE_SQL).toMatch(/auth\.uid\(\)/);
  });

  it("function body references public.tenant_members", () => {
    expect(ACTIVE_SQL).toMatch(/FROM public\.tenant_members/);
  });

  it("function body filters by user_id = auth.uid() AND tenant_id = target_tenant_id", () => {
    expect(ACTIVE_SQL).toMatch(/user_id\s*=\s*auth\.uid\(\)/);
    expect(ACTIVE_SQL).toMatch(/tenant_id\s*=\s*target_tenant_id/);
  });

  it("uses EXISTS (non-empty existence check, returns boolean)", () => {
    expect(ACTIVE_SQL).toMatch(/SELECT EXISTS\s*\(/);
  });
});

// ─── Invariant 4 — security posture ──────────────────────────────────────

describe("Phase 1 Stage E0 — Invariant 4: SECURITY DEFINER + pinned search_path", () => {
  it("SECURITY DEFINER (runs with function-owner privileges)", () => {
    expect(ACTIVE_SQL).toMatch(/SECURITY DEFINER/);
  });

  it("SET search_path is pinned to public, pg_catalog (defeats search-path injection)", () => {
    expect(ACTIVE_SQL).toMatch(
      /SET\s+search_path\s*=\s*public,\s*pg_catalog/,
    );
  });
});

// ─── Invariant 5 — grants ────────────────────────────────────────────────

describe("Phase 1 Stage E0 — Invariant 5: grants restrict execution to authenticated", () => {
  it("REVOKE ALL ... FROM PUBLIC removes default permissions", () => {
    expect(ACTIVE_SQL).toMatch(
      /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.is_tenant_member\(text\)\s+FROM\s+PUBLIC/,
    );
  });

  it("GRANT EXECUTE TO authenticated allows logged-in users", () => {
    expect(ACTIVE_SQL).toMatch(
      /GRANT\s+EXECUTE\s+ON\s+FUNCTION\s+public\.is_tenant_member\(text\)\s+TO\s+authenticated/,
    );
  });

  it("anon role does NOT receive an EXECUTE grant", () => {
    // Negative invariant: scan the active SQL for any GRANT … TO anon
    // on this function.
    expect(ACTIVE_SQL).not.toMatch(
      /GRANT[\s\S]{0,200}is_tenant_member[\s\S]{0,80}TO\s+anon/,
    );
  });
});

// ─── Invariant 6 — no policy changes ─────────────────────────────────────

describe("Phase 1 Stage E0 — Invariant 6: no RLS policy statements", () => {
  it("no CREATE POLICY anywhere in the migration", () => {
    expect(MIGRATION_SQL).not.toMatch(/^CREATE POLICY/m);
  });

  it("no DROP POLICY anywhere in the migration", () => {
    expect(MIGRATION_SQL).not.toMatch(/^DROP POLICY/m);
  });

  it("no ALTER POLICY anywhere in the migration", () => {
    expect(MIGRATION_SQL).not.toMatch(/^ALTER POLICY/m);
  });
});

// ─── Invariant 7 — no RLS toggle ─────────────────────────────────────────

describe("Phase 1 Stage E0 — Invariant 7: no RLS state changes", () => {
  it("no ENABLE ROW LEVEL SECURITY", () => {
    expect(MIGRATION_SQL).not.toMatch(/ENABLE ROW LEVEL SECURITY/);
  });

  it("no DISABLE ROW LEVEL SECURITY", () => {
    expect(MIGRATION_SQL).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
  });

  it("no FORCE ROW LEVEL SECURITY", () => {
    expect(MIGRATION_SQL).not.toMatch(/FORCE ROW LEVEL SECURITY/);
  });
});

// ─── Invariant 8 — no schema/data mutations beyond the helper ────────────

describe("Phase 1 Stage E0 — Invariant 8: no schema or data mutations beyond the helper", () => {
  it("no INSERT in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*INSERT\s+INTO/im);
  });

  it("no UPDATE in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*UPDATE\s+"?public/im);
  });

  it("no DELETE in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*DELETE\s+FROM/im);
  });

  it("no TRUNCATE in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*TRUNCATE/im);
  });

  it("no CREATE INDEX (existing PK on tenant_members covers the EXISTS lookup)", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*CREATE\s+(?:UNIQUE\s+)?INDEX/im);
  });

  it("no DROP COLUMN / RENAME COLUMN", () => {
    expect(ACTIVE_SQL).not.toMatch(/DROP COLUMN/i);
    expect(ACTIVE_SQL).not.toMatch(/RENAME COLUMN/i);
  });

  it("no DROP TABLE / DROP INDEX", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*DROP\s+TABLE/im);
    expect(ACTIVE_SQL).not.toMatch(/^\s*DROP\s+INDEX/im);
  });

  it("does NOT modify tenant_members table itself (no ALTER TABLE)", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*ALTER\s+TABLE/im);
  });
});

// ─── Rollback shape ──────────────────────────────────────────────────────

describe("Phase 1 Stage E0 — rollback block exists and is commented-out", () => {
  it("file contains a -- ROLLBACK marker section", () => {
    expect(MIGRATION_SQL).toMatch(/-- ROLLBACK/);
  });

  it("rollback drops the helper function", () => {
    const rollback = MIGRATION_SQL.split("-- ROLLBACK")[1] ?? "";
    expect(rollback).toMatch(/DROP FUNCTION IF EXISTS public\.is_tenant_member/);
  });

  it("rollback section contains no uncommented executable SQL", () => {
    const rollback = MIGRATION_SQL.split("-- ROLLBACK")[1] ?? "";
    const uncommented = rollback.split("\n").filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    });
    for (const line of uncommented) {
      expect(
        /^\s*(BEGIN|COMMIT|REVOKE|GRANT|DROP|CREATE|ALTER|UPDATE|DELETE|INSERT|TRUNCATE|COMMENT)/i.test(
          line,
        ),
        `non-comment SQL inside rollback section: "${line}"`,
      ).toBe(false);
    }
  });
});
