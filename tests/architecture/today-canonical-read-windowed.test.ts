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
 *   1. The /today canonical read MUST be date-WINDOWED (observationsSince +
 *      snapshotsSince) — without the window the read is unbounded again.
 *   2. The composite (tenant_id, <date>) indexes MUST exist in the migration
 *      schema-of-record — without them the windowed read still Seq-Scans.
 *
 * 2026-07-01 (FINAL PREMIUM PLAN item 101): the legacy today-data.ts loader
 * was deleted; the live /today canonical read is `loadCachedFreshCanonical`
 * (+ the 14d sibling) in today-v2-data.ts with the V2_OBSERVATION_COLUMNS
 * lean projection. The ratchet now pins that surface.
 *
 * Source-text invariants (no DB needed); see VERIFICATION_LOG 2026-06-14 wave-6.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "../..");
const TODAY_V2_DATA = readFileSync(
  resolve(REPO_ROOT, "src/app/(shell)/today-v2-data.ts"),
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
    expect(TODAY_V2_DATA).toMatch(
      /loadFreshCanonicalData\(\s*\{[\s\S]{0,200}observationsSince[\s\S]{0,200}snapshotsSince/,
    );
  });

  it("derives both since-windows from a now-relative day offset (not unbounded)", () => {
    expect(TODAY_V2_DATA).toMatch(/const\s+observationsSince\s*=/);
    expect(TODAY_V2_DATA).toMatch(/const\s+snapshotsSince\s*=/);
  });
});

describe("today canonical read — lean observation projection (egress + timeout guard)", () => {
  // 2026-06-15 — the 60-day observation window is ~17 MB / 8.7k rows for a
  // data-rich tenant with select(*); the `metadata` JSONB alone is ~5.9 MB and
  // is read ONLY by the /recommendations packet builder, never on /today.
  // /today MUST pass a lean column projection (drop metadata + the other unused
  // columns) or it re-opens the statement-timeout -> silent-empty-dashboard
  // class. See commit 71893c9 + project_today_observation_egress memory.
  it("passes observationsColumns into loadFreshCanonicalData", () => {
    expect(TODAY_V2_DATA).toMatch(
      /observationsColumns:\s*V2_OBSERVATION_COLUMNS/,
    );
  });

  it("the projection OMITS the heavy/unused columns (must never be re-added)", () => {
    // Isolate the projection constant's literal so we only assert on it.
    const m = TODAY_V2_DATA.match(
      /const\s+V2_OBSERVATION_COLUMNS\s*=([\s\S]*?);/,
    );
    expect(m).not.toBeNull();
    const projection = (m?.[1] ?? "").toLowerCase();
    for (const dropped of [
      "metadata",
      "citation_domains",
      "citation_categories",
      "raw_search_queries",
      "search_queries",
    ]) {
      // word-boundary so `citation_domains` doesn't match `citation_domain_classes`
      expect(new RegExp(`\\b${dropped}\\b`).test(projection)).toBe(false);
    }
  });

  it("the projection KEEPS the columns /today's matrix + rollups read", () => {
    const m = TODAY_V2_DATA.match(
      /const\s+V2_OBSERVATION_COLUMNS\s*=([\s\S]*?);/,
    );
    const projection = (m?.[1] ?? "").toLowerCase();
    for (const kept of [
      "prompt_id",
      "observed_at",
      "platform",
      "primary_recommendation",
      "competitor_co_mentions",
      "competitor_descriptor_windows",
      "citation_urls",
      "mentions",
      "answer_structure",
    ]) {
      expect(new RegExp(`\\b${kept}\\b`).test(projection)).toBe(true);
    }
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
