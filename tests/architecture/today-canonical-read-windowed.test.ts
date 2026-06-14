/**
 * wave-6 CRITICAL regression ratchet (2026-06-14).
 *
 * The /today dashboard was silently rendering EMPTY in production: its two
 * canonical reads (prompt_answer_observations, daily_metric_snapshots) ran
 * unbounded + OFFSET-paginated with NO composite (tenant_id, <date>) index, so
 * each page re-ran a multi-second Seq Scan and the run blew the 8s Postgres
 * statement_timeout -> the read threw, was swallowed ("continuing with empty
 * canonical arrays"), and the customer saw a blank Today.
 *
 * The fix has TWO prerequisites that this ratchet pins so neither can silently
 * regress as the codebase evolves:
 *   1. today-data.ts MUST date-WINDOW the canonical read (observationsSince +
 *      snapshotsSince) — without the window the read is unbounded again.
 *   2. The composite (tenant_id, <date>) indexes MUST exist in the migration
 *      schema-of-record — without them the windowed read still Seq-Scans.
 *
 * Source-text invariants (no DB needed); see VERIFICATION_LOG 2026-06-14 wave-6.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const TODAY_DATA = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/today-data.ts"),
  "utf8",
);
const MIGRATION = resolve(
  REPO_ROOT,
  "migrations/2026-06-14_today_canonical_read_tenant_date_indexes.sql",
);

describe("today canonical read — date-windowed (CRITICAL silent-empty guard)", () => {
  it("passes observationsSince + snapshotsSince into loadFreshCanonicalData", () => {
    // The window keeps the read bounded; dropping it sends both reads
    // unbounded and re-opens the statement-timeout -> empty-dashboard class.
    expect(TODAY_DATA).toMatch(
      /loadFreshCanonicalData\(\s*\{[\s\S]{0,200}observationsSince[\s\S]{0,200}snapshotsSince/,
    );
  });

  it("derives both since-windows from a now-relative day offset (not unbounded)", () => {
    expect(TODAY_DATA).toMatch(/const\s+observationsSince\s*=/);
    expect(TODAY_DATA).toMatch(/const\s+snapshotsSince\s*=/);
  });
});

describe("today canonical read — composite (tenant_id, date) indexes exist", () => {
  it("the index migration is recorded in the schema-of-record", () => {
    expect(existsSync(MIGRATION)).toBe(true);
  });

  it("creates the composite indexes the windowed+paginated reads seek on", () => {
    const sql = readFileSync(MIGRATION, "utf8");
    expect(sql).toMatch(
      /create\s+index[\s\S]{0,80}idx_pao_tenant_observed_at[\s\S]{0,120}prompt_answer_observations\s*\(\s*tenant_id\s*,\s*observed_at\s*\)/i,
    );
    expect(sql).toMatch(
      /create\s+index[\s\S]{0,80}idx_dms_tenant_date[\s\S]{0,120}daily_metric_snapshots\s*\(\s*tenant_id\s*,\s*date\s*\)/i,
    );
  });
});
