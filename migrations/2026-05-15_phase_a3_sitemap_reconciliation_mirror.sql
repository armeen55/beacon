-- Migration: 2026-05-15_phase_a3_sitemap_reconciliation_mirror.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   PENDING — operator approval required before apply.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Phase A.3 (post-A.3.5) sitemap-reconciliation Supabase mirror.
--
-- Why this migration exists:
--   The indexability loader (A.3.3b) and operator diagnostics page
--   (A.3.5) read sitemap reconciliation data to compute per-URL
--   verdicts (in_sitemap signal). The store classification listed
--   `sitemap-reconciliation` as GLOBAL — a single file at
--   `.data/global/sitemap-reconciliation.json`. On Vercel's
--   read-only lambda FS that file doesn't exist → reader returns
--   null → loader can never claim `ok` (sitemapConfirmed === true
--   is required).
--
--   This migration adds the persistent storage layer AND flips
--   the store classification from GLOBAL → TENANT_SCOPED. Per-
--   tenant PK retires the cross-tenant hazard the A.3.3b loader's
--   tenant-domain filter currently defends against (defense
--   becomes defense-in-depth rather than primary boundary).
--
-- Schema design rationale:
--   * JSONB for canonical_pages + stale_pages: arrays consumed by
--     set-membership and host-equality checks, not range queries.
--     Single-row read is fastest; normalization adds complexity
--     without query-shape benefit.
--   * Scalar columns for counts (sitemap_url_count, registry_matched,
--     sitemap_only) + freshness anchors (fetched_at) so operator
--     diagnostics can summarize without parsing JSONB.
--   * Per-tenant PK retires the global-store hazard.
--
-- Sequencing model A (operator-locked):
--   New code is safe to deploy BEFORE this migration applies.
--   Repository `getSitemapReconciliation()` soft-fails to null on
--   the `42P01` (undefined_table) PostgreSQL error, so production
--   readers see "no sitemap evidence" until both (a) the
--   migration applies AND (b) the next daily-scan runs the
--   dual-write.
--   Writes fail loud — scan-owned-pages.ts will error if it tries
--   to UPSERT before the migration has run, surfacing the missing
--   migration to the operator.
--
-- Constraints (operator-locked):
--   * ADDITIVE ONLY — new table, no ALTERs to existing tables.
--   * No data mutation. Table starts empty; populated by next
--     daily-scan after this applies.
--   * RLS deny-all for authenticated; service_role bypasses.
--   * Rollback: DROP TABLE IF EXISTS public.sitemap_reconciliation
--     CASCADE. Then revert store-classification.ts to put
--     "sitemap-reconciliation" back in GLOBAL_STORES.

CREATE TABLE IF NOT EXISTS public.sitemap_reconciliation (
  tenant_id          text         PRIMARY KEY,
  sitemap_domain     text         NOT NULL,
  sitemap_url_count  integer      NOT NULL,
  canonical_pages    jsonb        NOT NULL,
  stale_pages        jsonb        NOT NULL,
  registry_matched   integer      NOT NULL,
  sitemap_only       integer      NOT NULL,
  fetched_at         timestamptz  NOT NULL,
  schema_version     integer      NOT NULL DEFAULT 1,
  updated_at         timestamptz  NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sitemap_reconciliation IS 'Phase A.3 (post-A.3.5) per-tenant sitemap reconciliation mirror. Replaces the GLOBAL .data/global/sitemap-reconciliation.json that returned null on production AND inherited a cross-tenant hazard. Per-tenant PK retires that hazard at the storage layer.';

COMMENT ON COLUMN public.sitemap_reconciliation.canonical_pages IS 'JSONB array of SitemapReconciliationCanonicalPage records (one per URL declared in the tenant sitemap.xml at last scan).';

COMMENT ON COLUMN public.sitemap_reconciliation.stale_pages IS 'JSONB array of SitemapReconciliationStalePage records (one per registry page absent from sitemap: stale_domain / not_in_sitemap / unscannable_url).';

CREATE INDEX IF NOT EXISTS sitemap_reconciliation_updated_at_idx
  ON public.sitemap_reconciliation (updated_at DESC);

ALTER TABLE public.sitemap_reconciliation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_authenticated" ON public.sitemap_reconciliation
  AS PERMISSIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
