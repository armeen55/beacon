-- ============================================================================
-- Migration: 2026-05-18_phase3_stage_d3a_answer_intel_rls.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via `supabase db query --linked --file ...`
--            ONLY AFTER:
--              (a) the D3.A schema migration
--                  `2026-05-17_phase3_stage_d3a_answer_intel_per_tenant_schema.sql`
--                  has been applied AND has held under at least one rebuild
--                  cycle (post-import or post-poll workflow), AND
--              (b) operator gives explicit go-ahead.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Phase 3 Stage D3.A — answer_intelligence_index RLS refresh
-- Plan:      docs/D3_SINGLETON_PER_TENANT_PLAN_2026_05_09.md
-- Depends:
--   • D3.A schema migration (provides tenant_id NOT NULL + (tenant_id, id) PK)
--   • E0 helper public.is_tenant_member(text)
-- ============================================================================
--
-- Purpose
-- -------
-- Switch `answer_intelligence_index` from the blanket `deny_authenticated`
-- policy to the selective `tenant_authenticated_rw` policy keyed off
-- `public.is_tenant_member(tenant_id)`. Same shape as E1.A/B/C/D, but
-- ships AFTER the schema migration so the policy has a `tenant_id`
-- column to reference.
--
-- Why this is its own bundle (not bundled with the schema migration)
-- ------------------------------------------------------------------
-- Bundling schema + RLS in one transaction would:
--   • combine two distinct rollback shapes (DDL revert + policy revert),
--   • make a bisect ambiguous if anything goes wrong,
--   • execute the policy creation against a brand-new column in the
--     same transaction it was added — fine in principle, but the
--     bake-then-RLS rhythm has been the safe pattern through E1.A/B/C/D.
--
-- Splitting matches the staged discipline used through Phase 1 Stage E.
--
-- Pre-apply assumptions
-- ---------------------
-- (Verified at draft time against production; these will hold after the
--  schema migration applies cleanly.)
--   • answer_intelligence_index has `tenant_id text NOT NULL` with
--     a nonempty CHECK constraint.
--   • Primary key is `(tenant_id, id)`.
--   • Current policies (after schema migration but before this one) are
--     `{deny_anon, deny_authenticated}` — schema migration did NOT
--     touch RLS.
--   • Existing row(s) all have non-empty tenant_id (backfilled to
--     `tenant-ritz-founder` by the schema migration).
--   • `public.is_tenant_member(text)` exists, is SECURITY DEFINER
--     STABLE with pinned search_path; EXECUTE granted to
--     authenticated, postgres, service_role; anon revoked (E0.1).
--
-- Net effect on policy count
-- --------------------------
--   +1 (tenant_authenticated_rw)
--   −1 (deny_authenticated)
--   = 0 net change.
-- deny_anon UNTOUCHED → anon stays denied.
--
-- Runtime effect
-- --------------
-- Service-role bypasses RLS — zero effect on app traffic. The disk-side
-- reader at `src/domains/answer-intelligence/store.ts` does not touch
-- Supabase, so neither this nor the schema migration affects the live
-- read path. Same risk profile as E1.A/B/C/D, all of which held cleanly.
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT touch deny_anon on this or any other table.
--   • Does NOT touch tenant_members.
--   • Does NOT touch business_config, citation_evidence_index,
--     answer_texts, tenants, change_patterns, confidence_calibration,
--     triage_rules — those are out-of-scope per
--     docs/BEACON_NEXT_IDEAS_TRUTH_CHECK_2026_05_09.md (D2/D3.B/D3.C/D4).
--   • Does NOT touch Cat-A1, Cat-A2, Cat-B, or dual-key tables —
--     E1.A/B/C/D already covered them.
--   • Does NOT alter columns, primary keys, indexes, or constraints.
--   • Does NOT modify any function or grant.
--   • Does NOT mutate any rows.
--   • Does NOT enable, disable, or force RLS — those flags were set
--     long before by Phase 1 Stage A.
--
-- Rollback
-- --------
-- Commented block at the bottom: drop the new policy and re-create
-- deny_authenticated. The schema migration's rollback is a separate
-- one-step revert; rollback ordering is RLS first, then schema.
--
-- ============================================================================

BEGIN;

CREATE POLICY "tenant_authenticated_rw" ON public.answer_intelligence_index
  AS PERMISSIVE FOR ALL TO authenticated
  USING      (public.is_tenant_member(tenant_id))
  WITH CHECK (public.is_tenant_member(tenant_id));

DROP POLICY "deny_authenticated" ON public.answer_intelligence_index;

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   DROP POLICY "tenant_authenticated_rw" ON public.answer_intelligence_index;
--   CREATE POLICY "deny_authenticated" ON public.answer_intelligence_index
--     AS PERMISSIVE FOR ALL TO authenticated USING (false) WITH CHECK (false);
-- COMMIT;
-- ============================================================================
