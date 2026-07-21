/**
 * Migration contract tests — RLS Phase 1 Stage C: extend tenant_id-nonempty
 * CHECK constraints to remaining Cat-A2 tables.
 *
 * Migration file:
 *   migrations/2026-05-10_phase1_stage_c_tenant_id_nonempty_checks.sql
 *
 * Static-analysis tests (no live DB connection required). Verifies:
 *
 *   1. Migration file exists.
 *   2. All 12 Cat-A2 target tables end up with a tenant_id-nonempty CHECK
 *      constraint (9 added by this migration; 3 pre-existing in the
 *      baseline schema dump under a different name suffix).
 *   3. tenant_members is NOT modified by this migration.
 *   4. No CREATE / DROP / ALTER POLICY statements.
 *   5. No ENABLE / DISABLE / FORCE ROW LEVEL SECURITY statements.
 *   6. No DROP / RENAME COLUMN statements.
 *   7. Rollback block only drops Stage C-added constraints (9 of them).
 *   8. No data mutations (INSERT / UPDATE / DELETE) other than the
 *      preflight DO block's SELECTs.
 *   9. Single source-of-truth: only the migration file changed in this
 *      bundle (no app/source files modified).
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
  "migrations/2026-05-10_phase1_stage_c_tenant_id_nonempty_checks.sql",
);
const BASELINE_PATH = join(
  REPO_ROOT,
  "migrations/2026-05-08_baseline_schema.sql",
);

function readSrc(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf-8");
}

const MIGRATION_SQL = existsSync(MIGRATION_PATH)
  ? readFileSync(MIGRATION_PATH, "utf-8")
  : "";
const BASELINE_SQL = readFileSync(BASELINE_PATH, "utf-8");

// Active section = everything before the rollback marker.
const ACTIVE_SQL = MIGRATION_SQL.split("-- ROLLBACK")[0];
// Rollback section = everything after the rollback marker.
const ROLLBACK_SQL = MIGRATION_SQL.includes("-- ROLLBACK")
  ? MIGRATION_SQL.split("-- ROLLBACK")[1]
  : "";

// 9 tables this migration ADDS a CHECK to.
const TO_BE_CONSTRAINED = [
  "change_outcomes",
  "guardrail_alerts",
  "llm_rejections",
  "observation_runs",
  "page_element_inventory",
  "page_snapshots",
  "pages",
  "raw_poll_chunks",
  "url_change_outcomes",
];

// 3 tables that ALREADY have a tenant_id-nonempty CHECK (different name suffix).
const ALREADY_CONSTRAINED = [
  "daily_metric_snapshots",
  "prompt_answer_observations",
  "recommended_edits",
];

const ALL_CAT_A2_TARGETS = [...TO_BE_CONSTRAINED, ...ALREADY_CONSTRAINED];

// ─── Invariant 1 — migration file exists ─────────────────────────────────

describe("Phase 1 Stage C — Invariant 1: migration file exists", () => {
  it("file is at the expected path", () => {
    expect(existsSync(MIGRATION_PATH)).toBe(true);
  });

  it("file is non-empty SQL", () => {
    expect(MIGRATION_SQL.length).toBeGreaterThan(500);
    expect(MIGRATION_SQL).toMatch(/^BEGIN;/m);
    expect(MIGRATION_SQL).toMatch(/^COMMIT;/m);
  });
});

// ─── Invariant 2 — all 12 Cat-A2 tables end up with a CHECK ──────────────

describe("Phase 1 Stage C — Invariant 2: all 12 Cat-A2 tables end up with tenant_id-nonempty CHECK", () => {
  for (const tbl of TO_BE_CONSTRAINED) {
    it(`adds ${tbl}_tenant_id_nonempty_chk in this migration`, () => {
      const re = new RegExp(
        `ALTER TABLE "public"\\."${tbl}"\\s+ADD CONSTRAINT "${tbl}_tenant_id_nonempty_chk"\\s+CHECK \\("tenant_id" IS NOT NULL AND "tenant_id" <> ''\\)`,
      );
      expect(ACTIVE_SQL).toMatch(re);
    });
  }

  for (const tbl of ALREADY_CONSTRAINED) {
    it(`pre-existing CHECK on ${tbl} survives in the baseline (this migration does not touch it)`, () => {
      // Either suffix counts. Baseline shows them under `_nonempty` (no `_chk`).
      const re = new RegExp(
        `CONSTRAINT "${tbl}_tenant_id_nonempty(_chk)?"[\\s\\S]*?CHECK[\\s\\S]*?tenant_id`,
      );
      expect(BASELINE_SQL).toMatch(re);
      // Stage C does NOT redundantly add a duplicate constraint on these.
      const dupRe = new RegExp(
        `^ALTER TABLE "public"\\."${tbl}"\\s+ADD CONSTRAINT "${tbl}_tenant_id_nonempty_chk"`,
        "m",
      );
      expect(ACTIVE_SQL).not.toMatch(dupRe);
    });
  }

  it("all 12 Cat-A2 target tables are referenced in the preflight DO block", () => {
    for (const tbl of ALL_CAT_A2_TARGETS) {
      const re = new RegExp(
        `FROM "public"\\."${tbl}"[\\s\\S]{0,80}WHERE "tenant_id" IS NULL OR "tenant_id" = ''`,
      );
      expect(ACTIVE_SQL).toMatch(re);
    }
  });

  it("preflight DO block raises an exception on any bad row", () => {
    expect(ACTIVE_SQL).toMatch(/RAISE EXCEPTION/);
    expect(ACTIVE_SQL).toMatch(/Stage C preflight FAILED/);
  });
});

// ─── Invariant 3 — tenant_members not modified ───────────────────────────

describe("Phase 1 Stage C — Invariant 3: tenant_members untouched", () => {
  it("does NOT mention tenant_members in any active SQL statement", () => {
    // Allowed only in commentary (lines starting with `--`).
    const codeOnly = ACTIVE_SQL.split("\n")
      .filter((line) => !/^\s*--/.test(line))
      .join("\n");
    expect(codeOnly).not.toMatch(/tenant_members/);
  });
});

// ─── Invariant 4 — no RLS policy statements ──────────────────────────────

describe("Phase 1 Stage C — Invariant 4: no RLS policy changes", () => {
  it("no CREATE POLICY", () => {
    expect(MIGRATION_SQL).not.toMatch(/^CREATE POLICY/m);
  });

  it("no DROP POLICY", () => {
    expect(MIGRATION_SQL).not.toMatch(/^DROP POLICY/m);
  });

  it("no ALTER POLICY", () => {
    expect(MIGRATION_SQL).not.toMatch(/^ALTER POLICY/m);
  });
});

// ─── Invariant 5 — no RLS enable/disable/force statements ────────────────

describe("Phase 1 Stage C — Invariant 5: no RLS toggle", () => {
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

// ─── Invariant 6 — no column drop or rename ──────────────────────────────

describe("Phase 1 Stage C — Invariant 6: no column drop or rename", () => {
  it("no DROP COLUMN in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/DROP COLUMN/i);
  });

  it("no RENAME COLUMN in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/RENAME COLUMN/i);
  });

  it("no DROP TABLE / TRUNCATE / DELETE FROM in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/^DROP TABLE/im);
    expect(ACTIVE_SQL).not.toMatch(/^TRUNCATE/im);
    expect(ACTIVE_SQL).not.toMatch(/^DELETE FROM/im);
  });
});

// ─── Invariant 7 — rollback block drops only Stage C constraints ─────────

describe("Phase 1 Stage C — Invariant 7: rollback drops only Stage C constraints", () => {
  it("rollback block exists at the bottom (commented-out)", () => {
    expect(MIGRATION_SQL).toMatch(/-- ROLLBACK/);
    // The active section must end with COMMIT; — anything after the
    // ROLLBACK marker should be SQL-inert (commented). Verify this by
    // ensuring no uncommented BEGIN / COMMIT / ALTER / DROP / CREATE
    // statements appear inside the rollback section.
    const uncommentedLines = ROLLBACK_SQL.split("\n").filter((line) => {
      const trimmed = line.trim();
      return trimmed.length > 0 && !trimmed.startsWith("--");
    });
    for (const line of uncommentedLines) {
      expect(
        /^\s*(BEGIN|COMMIT|ALTER|DROP|CREATE|UPDATE|DELETE|INSERT|TRUNCATE|GRANT|REVOKE|COMMENT)/i.test(
          line,
        ),
        `non-comment SQL statement found inside rollback section: "${line}"`,
      ).toBe(false);
    }
  });

  it("rollback drops exactly the 9 Stage C constraints (no others)", () => {
    for (const tbl of TO_BE_CONSTRAINED) {
      const re = new RegExp(
        `DROP CONSTRAINT IF EXISTS "${tbl}_tenant_id_nonempty_chk"`,
      );
      expect(ROLLBACK_SQL).toMatch(re);
    }
  });

  it("rollback does NOT drop the 3 pre-existing constraints", () => {
    for (const tbl of ALREADY_CONSTRAINED) {
      const reExact = new RegExp(
        `DROP CONSTRAINT IF EXISTS "${tbl}_tenant_id_nonempty(_chk)?"`,
      );
      expect(ROLLBACK_SQL).not.toMatch(reExact);
    }
  });

  it("rollback does NOT touch tenant_members", () => {
    expect(ROLLBACK_SQL).not.toMatch(/tenant_members/);
  });
});

// ─── Invariant 8 — no data mutations beyond preflight SELECTs ────────────

describe("Phase 1 Stage C — Invariant 8: no data mutations", () => {
  it("no INSERT in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*INSERT\s+INTO/im);
  });

  it("no UPDATE in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*UPDATE\s+"public"/im);
  });

  it("no DELETE in active SQL", () => {
    expect(ACTIVE_SQL).not.toMatch(/^\s*DELETE\s+FROM/im);
  });

  it("preflight uses SELECT count(*) only (read-only check)", () => {
    expect(ACTIVE_SQL).toMatch(/SELECT count\(\*\) FROM "public"\."change_outcomes"/);
    expect(ACTIVE_SQL).toMatch(/SELECT count\(\*\) FROM "public"\."url_change_outcomes"/);
  });
});

// ─── Invariant 9 — no app/source files modified ──────────────────────────

describe("Phase 1 Stage C — Invariant 9: no app/source files modified", () => {
  // Stage C is a schema-only bundle. No dual-write changes, no repository
  // changes, no type changes, no caller changes. The migration file +
  // this test file are the only deliverables.
  //
  // We can't perfectly check "what the bundle changed" from inside a test
  // without git. But we CAN verify that critical app-code shapes from
  // Stage B survive untouched — i.e., the Cat-B / Cat-C dual-write
  // signatures and the canonical tenant_id reads.

  const dualWrite = readSrc("src/lib/persistence/dual-write.ts");
  const supabaseBackend = readSrc(
    "src/lib/persistence/repositories/supabase-backend.ts",
  );

  it("surviving sync wrappers retain their tenantId signatures", () => {
    // Repointed 2026-07-21 (CORE 100K Lane O): the original subject
    // (syncOpportunities) was deleted with the dead import-cluster writers,
    // so the "app-code shapes survive" spot-check now pins a LIVE Tier A
    // writer instead.
    expect(dualWrite).toMatch(
      /export async function syncImportRuns\([^)]*tenantId: string[^)]*\):/,
    );
    expect(dualWrite).toMatch(
      /tenantizeRows\(runs, tenantId, "import_runs"\)/,
    );
  });

  it("Stage C Cat-C canonical reads retain tenant_id filtering", () => {
    expect(supabaseBackend).toMatch(
      /\.from\("tracked_prompts"\)[\s\S]*?\.eq\("tenant_id", tenantId\)/,
    );
    expect(supabaseBackend).toMatch(
      /\.from\("tracked_entities"\)[\s\S]*?\.eq\("tenant_id", tenantId\)/,
    );
  });
});
