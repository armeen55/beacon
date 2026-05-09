-- ============================================================================
-- Migration: 2026-05-14_phase1_stage_e1c_cat_b_selective_policies.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via `supabase db query --linked` only after
--            (a) E1.B has held under at least one post-apply scheduled scan,
--            (b) operator gives explicit go-ahead.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 1 Stage E1.C — selective tenant policies (Cat-B)
-- Plan:      docs/RLS_PHASE_1_PLAN_2026_05_08.md
-- Depends:   migrations/2026-05-11_phase1_stage_e0_tenant_member_helper.sql
--            migrations/2026-05-12_phase1_stage_e0_1_revoke_anon_execute_is_tenant_member.sql
--            migrations/2026-05-12_phase1_stage_e1a_cat_a1_selective_policies.sql
--            migrations/2026-05-13_phase1_stage_e1b_cat_a2_selective_policies.sql
-- ============================================================================
--
-- Purpose
-- -------
-- Structural clone of Stages E1.A / E1.B applied to the 7 Cat-B tables
-- that gained `tenant_id` in Stage B. Replace each blanket
-- `deny_authenticated` with a tenant-membership-scoped
-- `tenant_authenticated_rw` policy keyed off
-- `public.is_tenant_member(tenant_id)`.
--
-- Cat-B tables targeted by this migration (7)
-- -------------------------------------------
--   • attribution_decisions
--   • candidate_links
--   • competitor_config
--   • competitors
--   • opportunities
--   • page_issues
--   • page_visibility
--
-- Pre-apply assumptions verified against production at draft time
-- ---------------------------------------------------------------
--   • Each of the 7 tables has `tenant_id text NOT NULL`.
--   • Each of the 7 tables has a CHECK constraint mentioning tenant_id
--     (Stage C `tenant_id_nonempty_chk`).
--   • Each of the 7 tables currently holds exactly the 2 policies
--     `deny_anon` + `deny_authenticated`.
--   • Total `public.pg_policies` row count is 72 immediately
--     pre-apply.
--   • `public.is_tenant_member(text)` exists, is SECURITY DEFINER
--     STABLE with pinned search_path, and EXECUTE is granted only to
--     authenticated, postgres, service_role (anon revoked in E0.1).
--
-- Net effect on policy count
-- --------------------------
-- For each of the 7 tables: +1 (tenant_authenticated_rw)
--                           −1 (deny_authenticated)
--                           = 0 net change per table.
-- Net for the migration: +7 / −7 / 0 delta.
-- Total policy count post-apply: 72 (unchanged).
-- deny_anon UNTOUCHED on every table → anon stays denied.
--
-- Runtime effect
-- --------------
-- Service-role bypasses RLS — so this migration has ZERO effect on
-- app traffic today. Same risk profile as E1.A and E1.B, both of
-- which have held cleanly.
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT touch deny_anon on any table.
--   • Does NOT touch tenant_members.
--   • Does NOT touch Cat-A1 tables (E1.A already covered them).
--   • Does NOT touch Cat-A2 tables (E1.B already covered them).
--   • Does NOT touch the 3 dual-key tables — change_contracts,
--     tracked_entities, tracked_prompts — those land in a separate
--     bundle (Stage E1.D) so account_id-vs-tenant_id divergence has
--     its own observation window.
--   • Does NOT touch global / singleton / FK-chained / meta tables —
--     business_config, citation_evidence_index, answer_intelligence_index,
--     change_patterns, confidence_calibration, triage_rules,
--     answer_texts, tenants. Those need different treatment per the
--     plan (D2 join policy / D3 singleton-per-tenant migration / D4
--     stay shared) and are explicitly out of scope here.
--   • Does NOT enable, disable, or force RLS.
--   • Does NOT add or remove columns, constraints, or indexes.
--   • Does NOT modify any function or grant.
--   • Does NOT mutate any rows.
--
-- Rollback
-- --------
-- Commented block at the bottom: drop the 7 tenant_authenticated_rw
-- policies and re-create deny_authenticated on each.
--
-- ============================================================================

BEGIN;

-- ─── attribution_decisions ────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.attribution_decisions
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.attribution_decisions;

-- ─── candidate_links ──────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.candidate_links
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.candidate_links;

-- ─── competitor_config ────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.competitor_config
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.competitor_config;

-- ─── competitors ──────────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.competitors
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.competitors;

-- ─── opportunities ────────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.opportunities
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.opportunities;

-- ─── page_issues ──────────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.page_issues
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.page_issues;

-- ─── page_visibility ──────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.page_visibility
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.page_visibility;

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   DROP POLICY "tenant_authenticated_rw" ON public.attribution_decisions;
--   CREATE POLICY "deny_authenticated" ON public.attribution_decisions
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.candidate_links;
--   CREATE POLICY "deny_authenticated" ON public.candidate_links
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.competitor_config;
--   CREATE POLICY "deny_authenticated" ON public.competitor_config
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.competitors;
--   CREATE POLICY "deny_authenticated" ON public.competitors
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.opportunities;
--   CREATE POLICY "deny_authenticated" ON public.opportunities
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.page_issues;
--   CREATE POLICY "deny_authenticated" ON public.page_issues
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.page_visibility;
--   CREATE POLICY "deny_authenticated" ON public.page_visibility
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
-- COMMIT;
-- ============================================================================
