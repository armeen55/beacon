/**
 * Migration contract tests — RLS Phase 1 Stage B + Category C additive
 * tenant_id repair. Migration file:
 *   migrations/2026-05-09_phase1_stage_b_c_tenant_id_repair.sql
 *
 * Static-analysis tests (no live DB connection required). Verifies the
 * 7 invariants the operator brief locked in:
 *
 *   1. Each repaired table has tenant_id in the migration text.
 *   2. Each table gets a tenant_id_nonempty CHECK constraint.
 *   3. Each table gets a tenant_id index.
 *   4. dual-write stamps tenant_id on Category B writers.
 *   5. Category C reads use tenant_id (canonical) while writes stamp BOTH
 *      tenant_id and account_id.
 *   6. No production RLS policies are changed in this migration.
 *   7. No account_id column is dropped (Category C compatibility kept).
 *
 * Plan: docs/RLS_PHASE_1_PLAN_2026_05_08.md
 * Truth: docs/CURRENT_BEACON_TRUTH_2026_05_08.md
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const REPO_ROOT = resolve(__dirname, "..", "..");

function readSrc(rel: string): string {
  return readFileSync(join(REPO_ROOT, rel), "utf-8");
}

const MIGRATION_PATH =
  "migrations/2026-05-09_phase1_stage_b_c_tenant_id_repair.sql";
const MIGRATION_SQL = readSrc(MIGRATION_PATH);

const CATEGORY_B_TABLES = [
  "attribution_decisions",
  "candidate_links",
  "competitor_config",
  "competitors",
  "opportunities",
  "page_issues",
  "page_visibility",
];

const CATEGORY_C_TABLES = [
  "change_contracts",
  "tracked_prompts",
  "tracked_entities",
];

const ALL_TABLES = [...CATEGORY_B_TABLES, ...CATEGORY_C_TABLES];

// ─── Invariant 1 — tenant_id column added to every repaired table ────────

describe("Phase 1 Stage B/C migration — Invariant 1: tenant_id column added", () => {
  for (const tbl of ALL_TABLES) {
    it(`adds tenant_id to ${tbl}`, () => {
      const re = new RegExp(
        `ALTER TABLE "public"\\."${tbl}"\\s+ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL`,
      );
      expect(MIGRATION_SQL).toMatch(re);
    });
  }
});

// ─── Invariant 2 — tenant_id_nonempty CHECK constraint per table ─────────

describe("Phase 1 Stage B/C migration — Invariant 2: nonempty CHECK", () => {
  for (const tbl of ALL_TABLES) {
    it(`adds ${tbl}_tenant_id_nonempty_chk`, () => {
      // Match the active (non-rollback) ADD CONSTRAINT line.
      const re = new RegExp(
        `^ALTER TABLE "public"\\."${tbl}"\\s+ADD CONSTRAINT "${tbl}_tenant_id_nonempty_chk"\\s+CHECK \\("tenant_id" IS NOT NULL AND "tenant_id" <> ''\\)`,
        "m",
      );
      expect(MIGRATION_SQL).toMatch(re);
    });
  }
});

// ─── Invariant 3 — tenant_id index per table ─────────────────────────────

describe("Phase 1 Stage B/C migration — Invariant 3: tenant_id index", () => {
  for (const tbl of ALL_TABLES) {
    it(`creates ${tbl}_tenant_id_idx`, () => {
      const re = new RegExp(
        `CREATE INDEX IF NOT EXISTS "${tbl}_tenant_id_idx"\\s+ON "public"\\."${tbl}" \\("tenant_id"\\)`,
      );
      expect(MIGRATION_SQL).toMatch(re);
    });
  }
});

// ─── Invariant 4 — Category B dual-write writers stamp tenant_id ─────────
//
// Invariant-4 writer pins removed 2026-07-21 (CORE 100K Lane O): the Cat-B
// writers syncOpportunities / syncCompetitors / syncEventDecisions /
// syncCandidateLinks / syncPageIssues were deleted outright (zero prod
// callers after the import-cluster retirement), so there is no writer left
// to pin. The migration-side invariants (1-3, 6-8) still verify the schema
// contract; syncPageVisibility's pin was removed earlier (Lane K) for the
// same reason.

// ─── Invariant 5 — Category C still works; tenant_id is canonical ────────

describe("Phase 1 Stage C — Invariant 5: tracked_prompts/entities/change_contracts canonical=tenant_id, account_id retained", () => {
  const dualWrite = readSrc("src/lib/persistence/dual-write.ts");
  const supabaseBackend = readSrc(
    "src/lib/persistence/repositories/supabase-backend.ts",
  );

  it("syncTrackedPrompts requires tenantId and uses tenantizeRows", () => {
    expect(dualWrite).toMatch(
      /export async function syncTrackedPrompts\([^)]*tenantId: string[^)]*\):/,
    );
    expect(dualWrite).toMatch(
      /tenantizeRows\(rows, tenantId, "tracked_prompts"\)/,
    );
  });

  it("syncTrackedEntities requires tenantId and uses tenantizeRows", () => {
    expect(dualWrite).toMatch(
      /export async function syncTrackedEntities\([^)]*tenantId: string[^)]*\):/,
    );
    expect(dualWrite).toMatch(
      /tenantizeRows\(rows, tenantId, "tracked_entities"\)/,
    );
  });

  // syncChangeContracts pin removed 2026-07-21 (CORE 100K Lane O): the writer
  // was deleted (zero prod callers); the tenant-scoped getChangeContracts
  // READ path stays live and is covered by the repository pushdown tests.

  it("getTrackedPrompts repository read filters by tenant_id (canonical)", () => {
    expect(supabaseBackend).toMatch(
      /\.from\("tracked_prompts"\)[\s\S]*?\.eq\("tenant_id", tenantId\)/,
    );
    // Old account_id-based read should be gone from this code path.
    expect(supabaseBackend).not.toMatch(
      /\.from\("tracked_prompts"\)[\s\S]{0,200}\.eq\("account_id"/,
    );
  });

  it("getTrackedEntities repository read filters by tenant_id (canonical)", () => {
    expect(supabaseBackend).toMatch(
      /\.from\("tracked_entities"\)[\s\S]*?\.eq\("tenant_id", tenantId\)/,
    );
    expect(supabaseBackend).not.toMatch(
      /\.from\("tracked_entities"\)[\s\S]{0,200}\.eq\("account_id"/,
    );
  });

  it("TrackedPrompt type has additive optional tenant_id alongside account_id", () => {
    const types = readSrc("src/domains/tracked-prompts/types.ts");
    expect(types).toMatch(/account_id: string;/);
    expect(types).toMatch(/tenant_id\?: string \| null;/);
  });

  it("TrackedEntity type has additive optional tenant_id alongside account_id", () => {
    const types = readSrc("src/domains/tracked-entities/types.ts");
    expect(types).toMatch(/account_id: string;/);
    expect(types).toMatch(/tenant_id\?: string \| null;/);
  });
});

// ─── Invariant 6 — No RLS policy changes in this migration ───────────────

describe("Phase 1 Stage B/C migration — Invariant 6: no RLS policy changes", () => {
  it("does NOT contain any CREATE POLICY", () => {
    expect(MIGRATION_SQL).not.toMatch(/^CREATE POLICY/m);
  });

  it("does NOT contain any DROP POLICY", () => {
    expect(MIGRATION_SQL).not.toMatch(/^DROP POLICY/m);
  });

  it("does NOT contain any ALTER POLICY", () => {
    expect(MIGRATION_SQL).not.toMatch(/^ALTER POLICY/m);
  });

  it("does NOT contain any ENABLE ROW LEVEL SECURITY toggle", () => {
    // The baseline already has these enabled; this migration must not
    // re-enable / disable RLS on any table.
    expect(MIGRATION_SQL).not.toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(MIGRATION_SQL).not.toMatch(/DISABLE ROW LEVEL SECURITY/);
    expect(MIGRATION_SQL).not.toMatch(/FORCE ROW LEVEL SECURITY/);
  });
});

// ─── Invariant 7 — No account_id column dropped ──────────────────────────

describe("Phase 1 Stage B/C migration — Invariant 7: account_id retained on Cat-C", () => {
  it("does NOT drop account_id column on any table (active SQL only — rollback comments excepted)", () => {
    // Strip rollback section (commented-out lines after "-- ROLLBACK").
    const activeSql = MIGRATION_SQL.split("-- ROLLBACK")[0];
    expect(activeSql).not.toMatch(/DROP COLUMN[^;]*account_id/i);
    expect(activeSql).not.toMatch(/DROP COLUMN IF EXISTS\s+["']?account_id/i);
  });

  it("does NOT rename account_id on any table", () => {
    const activeSql = MIGRATION_SQL.split("-- ROLLBACK")[0];
    expect(activeSql).not.toMatch(/RENAME COLUMN[^;]*account_id/i);
  });

  it("Category C tables still carry account_id semantics in the codebase", () => {
    // (ChangeContract's account_id mapping assert removed 2026-07-21, Lane O:
    // the syncChangeContracts writer + its row mapper were deleted. The
    // ChangeContract TYPE still carries accountId.)

    // tracked_prompts type still has account_id.
    const trackedPromptType = readSrc("src/domains/tracked-prompts/types.ts");
    expect(trackedPromptType).toMatch(/account_id: string;/);

    // tracked_entities type still has account_id.
    const trackedEntityType = readSrc("src/domains/tracked-entities/types.ts");
    expect(trackedEntityType).toMatch(/account_id: string;/);
  });
});
