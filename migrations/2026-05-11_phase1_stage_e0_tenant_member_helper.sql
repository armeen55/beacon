-- ============================================================================
-- Migration: 2026-05-11_phase1_stage_e0_tenant_member_helper.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via Supabase MCP / `supabase db query --linked`
--            after operator review. Do NOT push to production directly.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     RLS Phase 1 Stage E0 — tenant-membership helper function
-- Plan:      docs/RLS_PHASE_1_PLAN_2026_05_08.md
-- Baseline:  migrations/2026-05-08_baseline_schema.sql (commit 11101a2)
-- ============================================================================
--
-- Purpose
-- -------
-- Adds a SQL helper function that lets RLS policies (Stage E1+) decide
-- whether the current authenticated user is a member of a given tenant.
-- This bundle ONLY adds the helper. NO table policies are touched. NO
-- deny_authenticated policy is removed. NO RLS state changes.
--
-- Why this is its own bundle
-- --------------------------
-- Stage E1 will use this helper inside USING/WITH CHECK clauses on the
-- 18 Cat-A and 7 Cat-B tables. Splitting it out:
--   • Lets the operator review the helper's contract and security
--     posture in isolation.
--   • Makes the helper apply-able well in advance of Stage E1 — it has
--     no runtime effect on existing reads/writes (service-role bypasses
--     RLS, deny_authenticated is still in force).
--   • Reduces blast radius: if Stage E1 ever needs to roll back, the
--     helper stays. The helper is a no-op until something references
--     it; rollback of the helper itself is a one-liner DROP.
--
-- Schema verification (read-only, against production at apply-prep time)
-- ---------------------------------------------------------------------
--   • tenant_members.user_id   = uuid    (FK auth.users.id ON DELETE CASCADE)
--   • tenant_members.tenant_id = text    (FK public.tenants.id ON DELETE CASCADE)
--   • tenants.id               = text
--   • auth.uid()               returns uuid (Supabase JWT claim helper)
--   • tenant_members PRIMARY KEY (user_id, tenant_id) — covers the
--     EXISTS lookup in the helper; NO new index needed.
--   • Existing tenant_members policies stay UNCHANGED:
--       - deny_anon         (anon role, USING false WITH CHECK false)
--       - members_self_read (authenticated role, FOR SELECT,
--                            USING user_id = auth.uid())
--
-- Helper contract
-- ---------------
-- Returns true iff the row (auth.uid(), target_tenant_id) exists in
-- public.tenant_members. Returns false on any other input — including
-- null target_tenant_id (Postgres treats null comparisons as null,
-- EXISTS returns false), and unauthenticated callers (auth.uid() is
-- null → no rows match).
--
-- Security posture
-- ----------------
--   • SECURITY DEFINER — runs with the function-owner's privileges so
--     the helper works regardless of how members_self_read evolves
--     in future bundles. The helper still pins authorization to
--     auth.uid() — never returns rows for a user other than the caller.
--   • SET search_path = public, pg_catalog — defeats the
--     search_path-based privilege-escalation pattern documented in the
--     Supabase RLS guide (caller cannot make the function resolve
--     `tenant_members` to a different schema's table).
--   • REVOKE ALL ... FROM PUBLIC — defaults are not enough on
--     Postgres; explicit revoke keeps the function callable only by
--     the roles we explicitly GRANT.
--   • GRANT EXECUTE ... TO authenticated — only logged-in users.
--     Anon (anonymous) callers cannot invoke. Service-role does not
--     need a grant — it bypasses RLS entirely (this helper is for
--     RLS clauses, not for service-role app code).
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT create, drop, or alter any table policy.
--   • Does NOT enable, disable, or force RLS on any table.
--   • Does NOT touch tenant_members policies (members_self_read +
--     deny_anon stay exactly as they are).
--   • Does NOT modify any tenant-scoped table (Cat-A / Cat-B).
--   • Does NOT mutate any rows (no INSERT/UPDATE/DELETE/TRUNCATE).
--   • Does NOT add or change indexes (existing PK is sufficient).
--
-- Rollback
-- --------
-- Single statement at the bottom (commented). Drops the helper +
-- removes the grants atomically.
--
-- ============================================================================

BEGIN;

-- ─── Helper function ──────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.is_tenant_member(target_tenant_id text)
  RETURNS boolean
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public, pg_catalog
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.tenant_members
    WHERE user_id = auth.uid()
      AND tenant_id = target_tenant_id
  );
$$;

COMMENT ON FUNCTION public.is_tenant_member(text) IS
  'RLS Phase 1 Stage E0 (2026-05-11). Returns true iff the calling '
  'authenticated user (auth.uid()) is a member of target_tenant_id '
  'per public.tenant_members. SECURITY DEFINER + pinned search_path '
  'so the function survives future tenant_members policy changes. '
  'Used by Stage E1+ tenant-scoped policies on Cat-A / Cat-B tables; '
  'unused by app runtime today (service-role bypasses RLS).';

-- ─── Grants ───────────────────────────────────────────────────────────────

-- Revoke broad defaults so PUBLIC cannot call.
REVOKE ALL ON FUNCTION public.is_tenant_member(text) FROM PUBLIC;

-- Authenticated users (logged-in via Supabase auth) can call. anon
-- and service_role do not get an explicit grant:
--   • anon — must never bypass tenant isolation; deny by default.
--   • service_role — bypasses RLS entirely; doesn't need this helper.
GRANT EXECUTE ON FUNCTION public.is_tenant_member(text) TO authenticated;

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   REVOKE EXECUTE ON FUNCTION public.is_tenant_member(text) FROM authenticated;
--   DROP FUNCTION IF EXISTS public.is_tenant_member(text);
-- COMMIT;
-- ============================================================================
