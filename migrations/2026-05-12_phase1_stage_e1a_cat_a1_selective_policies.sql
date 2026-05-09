-- ============================================================================
-- Migration: 2026-05-12_phase1_stage_e1a_cat_a1_selective_policies.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via Supabase MCP / `supabase db query --linked`
--            after operator review. Do NOT push to production directly.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 1 Stage E1.A — selective tenant policies (Cat-A1)
-- Plan:      docs/RLS_PHASE_1_PLAN_2026_05_08.md
-- Depends:   migrations/2026-05-11_phase1_stage_e0_tenant_member_helper.sql
--            (helper public.is_tenant_member(text) must already exist)
-- ============================================================================
--
-- Purpose
-- -------
-- Replace the blanket `deny_authenticated` policy on the 5 Cat-A1 tables
-- with a tenant-membership-scoped `tenant_authenticated_rw` policy that
-- allows authenticated users to read/write rows whose `tenant_id` matches
-- a tenant they belong to (per public.tenant_members).
--
-- Cat-A1 tables (5)
-- -----------------
--   • changelog_entries
--   • import_runs
--   • recommendation_responses
--   • results
--   • scan_findings
--
-- Why these 5 first
-- -----------------
-- Cat-A1 is the smallest, lowest-risk slice: each table has a
-- non-nullable `tenant_id text` column with a CHECK (tenant_id <> '')
-- (validated in Stages B/C). They are tenant-scoped end-to-end in app
-- code today, and they have no FK fan-out into other policies.
-- Splitting the rest of Cat-A / Cat-B into later bundles keeps blast
-- radius small per apply.
--
-- Net effect on policy count
-- --------------------------
-- For each of the 5 tables: +1 (tenant_authenticated_rw)
--                           −1 (deny_authenticated)
--                           = 0 net change per table.
-- deny_anon is UNTOUCHED → anon callers continue to be denied entirely.
--
-- Runtime effect
-- --------------
-- Service-role (app server-side) bypasses RLS — so this migration has
-- ZERO effect on app traffic today. The policy only changes behavior
-- for clients connecting as `authenticated` (browser / supabase-js
-- without service-role key), which is not a path the app uses today.
-- This is the gating step that lets future client-side reads work
-- without service-role; the helper is dormant otherwise.
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT touch deny_anon on any table.
--   • Does NOT touch policies on any table outside the 5 Cat-A1 tables.
--   • Does NOT enable, disable, or force RLS on any table (Stage B
--     already FORCEd RLS on all tenant tables).
--   • Does NOT modify columns, constraints, indexes, or rows.
--   • Does NOT create or modify any function (E0 already shipped).
--
-- Rollback
-- --------
-- Commented block at the bottom: drop the tenant_authenticated_rw
-- policies and re-create deny_authenticated on each of the 5 tables.
--
-- ============================================================================

BEGIN;

-- ─── changelog_entries ────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.changelog_entries
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.changelog_entries;

-- ─── import_runs ──────────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.import_runs
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.import_runs;

-- ─── recommendation_responses ─────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.recommendation_responses
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.recommendation_responses;

-- ─── results ──────────────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.results
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.results;

-- ─── scan_findings ────────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.scan_findings
  AS PERMISSIVE
  FOR ALL
  TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.scan_findings;

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   DROP POLICY "tenant_authenticated_rw" ON public.changelog_entries;
--   CREATE POLICY "deny_authenticated" ON public.changelog_entries
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.import_runs;
--   CREATE POLICY "deny_authenticated" ON public.import_runs
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.recommendation_responses;
--   CREATE POLICY "deny_authenticated" ON public.recommendation_responses
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.results;
--   CREATE POLICY "deny_authenticated" ON public.results
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.scan_findings;
--   CREATE POLICY "deny_authenticated" ON public.scan_findings
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
-- COMMIT;
-- ============================================================================
