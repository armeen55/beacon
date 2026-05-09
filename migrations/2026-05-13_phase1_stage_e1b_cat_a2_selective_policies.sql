-- ============================================================================
-- Migration: 2026-05-13_phase1_stage_e1b_cat_a2_selective_policies.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via `supabase db query --linked` only after
--            (a) E0 + E0.1 + E1.A have held overnight,
--            (b) the 07:00 / 07:45 UTC poll + canary cron runs are green,
--            (c) operator gives explicit go-ahead.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 1 Stage E1.B — selective tenant policies (Cat-A2)
-- Plan:      docs/RLS_PHASE_1_PLAN_2026_05_08.md
-- Depends:   migrations/2026-05-11_phase1_stage_e0_tenant_member_helper.sql
--            migrations/2026-05-12_phase1_stage_e0_1_revoke_anon_execute_is_tenant_member.sql
--            migrations/2026-05-12_phase1_stage_e1a_cat_a1_selective_policies.sql
-- ============================================================================
--
-- Purpose
-- -------
-- Structural clone of Stage E1.A, applied to the 12 Cat-A2 tables that
-- still hold `deny_authenticated`. Replace each blanket deny with a
-- tenant-membership-scoped `tenant_authenticated_rw` policy keyed off
-- `public.is_tenant_member(tenant_id)`.
--
-- Cat-A2 tables targeted by this migration (12)
-- ---------------------------------------------
--   • change_outcomes
--   • daily_metric_snapshots
--   • guardrail_alerts
--   • llm_rejections
--   • observation_runs
--   • page_element_inventory
--   • page_snapshots
--   • pages
--   • prompt_answer_observations
--   • raw_poll_chunks
--   • recommended_edits
--   • url_change_outcomes
--
-- Cat-A2 table explicitly EXCLUDED (1)
-- ------------------------------------
--   • tenant_members — special-cased per
--     docs/RLS_PHASE_1_PLAN_2026_05_08.md:64,188. tenant_members is the
--     resolution table for the helper itself; it has no
--     `deny_authenticated` to drop today (its policies are
--     `deny_anon` + `members_self_read`). A future bundle (Stage E1.C
--     or a dedicated tenant_members policy refresh) will revisit it.
--
-- Pre-apply assumptions verified against production at draft time
-- ---------------------------------------------------------------
--   • Each of the 12 tables has `tenant_id text NOT NULL`.
--   • Each of the 12 tables currently holds exactly the 2 policies
--     `deny_anon` + `deny_authenticated`.
--   • Total `public.pg_policies` row count is 72 immediately
--     pre-apply.
--   • `public.is_tenant_member(text)` exists, is SECURITY DEFINER
--     STABLE with pinned search_path, and has EXECUTE granted only
--     to authenticated, postgres, service_role (anon was revoked
--     in Stage E0.1).
--
-- Net effect on policy count
-- --------------------------
-- For each of the 12 tables: +1 (tenant_authenticated_rw)
--                            −1 (deny_authenticated)
--                            = 0 net change per table.
-- Net for the migration: +12 / −12 / 0 delta.
-- Total policy count post-apply: 72 (unchanged).
-- deny_anon UNTOUCHED on every table → anon stays denied.
--
-- Runtime effect
-- --------------
-- Service-role bypasses RLS — so this migration has ZERO effect on
-- app traffic today. This is the exact same risk profile as Stage
-- E1.A (which has held cleanly).
--
-- Note on Cat-A2 missing CHECK constraint
-- ---------------------------------------
-- Per the plan, the 12 Cat-A2 tables do NOT yet have
-- `tenant_id_nonempty_chk`. The Stage E policies are still safe
-- because `tenant_id text NOT NULL` excludes nulls, and the helper
-- returns false for any tenant_id that no member matches —
-- including the empty string. An empty-string row is unreachable
-- via the new policy. This migration does NOT add the CHECK; that
-- is tracked separately as a Stage C-extension task.
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT touch deny_anon on any table.
--   • Does NOT touch tenant_members (or any other table outside the 12).
--   • Does NOT touch Cat-A1 tables (E1.A already covered them).
--   • Does NOT touch Cat-B / Cat-C / Cat-D tables.
--   • Does NOT enable, disable, or force RLS.
--   • Does NOT add or remove columns, constraints, or indexes.
--   • Does NOT modify any function or grant.
--   • Does NOT mutate any rows.
--
-- Rollback
-- --------
-- Commented block at the bottom: drop the 12 tenant_authenticated_rw
-- policies and re-create deny_authenticated on each.
--
-- ============================================================================

BEGIN;

-- ─── change_outcomes ──────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.change_outcomes
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.change_outcomes;

-- ─── daily_metric_snapshots ───────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.daily_metric_snapshots
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.daily_metric_snapshots;

-- ─── guardrail_alerts ─────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.guardrail_alerts
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.guardrail_alerts;

-- ─── llm_rejections ───────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.llm_rejections
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.llm_rejections;

-- ─── observation_runs ─────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.observation_runs
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.observation_runs;

-- ─── page_element_inventory ───────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.page_element_inventory
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.page_element_inventory;

-- ─── page_snapshots ───────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.page_snapshots
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.page_snapshots;

-- ─── pages ────────────────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.pages
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.pages;

-- ─── prompt_answer_observations ───────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.prompt_answer_observations
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.prompt_answer_observations;

-- ─── raw_poll_chunks ──────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.raw_poll_chunks
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.raw_poll_chunks;

-- ─── recommended_edits ────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.recommended_edits
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.recommended_edits;

-- ─── url_change_outcomes ──────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.url_change_outcomes
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.url_change_outcomes;

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   DROP POLICY "tenant_authenticated_rw" ON public.change_outcomes;
--   CREATE POLICY "deny_authenticated" ON public.change_outcomes
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.daily_metric_snapshots;
--   CREATE POLICY "deny_authenticated" ON public.daily_metric_snapshots
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.guardrail_alerts;
--   CREATE POLICY "deny_authenticated" ON public.guardrail_alerts
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.llm_rejections;
--   CREATE POLICY "deny_authenticated" ON public.llm_rejections
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.observation_runs;
--   CREATE POLICY "deny_authenticated" ON public.observation_runs
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.page_element_inventory;
--   CREATE POLICY "deny_authenticated" ON public.page_element_inventory
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.page_snapshots;
--   CREATE POLICY "deny_authenticated" ON public.page_snapshots
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.pages;
--   CREATE POLICY "deny_authenticated" ON public.pages
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.prompt_answer_observations;
--   CREATE POLICY "deny_authenticated" ON public.prompt_answer_observations
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.raw_poll_chunks;
--   CREATE POLICY "deny_authenticated" ON public.raw_poll_chunks
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.recommended_edits;
--   CREATE POLICY "deny_authenticated" ON public.recommended_edits
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.url_change_outcomes;
--   CREATE POLICY "deny_authenticated" ON public.url_change_outcomes
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
-- COMMIT;
-- ============================================================================
