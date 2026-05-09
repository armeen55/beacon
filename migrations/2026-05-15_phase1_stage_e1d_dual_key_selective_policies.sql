-- ============================================================================
-- Migration: 2026-05-15_phase1_stage_e1d_dual_key_selective_policies.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via `supabase db query --linked` only after
--            (a) E1.C has held under at least one post-apply observation,
--            (b) operator gives explicit go-ahead.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 1 Stage E1.D — selective tenant policies (dual-key)
-- Plan:      docs/RLS_PHASE_1_PLAN_2026_05_08.md
-- Depends:   E0, E0.1, E1.A, E1.B, E1.C
-- ============================================================================
--
-- Purpose
-- -------
-- Apply the same `tenant_authenticated_rw` selective policy to the 3
-- dual-key tables. These tables gained `tenant_id text NOT NULL` in
-- Stage B and have a Stage-C nonempty CHECK; they ALSO retain a legacy
-- `account_id` column for backwards compatibility while readers
-- migrate. The policy keys off `tenant_id` only — `account_id` is
-- application data, not policy data. Reads were already canonicalized
-- to `.eq("tenant_id", tenantId)` in Stage B's repository pass.
--
-- Why this is a separate bundle from E1.C
-- ---------------------------------------
-- Cat-B (E1.C) and these 3 tables are structurally identical at the
-- policy level. They ship as separate migrations so the dual-key
-- tables — historically the source of subtle account_id-vs-tenant_id
-- divergence bugs in Beacon — get their own observation window. If
-- something goes wrong, blast radius is just these 3 tables, not
-- 10 mixed.
--
-- Dual-key tables targeted (3)
-- ----------------------------
--   • change_contracts
--   • tracked_entities
--   • tracked_prompts
--
-- Pre-apply assumptions verified against production at draft time
-- ---------------------------------------------------------------
--   • Each of the 3 tables has `tenant_id text NOT NULL` AND
--     `account_id` columns.
--   • Each of the 3 tables has a CHECK constraint mentioning
--     tenant_id (Stage C nonempty CHECK).
--   • Each of the 3 tables currently holds exactly the 2 policies
--     `deny_anon` + `deny_authenticated`.
--   • Total `public.pg_policies` row count immediately pre-apply is
--     72 (assuming E1.C has not yet been applied) or unchanged from
--     the 72-after-E1.C state if E1.C lands first — net delta 0
--     either way.
--   • `public.is_tenant_member(text)` exists, SECURITY DEFINER
--     STABLE with pinned search_path. EXECUTE granted to
--     authenticated, postgres, service_role; anon revoked in E0.1.
--
-- Net effect on policy count
-- --------------------------
-- For each of the 3 tables: +1 (tenant_authenticated_rw)
--                           −1 (deny_authenticated)
--                           = 0 net change per table.
-- Net for the migration: +3 / −3 / 0 delta.
-- deny_anon UNTOUCHED → anon stays denied.
--
-- Runtime effect
-- --------------
-- Service-role bypasses RLS — zero effect on app traffic. Same risk
-- profile as E1.A / E1.B / (drafted) E1.C.
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT drop, rename, or modify `account_id` on any table.
--     The legacy column stays exactly as-is. Whether and when to
--     retire account_id is a separate decision tracked elsewhere.
--   • Does NOT touch deny_anon on any table.
--   • Does NOT touch Cat-A1 (E1.A), Cat-A2 (E1.B), or Cat-B (E1.C
--     drafted) tables.
--   • Does NOT touch tenant_members.
--   • Does NOT touch global / singleton / FK-chained / meta tables —
--     business_config, citation_evidence_index, answer_intelligence_index,
--     change_patterns, confidence_calibration, triage_rules,
--     answer_texts, tenants. Those need different treatment.
--   • Does NOT enable, disable, or force RLS.
--   • Does NOT add or remove columns, constraints, or indexes.
--   • Does NOT modify any function or grant.
--   • Does NOT mutate any rows.
--
-- Rollback
-- --------
-- Commented block at the bottom: drop the 3 tenant_authenticated_rw
-- policies and re-create deny_authenticated on each.
--
-- ============================================================================

BEGIN;

-- ─── change_contracts ─────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.change_contracts
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.change_contracts;

-- ─── tracked_entities ─────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.tracked_entities
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.tracked_entities;

-- ─── tracked_prompts ──────────────────────────────────────────────────────

CREATE POLICY "tenant_authenticated_rw" ON public.tracked_prompts
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.tracked_prompts;

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   DROP POLICY "tenant_authenticated_rw" ON public.change_contracts;
--   CREATE POLICY "deny_authenticated" ON public.change_contracts
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.tracked_entities;
--   CREATE POLICY "deny_authenticated" ON public.tracked_entities
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
--
--   DROP POLICY "tenant_authenticated_rw" ON public.tracked_prompts;
--   CREATE POLICY "deny_authenticated" ON public.tracked_prompts
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
-- COMMIT;
-- ============================================================================
