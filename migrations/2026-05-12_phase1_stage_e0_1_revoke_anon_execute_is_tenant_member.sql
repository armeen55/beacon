-- ============================================================================
-- Migration: 2026-05-12_phase1_stage_e0_1_revoke_anon_execute_is_tenant_member.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via `supabase db query --linked` after review.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 1 Stage E0.1 — defense-in-depth grant cleanup
-- Plan:      docs/RLS_PHASE_1_PLAN_2026_05_08.md
-- Depends:   migrations/2026-05-11_phase1_stage_e0_tenant_member_helper.sql
-- ============================================================================
--
-- Purpose
-- -------
-- Stage E0 created public.is_tenant_member(text) and ran:
--     REVOKE ALL ON FUNCTION ... FROM PUBLIC;
--     GRANT EXECUTE ON FUNCTION ... TO authenticated;
-- Live verification showed Supabase project-level default privileges
-- still granted EXECUTE to anon (and service_role, postgres). The helper
-- is functionally safe under anon (auth.uid() is null → EXISTS false),
-- but the helper's stated contract is "authenticated only" and we want
-- the grant table to match.
--
-- This migration removes the anon grant only. service_role and postgres
-- keep EXECUTE — service_role bypasses RLS and may legitimately call
-- the helper from server contexts; postgres is the function owner.
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT touch any table policy.
--   • Does NOT touch any RLS state.
--   • Does NOT modify the function body, owner, or security posture.
--   • Does NOT revoke from authenticated, service_role, or postgres.
--   • Does NOT mutate any rows.
--
-- Rollback
-- --------
-- Single statement at the bottom (commented). Re-grants anon EXECUTE.
--
-- ============================================================================

BEGIN;

REVOKE EXECUTE ON FUNCTION public.is_tenant_member(text) FROM anon;

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   GRANT EXECUTE ON FUNCTION public.is_tenant_member(text) TO anon;
-- COMMIT;
-- ============================================================================
