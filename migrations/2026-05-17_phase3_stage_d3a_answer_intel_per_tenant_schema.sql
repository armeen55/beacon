-- ============================================================================
-- Migration: 2026-05-17_phase3_stage_d3a_answer_intel_per_tenant_schema.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   NOT APPLIED — apply via `supabase db query --linked --file ...`
--            after operator review AND after the budget-ledger verifier
--            confirms the next paid poll's dual-write is clean.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Phase 3 Stage D3.A — answer_intelligence_index per-tenant schema
-- Plan:      docs/D3_SINGLETON_PER_TENANT_PLAN_2026_05_09.md
-- Depends:   E0 helper public.is_tenant_member(text) already applied (used
--            by the companion RLS migration that lands AFTER this one).
-- ============================================================================
--
-- Purpose
-- -------
-- Convert the deployment-singleton table `answer_intelligence_index`
-- (1 row, id='current', no tenant_id) into a per-tenant table by adding
-- `tenant_id text NOT NULL` and changing the primary key from `(id)` to
-- `(tenant_id, id)`. Schema-only — RLS is NOT changed in this migration.
-- A separate companion RLS migration drops `deny_authenticated` and
-- adds `tenant_authenticated_rw` once this schema change has held under
-- one rebuild cycle.
--
-- Why D3.A first
-- --------------
-- This is the smallest blast radius of the three D3 singletons:
--   • answer_intelligence_index — 9 caller references (this migration)
--   • citation_evidence_index   — 25 caller references (D3.B, later)
--   • business_config           — 36 caller references (D3.C, later)
-- Proves the migration shape end-to-end on the smallest surface; if it
-- breaks anything, only 9 callers to bisect.
--
-- Pre-apply assumptions verified against production at draft time
-- ---------------------------------------------------------------
--   • Table has exactly 3 columns: id text NOT NULL DEFAULT 'current',
--     built_at timestamptz, data jsonb DEFAULT '{}'::jsonb.
--   • One row exists, id='current'.
--   • Primary key is `answer_intelligence_index_pkey` on (id).
--   • Current policies: deny_anon + deny_authenticated. Untouched here.
--   • The disk-side reader (src/domains/answer-intelligence/store.ts)
--     already resolves a per-tenant path via readDotDataJson —
--     `.data/tenants/<slug>/answer-intelligence-index.json` exists for
--     Ritz today. The Supabase table is the lagging surface.
--
-- What this migration does
-- ------------------------
--   1. ADD COLUMN tenant_id text  (nullable initially so the backfill can run).
--   2. UPDATE … SET tenant_id = 'tenant-ritz-founder' WHERE tenant_id IS NULL
--      (single-row backfill of the existing deployment-singleton).
--   3. ALTER COLUMN tenant_id SET NOT NULL.
--   4. ADD CONSTRAINT answer_intelligence_index_tenant_id_nonempty_chk
--      CHECK (tenant_id <> '')  — matches Stage C convention.
--   5. DROP CONSTRAINT answer_intelligence_index_pkey  (the (id) PK).
--   6. ADD CONSTRAINT answer_intelligence_index_pkey PRIMARY KEY
--      (tenant_id, id)  — the new per-tenant grain.
--   7. CREATE INDEX answer_intelligence_index_tenant_id_idx ON (tenant_id)
--      so tenant-scoped reads have an index even before the policy change.
--
-- What this migration does NOT do
-- -------------------------------
--   • Does NOT touch RLS policies. `deny_authenticated` stays in force;
--     a companion `_rls.sql` migration handles the policy switch in a
--     later bundle, AFTER this schema change has held cleanly.
--   • Does NOT mutate the `data` jsonb payload. Existing values are
--     preserved verbatim.
--   • Does NOT touch any other table.
--   • Does NOT touch business_config or citation_evidence_index — those
--     are D3.B and D3.C, separate bundles.
--   • Does NOT change the `id` default ('current' stays). Per-tenant
--     deployment singletons still use id='current'; the (tenant_id, id)
--     PK simply scopes the singleton per tenant.
--   • Does NOT INSERT, DELETE, or TRUNCATE any data beyond the single
--     UPDATE that backfills tenant_id on the existing Ritz row.
--
-- Rollback
-- --------
-- Commented block at the bottom: drop the new index, drop the new PK,
-- recreate the (id)-only PK, drop the CHECK, drop the column.
-- Reversible because the migration is purely additive plus a PK swap;
-- the data column is untouched.
--
-- ============================================================================

BEGIN;

-- ─── 1. Add column (nullable for backfill) ────────────────────────────────

ALTER TABLE public.answer_intelligence_index
  ADD COLUMN tenant_id text;

-- ─── 2. Backfill the single existing row ──────────────────────────────────

UPDATE public.answer_intelligence_index
SET    tenant_id = 'tenant-ritz-founder'
WHERE  tenant_id IS NULL;

-- ─── 3. Lock the column NOT NULL ──────────────────────────────────────────

ALTER TABLE public.answer_intelligence_index
  ALTER COLUMN tenant_id SET NOT NULL;

-- ─── 4. Stage-C-style nonempty CHECK ──────────────────────────────────────

ALTER TABLE public.answer_intelligence_index
  ADD CONSTRAINT answer_intelligence_index_tenant_id_nonempty_chk
    CHECK (tenant_id <> '');

-- ─── 5. Swap the primary key from (id) to (tenant_id, id) ─────────────────

ALTER TABLE public.answer_intelligence_index
  DROP CONSTRAINT answer_intelligence_index_pkey;

ALTER TABLE public.answer_intelligence_index
  ADD CONSTRAINT answer_intelligence_index_pkey
    PRIMARY KEY (tenant_id, id);

-- ─── 6. Index for tenant-scoped reads ─────────────────────────────────────

CREATE INDEX answer_intelligence_index_tenant_id_idx
  ON public.answer_intelligence_index (tenant_id);

COMMIT;

-- ============================================================================
-- ROLLBACK (commented out; uncomment + apply only if rollback is required)
-- ============================================================================
-- BEGIN;
--   DROP INDEX IF EXISTS public.answer_intelligence_index_tenant_id_idx;
--   ALTER TABLE public.answer_intelligence_index
--     DROP CONSTRAINT answer_intelligence_index_pkey;
--   ALTER TABLE public.answer_intelligence_index
--     ADD CONSTRAINT answer_intelligence_index_pkey PRIMARY KEY (id);
--   ALTER TABLE public.answer_intelligence_index
--     DROP CONSTRAINT answer_intelligence_index_tenant_id_nonempty_chk;
--   ALTER TABLE public.answer_intelligence_index
--     DROP COLUMN tenant_id;
-- COMMIT;
-- ============================================================================
