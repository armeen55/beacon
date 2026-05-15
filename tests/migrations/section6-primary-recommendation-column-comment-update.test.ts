/**
 * Migration contract tests — Section 6 Commit C1.1:
 *   migrations/2026-05-15_section6_primary_recommendation_column_comment_update.sql
 *
 * Static-analysis tests. The C1 column comment promised account-scope
 * population in C2. The C2 pre-flight surfaced that the native poll
 * orchestrator is per-platform-per-chunk, making a cross-platform
 * account row unsafe to write without a new post-cron aggregator. The
 * operator declined the aggregator and chose to correct the comment
 * instead.
 *
 * This migration replaces the C1 COMMENT ON COLUMN with one that
 * matches what C2 actually does:
 *   - populated: platform / prompt / entity
 *   - null:      topic / competitor-entity
 *   - account:   NOT MATERIALIZED — derived at read time from
 *                platform rows
 *
 * These pins guarantee the comment-only correction stays shaped
 * correctly through review + apply:
 *   1. File exists at the canonical path.
 *   2. Contains exactly one COMMENT ON COLUMN targeting
 *      public.daily_metric_snapshots.primary_recommendation_count.
 *   3. Comment body documents the corrected C2 scope (platform /
 *      prompt / entity populated; topic + competitor-entity null;
 *      account derived at read time).
 *   4. Does NOT contain ALTER TABLE / ADD COLUMN / DROP COLUMN / RLS
 *      changes / data mutation.
 *   5. Does NOT contain the literal `(account, platform, prompt, entity)`
 *      wording from the C1 comment (sanity check the correction
 *      actually replaced the inaccurate phrase).
 *   6. References ONLY public.daily_metric_snapshots (no
 *      cross-table edits).
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");
const MIGRATION_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-15_section6_primary_recommendation_column_comment_update.sql",
);

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";

// Strip line comments so the "does NOT contain" assertions can't be
// tripped by the rollback section in the header that legitimately
// quotes the prior C1 phrasing for context.
const ACTIVE_SQL = MIGRATION_SQL.split("\n")
  .map((line) => {
    const idx = line.indexOf("--");
    return idx === -1 ? line : line.slice(0, idx);
  })
  .join("\n");

// ─── 1. File shape ─────────────────────────────────────────────────

describe("Section 6 C1.1 — Invariant 1: file shape", () => {
  it("migration file exists at the canonical path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("file is non-empty", () => {
    expect(MIGRATION_SQL.length).toBeGreaterThan(0);
  });
});

// ─── 2. COMMENT ON COLUMN target ──────────────────────────────────

describe("Section 6 C1.1 — Invariant 2: COMMENT ON COLUMN target", () => {
  it("contains exactly one COMMENT ON COLUMN statement", () => {
    const matches = ACTIVE_SQL.match(/COMMENT\s+ON\s+COLUMN/gi);
    expect(matches?.length ?? 0).toBe(1);
  });

  it("targets public.daily_metric_snapshots.primary_recommendation_count", () => {
    expect(ACTIVE_SQL).toMatch(
      /COMMENT\s+ON\s+COLUMN\s+"public"\."daily_metric_snapshots"\."primary_recommendation_count"\s+IS/i,
    );
  });
});

// ─── 3. Corrected scope documented in the new comment body ────────

describe("Section 6 C1.1 — Invariant 3: comment body documents corrected C2 scope", () => {
  // The new comment body is a single-quoted SQL string. Grep the
  // active SQL (with line comments stripped) so the assertions only
  // see what Postgres will persist, not the rollback header prose.

  it("comment body references Section 6", () => {
    expect(ACTIVE_SQL).toMatch(/Section 6/);
  });

  it("comment body lists platform, prompt, and entity as populated scopes", () => {
    expect(ACTIVE_SQL).toMatch(/platform/);
    expect(ACTIVE_SQL).toMatch(/prompt/);
    expect(ACTIVE_SQL).toMatch(/entity/);
  });

  it("comment body documents NULL on topic + competitor-entity", () => {
    expect(ACTIVE_SQL).toMatch(/topic/);
    expect(ACTIVE_SQL).toMatch(/competitor/);
    expect(ACTIVE_SQL).toMatch(/NULL/);
  });

  it("comment body documents that account is NOT materialized in C2", () => {
    // Active comment body must contain BOTH:
    //   1. an explicit statement that account is not materialized; and
    //   2. an explanation that account is derived at read time
    //      from platform rows.
    expect(ACTIVE_SQL).toMatch(/account/i);
    expect(ACTIVE_SQL).toMatch(/NOT\s+MATERIALIZED/i);
    expect(ACTIVE_SQL).toMatch(/READ\s+TIME/i);
    expect(ACTIVE_SQL).toMatch(/platform\s+rows/i);
  });

  it("comment body documents backfill-pending (C3) contract", () => {
    expect(ACTIVE_SQL).toMatch(/backfill/i);
  });
});

// ─── 4. C1 wording correction sanity check ────────────────────────

describe("Section 6 C1.1 — Invariant 4: C1 wording actually replaced", () => {
  // The C1 comment claimed "scope_type IN (account, platform, prompt,
  // entity)". The corrected comment must NOT carry that exact tuple
  // since account is excluded now. Use a tolerant pattern that
  // matches comma-separated 4-tuple with account first; the new
  // comment is a 3-tuple (platform, prompt, entity).
  it("active SQL does NOT contain the literal C1 4-tuple (account, platform, prompt, entity)", () => {
    // Match the active comment body for the literal tuple. Whitespace
    // tolerant. If present, the correction failed.
    expect(ACTIVE_SQL).not.toMatch(
      /\(\s*account\s*,\s*platform\s*,\s*prompt\s*,\s*entity\s*\)/i,
    );
  });
});

// ─── 5. Forbidden shapes — comment-only migration ─────────────────

describe("Section 6 C1.1 — Invariant 5: COMMENT-only / no structural change / no data mutation", () => {
  it("does NOT contain ALTER TABLE", () => {
    expect(ACTIVE_SQL).not.toMatch(/ALTER\s+TABLE/i);
  });

  it("does NOT contain ADD COLUMN", () => {
    expect(ACTIVE_SQL).not.toMatch(/ADD\s+COLUMN/i);
  });

  it("does NOT contain DROP COLUMN", () => {
    expect(ACTIVE_SQL).not.toMatch(/DROP\s+COLUMN/i);
  });

  it("does NOT contain CREATE TABLE", () => {
    expect(ACTIVE_SQL).not.toMatch(/CREATE\s+TABLE/i);
  });

  it("does NOT contain ALTER / DROP / CREATE POLICY", () => {
    expect(ACTIVE_SQL).not.toMatch(/ALTER\s+POLICY/i);
    expect(ACTIVE_SQL).not.toMatch(/DROP\s+POLICY/i);
    expect(ACTIVE_SQL).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("does NOT contain INSERT / UPDATE / DELETE (no data mutation)", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*INSERT\s+INTO/im);
    expect(ACTIVE_SQL).not.toMatch(/^\s*UPDATE\s+"?public"?\./im);
    expect(ACTIVE_SQL).not.toMatch(/^\s*DELETE\s+FROM/im);
  });
});

// ─── 6. Cross-table safety ────────────────────────────────────────

describe("Section 6 C1.1 — Invariant 6: only daily_metric_snapshots is touched", () => {
  it("every quoted table reference targets daily_metric_snapshots", () => {
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
