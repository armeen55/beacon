/**
 * Migration contract tests — Section 6 Commit C1:
 *   migrations/2026-05-15_section6_primary_recommendation_column.sql
 *
 * Static-analysis tests. Pins the additive-nullable shape:
 *   1. File exists at the canonical path.
 *   2. Contains exactly one ALTER TABLE ADD COLUMN IF NOT EXISTS for
 *      `primary_recommendation_count integer NULL` on
 *      `public.daily_metric_snapshots`.
 *   3. Contains a COMMENT ON COLUMN documenting Section 6, the
 *      per-scope population contract, and the topic-null v1 contract.
 *   4. Does NOT contain CREATE TABLE (additive-only migration).
 *   5. Does NOT contain ALTER POLICY / DROP POLICY / CREATE POLICY
 *      (no RLS policy changes).
 *   6. Does NOT add a NOT NULL constraint to the new column.
 *   7. Does NOT contain INSERT / UPDATE / DELETE (no data mutation).
 *   8. References the new column only on the daily_metric_snapshots
 *      table (no accidental cross-table edits).
 *
 * No runtime dependency in this commit; the column is consumed by
 * the Section 6 C2 builder extension (lands later). These pins keep
 * the migration's shape stable through review + apply.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-15_section6_primary_recommendation_column.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

// Strip line comments (everything from `--` to end of line) so the
// "does NOT contain X" assertions can't be tripped by prose in the
// header that legitimately references SQL keywords for documentation
// (e.g., the rollback section quoting `DROP COLUMN IF EXISTS`).
const ACTIVE_SQL = MIGRATION_SQL.split("\n")
  .map((line) => {
    const idx = line.indexOf("--");
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join("\n");

// ─── 1. File shape ─────────────────────────────────────────────────

describe("Section 6 C1 — Invariant 1: file shape", () => {
  it("migration file exists at the canonical path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("file is non-empty", () => {
    expect(MIGRATION_SQL.length).toBeGreaterThan(0);
  });
});

// ─── 2. Additive column shape ──────────────────────────────────────

describe("Section 6 C1 — Invariant 2: additive nullable column", () => {
  it("contains ALTER TABLE on public.daily_metric_snapshots", () => {
    expect(ACTIVE_SQL).toMatch(
      /ALTER\s+TABLE\s+"public"\."daily_metric_snapshots"/i,
    );
  });

  it("adds primary_recommendation_count as integer NULL with IF NOT EXISTS", () => {
    expect(ACTIVE_SQL).toMatch(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"primary_recommendation_count"\s+integer\s+NULL/i,
    );
  });

  it("the new column is referenced exactly once as an ADD COLUMN target", () => {
    const matches = ACTIVE_SQL.match(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"primary_recommendation_count"/gi,
    );
    expect(matches?.length ?? 0).toBe(1);
  });
});

// ─── 3. COMMENT ON COLUMN ──────────────────────────────────────────

describe("Section 6 C1 — Invariant 3: COMMENT ON COLUMN", () => {
  it("contains COMMENT ON COLUMN for the new column", () => {
    expect(ACTIVE_SQL).toMatch(
      /COMMENT\s+ON\s+COLUMN\s+"public"\."daily_metric_snapshots"\."primary_recommendation_count"\s+IS/i,
    );
  });

  // Comment body lives in the SQL source as a single-quoted string;
  // grep the FULL source (including comments) so the prose checks
  // also pick up any explanatory line comments around the COMMENT
  // call. The key contractual phrases must be present somewhere in
  // the migration text.
  it("comment body references Section 6", () => {
    expect(MIGRATION_SQL).toMatch(/Section 6/);
  });

  it("comment body documents the per-scope population contract", () => {
    // Must mention which scopes are populated.
    expect(MIGRATION_SQL).toMatch(/account/);
    expect(MIGRATION_SQL).toMatch(/platform/);
    expect(MIGRATION_SQL).toMatch(/prompt/);
    expect(MIGRATION_SQL).toMatch(/entity/);
  });

  it("comment body documents the topic-NULL v1 contract (H8)", () => {
    // Topic scope is explicitly skipped in v1.
    expect(MIGRATION_SQL).toMatch(/topic/);
    expect(MIGRATION_SQL).toMatch(/NULL/);
  });

  it("comment body documents the backfill-pending contract (C3)", () => {
    expect(MIGRATION_SQL).toMatch(/backfill/i);
  });
});

// ─── 4. Forbidden shapes ───────────────────────────────────────────

describe("Section 6 C1 — Invariant 4: additive-only / no policy changes / no NOT NULL / no data mutation", () => {
  it("does NOT contain CREATE TABLE", () => {
    expect(ACTIVE_SQL).not.toMatch(/CREATE\s+TABLE/i);
  });

  it("does NOT contain ALTER POLICY", () => {
    expect(ACTIVE_SQL).not.toMatch(/ALTER\s+POLICY/i);
  });

  it("does NOT contain DROP POLICY", () => {
    expect(ACTIVE_SQL).not.toMatch(/DROP\s+POLICY/i);
  });

  it("does NOT contain CREATE POLICY", () => {
    expect(ACTIVE_SQL).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("does NOT add NOT NULL to the new column", () => {
    // Strict: in the ADD COLUMN clause for primary_recommendation_count,
    // there must be no NOT NULL constraint. Match the column declaration
    // up to the next semicolon and assert NOT NULL is absent.
    const m = ACTIVE_SQL.match(
      /ADD\s+COLUMN\s+IF\s+NOT\s+EXISTS\s+"primary_recommendation_count"[^;]*;/i,
    );
    expect(m).not.toBeNull();
    expect(m![0]).not.toMatch(/NOT\s+NULL/i);
  });

  it("does NOT contain INSERT / UPDATE / DELETE (no data mutation)", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*INSERT\s+INTO/im);
    expect(ACTIVE_SQL).not.toMatch(/^\s*UPDATE\s+"?public"?\./im);
    expect(ACTIVE_SQL).not.toMatch(/^\s*DELETE\s+FROM/im);
  });
});

// ─── 5. Cross-table safety ─────────────────────────────────────────

describe("Section 6 C1 — Invariant 5: only daily_metric_snapshots is touched", () => {
  it("every ALTER TABLE / COMMENT ON COLUMN targets daily_metric_snapshots", () => {
    // Collect every quoted table reference in active SQL and assert
    // none other than daily_metric_snapshots is mentioned.
    const tableRefs = [
      ...ACTIVE_SQL.matchAll(/"public"\."([a-z_]+)"/gi),
    ].map((m) => m[1]);
    const distinct = new Set(tableRefs);
    for (const t of distinct) {
      expect(t, `Migration references unexpected table: ${t}`).toBe(
        "daily_metric_snapshots",
      );
    }
  });
});
