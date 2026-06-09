-- Migration: 2026-06-09_semrush_domain_metrics.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   PENDING — operator-applied on deploy via linked Supabase
--            CLI (NOT applied from the build environment). Until then,
--            reads soft-fail on 42P01 (undefined_table) → empty cache.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Semrush connector — per-tenant Supabase-backed cache for
--            the Semrush Analytics domain reports (domain_ranks +
--            domain_organic_organic). Lets the operator capture metrics
--            while their (week-limited) Semrush key is connected and
--            keep them after the key expires.
--
-- Why this migration exists:
--   The Semrush client (`src/lib/connectors/semrush/*`) talks to
--   https://api.semrush.com/ with the operator's key (stored in the
--   provider-agnostic `connector_tokens` JSONB row — no schema change
--   for the key itself). This table persists the FETCHED metrics so a
--   one-week key yields durable data. Operator-triggered refresh writes
--   here; the operator diagnostic reads from here.
--
-- Sequencing model A (mirrors ga4_url_traffic 2026-05-19):
--   Client code lands before this migration applies. Writes/reads
--   soft-fail on 42P01 so the pre-migration window is harmless (the
--   diagnostic shows an empty cache; no customer impact). The first
--   refresh after apply populates the table.
--
-- Constraints (operator-locked):
--   * ADDITIVE ONLY — new table, no ALTERs to existing tables.
--   * No data mutation here. Table starts empty.
--   * RLS deny-all for authenticated. service_role bypasses. Customer
--     surfaces never read this table — operator-substrate only.
--   * Composite PK (tenant_id, domain) — one snapshot row per tenant
--     per domain (latest wins on upsert). Tenant-isolation at the
--     storage layer (PK + RLS).
--   * overview + organic_competitors are JSONB (the normalized shapes
--     from `src/lib/connectors/semrush/types.ts`). Downstream consumers
--     read the typed snapshot; raw column codes are not stored.
--   * Rollback: DROP TABLE IF EXISTS public.semrush_domain_metrics CASCADE.
--     Reverts cleanly — no FK references; refresh reverts to
--     soft-fail-on-undefined-table.

CREATE TABLE IF NOT EXISTS public.semrush_domain_metrics (
  tenant_id            text         NOT NULL,
  domain               text         NOT NULL,
  database             text         NOT NULL DEFAULT 'us',
  fetched_at           timestamptz  NOT NULL DEFAULT now(),
  overview             jsonb,
  organic_competitors  jsonb        NOT NULL DEFAULT '[]'::jsonb,
  last_synced_at       timestamptz  NOT NULL DEFAULT now(),
  updated_at           timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, domain)
);

COMMENT ON TABLE public.semrush_domain_metrics IS 'Semrush connector (2026-06-09): per-tenant Supabase-backed cache for Semrush Analytics domain reports (domain_ranks overview + domain_organic_organic competitors). Composite PK (tenant_id, domain) → one latest snapshot per tenant per domain. Operator-substrate only; customer surfaces never read this directly. Powers /diagnostics/semrush + (future) competitor-set augmentation.';

COMMENT ON COLUMN public.semrush_domain_metrics.tenant_id IS 'Beacon tenant identifier. Composite PK with domain; tenant-isolation at the storage layer plus RLS deny-all.';
COMMENT ON COLUMN public.semrush_domain_metrics.domain IS 'Domain the metrics describe (the Semrush `domain` param).';
COMMENT ON COLUMN public.semrush_domain_metrics.database IS 'Semrush regional database the figures came from (e.g. "us").';
COMMENT ON COLUMN public.semrush_domain_metrics.overview IS 'Normalized SemrushDomainOverview JSON (rank/organicKeywords/organicTraffic/organicCostUsd/adwordsKeywords). Null if the overview fetch returned no row.';
COMMENT ON COLUMN public.semrush_domain_metrics.organic_competitors IS 'Normalized SemrushOrganicCompetitor[] JSON. Empty array when none returned.';
COMMENT ON COLUMN public.semrush_domain_metrics.last_synced_at IS 'When Beacon recorded this snapshot. TTL anchor for refresh decisions; updated on every upsert.';

CREATE INDEX IF NOT EXISTS semrush_domain_metrics_tenant_synced_idx
  ON public.semrush_domain_metrics (tenant_id, last_synced_at DESC);

ALTER TABLE public.semrush_domain_metrics ENABLE ROW LEVEL SECURITY;

-- Deny-all for authenticated clients. service_role bypasses RLS.
CREATE POLICY "deny_authenticated" ON public.semrush_domain_metrics
  AS PERMISSIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
