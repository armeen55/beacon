-- ============================================================================
-- Migration: 2026-05-10_phase1_stage_c_tenant_id_nonempty_checks.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via Supabase MCP after operator review.
--            Do NOT supabase db push to production directly.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 1 Stage C — extend tenant_id_nonempty CHECK to
--            remaining Cat-A2 tables.
-- Plan:      docs/RLS_PHASE_1_PLAN_2026_05_08.md
-- Baseline:  migrations/2026-05-08_baseline_schema.sql (commit 11101a2)
-- Stage B:   migrations/2026-05-09_phase1_stage_b_c_tenant_id_repair.sql
--            (commit 00c9550, pushed to origin/main)
-- ============================================================================
--
-- Purpose
-- -------
-- Lock the tenant_id-nonempty contract on the 9 Cat-A2 tables that have
-- tenant_id populated but no CHECK constraint preventing future empty-string
-- writes. After this migration, every tenant-scoped public table that the
-- app writes to has a CHECK preventing empty/null tenant_id.
--
-- This migration adds CHECK constraints only. It does NOT:
--   • change any RLS policy
--   • enable / disable / force RLS on any table
--   • drop or rename any column (account_id, tenant_id, anything)
--   • mutate row data (no INSERT, UPDATE, DELETE)
--   • change app behavior
--
-- Production posture remains: service-role bypasses RLS for all app paths;
-- deny_anon + deny_authenticated policies stay as defense-in-depth. Stage E
-- will refine the deny_authenticated policies; Stage D handles the
-- `tenant_id: ""` placeholder repair across the app code; Stage C just
-- locks the schema constraint.
--
-- Scope discovery (2026-05-10)
-- ----------------------------
-- The Stage B inspection inferred 13 Cat-A2 tables would need this CHECK.
-- Production already has tenant_id_nonempty CHECK constraints on 3 of those
-- 13, just under a different name suffix (no `_chk`):
--
--   daily_metric_snapshots         daily_metric_snapshots_tenant_id_nonempty
--   prompt_answer_observations     prompt_answer_observations_tenant_id_nonempty
--   recommended_edits              recommended_edits_tenant_id_nonempty
--
-- Functionally identical predicate. Different name suffix only. Renaming
-- to add `_chk` would require DROP CONSTRAINT and is out of scope; this
-- migration leaves them as-is.
--
-- Stage C therefore adds CHECK constraints to the remaining 9 tables:
--
--   change_outcomes
--   guardrail_alerts
--   llm_rejections
--   observation_runs
--   page_element_inventory
--   page_snapshots
--   pages
--   raw_poll_chunks
--   url_change_outcomes
--
-- (Plus 3 already-constrained tables are not touched: see the list above.
-- That brings every Cat-A2 table to "has a tenant_id-nonempty CHECK".)
--
-- Excluded from Stage C entirely: tenant_members. Its tenant_id column is
-- already `text NOT NULL` with a foreign key to tenants(id) — the CHECK
-- would be redundant. The plan calls this out explicitly.
--
-- Preflight
-- ---------
-- The DO block at the top fails loud if any of the 12 target tables (the
-- 9 to-be-constrained + the 3 already-constrained — all 12 should be
-- clean) contains a row with NULL or empty tenant_id. This guards against
-- the constraint failing on existing rows. If preflight fails, NO
-- constraint is added and the operator must investigate the row(s).
--
-- Reversibility
-- -------------
-- The rollback block at the bottom drops only the 9 constraints this
-- migration adds. Pre-existing constraints are not touched.
--
-- ============================================================================

BEGIN;

-- ─── Preflight: every target table must have clean tenant_id ─────────────
DO $$
DECLARE
  bad_count bigint;
BEGIN
  -- Check all 12 Cat-A2 tables (the 9 to be constrained + the 3 already
  -- constrained — pre-existing constraints should make the 3 always clean,
  -- but we re-check to surface any anomaly before adding new constraints).
  SELECT
    (SELECT count(*) FROM "public"."change_outcomes"            WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."daily_metric_snapshots"     WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."guardrail_alerts"           WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."llm_rejections"             WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."observation_runs"           WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."page_element_inventory"     WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."page_snapshots"             WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."pages"                      WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."prompt_answer_observations" WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."raw_poll_chunks"            WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."recommended_edits"          WHERE "tenant_id" IS NULL OR "tenant_id" = '') +
    (SELECT count(*) FROM "public"."url_change_outcomes"        WHERE "tenant_id" IS NULL OR "tenant_id" = '')
  INTO bad_count;

  IF bad_count > 0 THEN
    RAISE EXCEPTION
      'Stage C preflight FAILED: % row(s) across the 12 Cat-A2 tables have NULL or empty tenant_id. Investigate before applying this migration. Run a per-table SELECT to identify the offending rows.',
      bad_count;
  END IF;

  RAISE NOTICE 'Stage C preflight passed: 0 rows with NULL/empty tenant_id across 12 Cat-A2 tables.';
