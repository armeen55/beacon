-- ============================================================================
-- Migration: 2026-05-09_phase1_stage_b_c_tenant_id_repair.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — to be applied via Supabase apply_migration MCP
--            after operator review. Do NOT supabase db push to production.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 1 Stage B + Category C additive tenant_id repair
-- Plan:      docs/RLS_PHASE_1_PLAN_2026_05_08.md
-- Baseline:  migrations/2026-05-08_baseline_schema.sql (commit 11101a2)
-- ============================================================================
--
-- Purpose
-- -------
-- Make every tenant-scoped public table carry an explicit `tenant_id` column.
-- This is SCHEMA REPAIR + BACKFILL + INDEX + CHECK CONSTRAINT only.
--
-- This migration does NOT:
--   • change any RLS policies (deny_anon + deny_authenticated stay as-is)
--   • drop or rename any column (account_id stays where it is on Cat-C)
--   • change app reads/writes beyond stamping tenant_id on the affected
--     dual-write paths (handled in code in the same commit)
--   • mutate Supabase production directly
--
-- Production posture remains: service-role bypasses RLS for all app paths.
-- The deny policies are still defense-in-depth. Stage E will replace
-- deny_authenticated with selective tenant-scoped policies, after this
-- migration lands and Stage C/D follow.
--
-- Reversibility
-- -------------
-- Each section is reversible with the exact inverse:
--   ALTER TABLE <tbl> DROP CONSTRAINT IF EXISTS <tbl>_tenant_id_nonempty_chk;
--   DROP INDEX IF EXISTS <tbl>_tenant_id_idx;
--   ALTER TABLE <tbl> DROP COLUMN IF EXISTS tenant_id;
-- See the bottom of this file for a commented-out rollback block.
--
-- Categories (per docs/RLS_PHASE_1_PLAN_2026_05_08.md)
-- ----------------------------------------------------
-- Category B (7 tables, missing tenant_id, scoped by intent):
--   attribution_decisions, candidate_links, competitor_config, competitors,
--   opportunities, page_issues, page_visibility
--
-- Category C (3 tables, use account_id today; this migration is ADDITIVE):
--   change_contracts, tracked_prompts, tracked_entities
--
-- For Category C, account_id stays. tenant_id is added alongside. Reads
-- can begin filtering by tenant_id (canonical) while writes stamp both
-- columns. A later cleanup will deprecate account_id.
--
-- Backfill
-- --------
-- Beacon is single-tenant-dogfeed today. Every existing row backfills to
-- 'tenant-ritz-founder' (the founder tenant id resolved by
-- currentTenantId() in non-test contexts). Multi-tenant onboarding for
-- customer #2 will use a per-row backfill keyed off the source.
--
-- ============================================================================

BEGIN;

-- ─── Category B: attribution_decisions ────────────────────────────────────

ALTER TABLE "public"."attribution_decisions"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."attribution_decisions"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."attribution_decisions"
  ADD CONSTRAINT "attribution_decisions_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "attribution_decisions_tenant_id_idx"
  ON "public"."attribution_decisions" ("tenant_id");

COMMENT ON COLUMN "public"."attribution_decisions"."tenant_id" IS
  'RLS Phase 1 Stage B (2026-05-09) — additive tenant_id. Backfilled from single-tenant founder.';

-- ─── Category B: candidate_links ──────────────────────────────────────────

ALTER TABLE "public"."candidate_links"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."candidate_links"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."candidate_links"
  ADD CONSTRAINT "candidate_links_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "candidate_links_tenant_id_idx"
  ON "public"."candidate_links" ("tenant_id");

COMMENT ON COLUMN "public"."candidate_links"."tenant_id" IS
  'RLS Phase 1 Stage B (2026-05-09) — additive tenant_id. Backfilled from single-tenant founder.';

-- ─── Category B: competitor_config ────────────────────────────────────────

ALTER TABLE "public"."competitor_config"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."competitor_config"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."competitor_config"
  ADD CONSTRAINT "competitor_config_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "competitor_config_tenant_id_idx"
  ON "public"."competitor_config" ("tenant_id");

COMMENT ON COLUMN "public"."competitor_config"."tenant_id" IS
  'RLS Phase 1 Stage B (2026-05-09) — additive tenant_id. Backfilled from single-tenant founder.';

-- ─── Category B: competitors ──────────────────────────────────────────────

ALTER TABLE "public"."competitors"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."competitors"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."competitors"
  ADD CONSTRAINT "competitors_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "competitors_tenant_id_idx"
  ON "public"."competitors" ("tenant_id");

COMMENT ON COLUMN "public"."competitors"."tenant_id" IS
  'RLS Phase 1 Stage B (2026-05-09) — additive tenant_id. Backfilled from single-tenant founder.';

-- ─── Category B: opportunities ────────────────────────────────────────────

ALTER TABLE "public"."opportunities"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."opportunities"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."opportunities"
  ADD CONSTRAINT "opportunities_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "opportunities_tenant_id_idx"
  ON "public"."opportunities" ("tenant_id");

COMMENT ON COLUMN "public"."opportunities"."tenant_id" IS
  'RLS Phase 1 Stage B (2026-05-09) — additive tenant_id. Backfilled from single-tenant founder.';