END $$;

-- ─── change_outcomes ─────────────────────────────────────────────────────

ALTER TABLE "public"."change_outcomes"
  ADD CONSTRAINT "change_outcomes_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "change_outcomes_tenant_id_nonempty_chk"
  ON "public"."change_outcomes"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

-- ─── guardrail_alerts ────────────────────────────────────────────────────

ALTER TABLE "public"."guardrail_alerts"
  ADD CONSTRAINT "guardrail_alerts_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "guardrail_alerts_tenant_id_nonempty_chk"
  ON "public"."guardrail_alerts"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

-- ─── llm_rejections ──────────────────────────────────────────────────────

ALTER TABLE "public"."llm_rejections"
  ADD CONSTRAINT "llm_rejections_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "llm_rejections_tenant_id_nonempty_chk"
  ON "public"."llm_rejections"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

-- ─── observation_runs ────────────────────────────────────────────────────

ALTER TABLE "public"."observation_runs"
  ADD CONSTRAINT "observation_runs_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "observation_runs_tenant_id_nonempty_chk"
  ON "public"."observation_runs"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

-- ─── page_element_inventory ──────────────────────────────────────────────

ALTER TABLE "public"."page_element_inventory"
  ADD CONSTRAINT "page_element_inventory_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "page_element_inventory_tenant_id_nonempty_chk"
  ON "public"."page_element_inventory"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

-- ─── page_snapshots ──────────────────────────────────────────────────────

ALTER TABLE "public"."page_snapshots"
  ADD CONSTRAINT "page_snapshots_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "page_snapshots_tenant_id_nonempty_chk"
  ON "public"."page_snapshots"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

-- ─── pages ───────────────────────────────────────────────────────────────

ALTER TABLE "public"."pages"
  ADD CONSTRAINT "pages_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "pages_tenant_id_nonempty_chk"
  ON "public"."pages"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

-- ─── raw_poll_chunks ─────────────────────────────────────────────────────

ALTER TABLE "public"."raw_poll_chunks"
  ADD CONSTRAINT "raw_poll_chunks_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "raw_poll_chunks_tenant_id_nonempty_chk"
  ON "public"."raw_poll_chunks"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

-- ─── url_change_outcomes ─────────────────────────────────────────────────

ALTER TABLE "public"."url_change_outcomes"
  ADD CONSTRAINT "url_change_outcomes_tenant_id_nonempty_chk"
    CHECK ("tenant_id" IS NOT NULL AND "tenant_id" <> '');

COMMENT ON CONSTRAINT "url_change_outcomes_tenant_id_nonempty_chk"
  ON "public"."url_change_outcomes"
  IS 'Stage C (2026-05-10) — prevents future empty/null tenant_id writes.';

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- Drops ONLY the 9 constraints this migration adds. Pre-existing constraints
-- on daily_metric_snapshots, prompt_answer_observations, recommended_edits
-- are untouched here and untouched on rollback.
--
-- BEGIN;
--   ALTER TABLE "public"."change_outcomes"        DROP CONSTRAINT IF EXISTS "change_outcomes_tenant_id_nonempty_chk";
--   ALTER TABLE "public"."guardrail_alerts"       DROP CONSTRAINT IF EXISTS "guardrail_alerts_tenant_id_nonempty_chk";
--   ALTER TABLE "public"."llm_rejections"         DROP CONSTRAINT IF EXISTS "llm_rejections_tenant_id_nonempty_chk";
--   ALTER TABLE "public"."observation_runs"       DROP CONSTRAINT IF EXISTS "observation_runs_tenant_id_nonempty_chk";
--   ALTER TABLE "public"."page_element_inventory" DROP CONSTRAINT IF EXISTS "page_element_inventory_tenant_id_nonempty_chk";
--   ALTER TABLE "public"."page_snapshots"         DROP CONSTRAINT IF EXISTS "page_snapshots_tenant_id_nonempty_chk";
--   ALTER TABLE "public"."pages"                  DROP CONSTRAINT IF EXISTS "pages_tenant_id_nonempty_chk";
--   ALTER TABLE "public"."raw_poll_chunks"        DROP CONSTRAINT IF EXISTS "raw_poll_chunks_tenant_id_nonempty_chk";
--   ALTER TABLE "public"."url_change_outcomes"    DROP CONSTRAINT IF EXISTS "url_change_outcomes_tenant_id_nonempty_chk";
-- COMMIT;
-- ============================================================================