-- ─── Category B: page_issues ──────────────────────────────────────────────

ALTER TABLE "public"."page_issues"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."page_issues"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."page_issues"
  ADD CONSTRAINT "page_issues_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "page_issues_tenant_id_idx"
  ON "public"."page_issues" ("tenant_id");

COMMENT ON COLUMN "public"."page_issues"."tenant_id" IS
  'RLS Phase 1 Stage B (2026-05-09) — additive tenant_id. Backfilled from single-tenant founder.';

-- ─── Category B: page_visibility ──────────────────────────────────────────

ALTER TABLE "public"."page_visibility"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."page_visibility"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."page_visibility"
  ADD CONSTRAINT "page_visibility_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "page_visibility_tenant_id_idx"
  ON "public"."page_visibility" ("tenant_id");

COMMENT ON COLUMN "public"."page_visibility"."tenant_id" IS
  'RLS Phase 1 Stage B (2026-05-09) — additive tenant_id. Backfilled from single-tenant founder.';

-- ─── Category C: change_contracts (additive — keeps account_id) ───────────

ALTER TABLE "public"."change_contracts"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."change_contracts"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."change_contracts"
  ADD CONSTRAINT "change_contracts_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "change_contracts_tenant_id_idx"
  ON "public"."change_contracts" ("tenant_id");

COMMENT ON COLUMN "public"."change_contracts"."tenant_id" IS
  'RLS Phase 1 Stage B/C (2026-05-09) — additive tenant_id; account_id retained for compatibility. Cleanup in a later phase.';

-- ─── Category C: tracked_prompts (additive — keeps account_id) ────────────

ALTER TABLE "public"."tracked_prompts"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."tracked_prompts"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."tracked_prompts"
  ADD CONSTRAINT "tracked_prompts_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "tracked_prompts_tenant_id_idx"
  ON "public"."tracked_prompts" ("tenant_id");

COMMENT ON COLUMN "public"."tracked_prompts"."tenant_id" IS
  'RLS Phase 1 Stage B/C (2026-05-09) — additive tenant_id; account_id retained for compatibility. Cleanup in a later phase.';

-- ─── Category C: tracked_entities (additive — keeps account_id) ───────────

ALTER TABLE "public"."tracked_entities"
  ADD COLUMN IF NOT EXISTS "tenant_id" text DEFAULT '' NOT NULL;

UPDATE "public"."tracked_entities"
  SET "tenant_id" = 'tenant-ritz-founder'
  WHERE "tenant_id" = '';

ALTER TABLE "public"."tracked_entities"
  ADD CONSTRAINT "tracked_entities_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

CREATE INDEX IF NOT EXISTS "tracked_entities_tenant_id_idx"
  ON "public"."tracked_entities" ("tenant_id");

COMMENT ON COLUMN "public"."tracked_entities"."tenant_id" IS
  'RLS Phase 1 Stage B/C (2026-05-09) — additive tenant_id; account_id retained for compatibility. Cleanup in a later phase.';

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   ALTER TABLE "public"."attribution_decisions" DROP CONSTRAINT IF EXISTS "attribution_decisions_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."attribution_decisions_tenant_id_idx";
--   ALTER TABLE "public"."attribution_decisions" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."candidate_links" DROP CONSTRAINT IF EXISTS "candidate_links_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."candidate_links_tenant_id_idx";
--   ALTER TABLE "public"."candidate_links" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."competitor_config" DROP CONSTRAINT IF EXISTS "competitor_config_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."competitor_config_tenant_id_idx";
--   ALTER TABLE "public"."competitor_config" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."competitors" DROP CONSTRAINT IF EXISTS "competitors_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."competitors_tenant_id_idx";
--   ALTER TABLE "public"."competitors" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."opportunities" DROP CONSTRAINT IF EXISTS "opportunities_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."opportunities_tenant_id_idx";
--   ALTER TABLE "public"."opportunities" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."page_issues" DROP CONSTRAINT IF EXISTS "page_issues_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."page_issues_tenant_id_idx";
--   ALTER TABLE "public"."page_issues" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."page_visibility" DROP CONSTRAINT IF EXISTS "page_visibility_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."page_visibility_tenant_id_idx";
--   ALTER TABLE "public"."page_visibility" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."change_contracts" DROP CONSTRAINT IF EXISTS "change_contracts_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."change_contracts_tenant_id_idx";
--   ALTER TABLE "public"."change_contracts" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."tracked_prompts" DROP CONSTRAINT IF EXISTS "tracked_prompts_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."tracked_prompts_tenant_id_idx";
--   ALTER TABLE "public"."tracked_prompts" DROP COLUMN IF EXISTS "tenant_id";
--
--   ALTER TABLE "public"."tracked_entities" DROP CONSTRAINT IF EXISTS "tracked_entities_tenant_id_nonempty_chk";
--   DROP INDEX IF EXISTS "public"."tracked_entities_tenant_id_idx";
--   ALTER TABLE "public"."tracked_entities" DROP COLUMN IF EXISTS "tenant_id";
-- COMMIT;
-- ============================================================================
