-- Migration: 2026-05-17_gsc_url_inspections.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   PENDING — operator approval required before apply.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     A.3.b2 — Supabase durable GSC URL Inspection cache
--            (post-A.3.b1.alpha, operator-substrate persistence fix).
--
-- Why this migration exists:
--   A.3.b1.alpha shipped a disk-backed cache for the GSC URL Inspection
--   API at `.data/tenants/{slug}/gsc-url-inspections.json`. On Vercel
--   that cache is INERT: the lambda filesystem is read-only post-init
--   (writes were explicitly skipped under `process.env.VERCEL === "1"`),
--   AND the `.data/` directory is gitignored so the read path
--   (`existsSync`) always returns false. Net effect on production:
--   every `gscUrlInspect()` call missed cache and hit the API.
--
--   With GSC URL Inspection API quota at 2,000 calls/day/property and
--   future operator-diagnostic pages looping over Ritz's ~30 URLs
--   per render, the disk-cache no-op would have burned daily quota in
--   under an hour of normal operator usage. A.3.b2 makes the cache
--   durable on Vercel by migrating it to Supabase.
--
-- Operator-substrate posture preserved:
--   The GSC URL Inspection client at `src/lib/connectors/gsc/client.ts`
--   remains operator-substrate only. This migration is its storage
--   layer; the indexability wire-up (A.3.b1.beta) is a SEPARATE
--   downstream slice and does not run in this commit.
--
-- Sequencing model A (operator-locked, mirrors robots-state +
-- connector-tokens):
--   New client code soft-fails on `42P01` (undefined_table) for READS
--   so production cache-misses gracefully when this migration hasn't
--   applied yet. The first cache WRITE after the migration window
--   succeeds and populates the table. Writes only run after a
--   successful API call, so a missing table during the deploy window
--   just means "no cache durability yet" — identical to today's
--   Vercel behavior. No regression possible.
--
-- Constraints (operator-locked):
--   * ADDITIVE ONLY — new table, no ALTERs to existing tables.
--   * No data mutation in this migration. Table starts empty;
--     populated by future operator-triggered `gscUrlInspect` calls.
--   * RLS deny-all for authenticated. service_role bypasses RLS.
--     Customer surfaces never read this table; only the operator-
--     substrate GSC client via service_role.
--   * Composite PK (tenant_id, inspection_url) enforces per-tenant
--     per-URL one-row-max. Mirrors the connector_tokens shape.
--   * `raw` JSONB stores the verbatim API response for operator
--     triage (cache-side; not customer-rendered).
--   * `last_crawl_time` is nullable — GSC omits it for URLs Google
--     has never crawled.
--   * `last_checked_at` is the TTL anchor — composite-PK upsert on
--     every fresh fetch updates it forward.
--   * Rollback: DROP TABLE IF EXISTS public.gsc_url_inspections
--     CASCADE. Reverts cleanly — no FK references. Future
--     `gscUrlInspect` calls revert to the (broken) disk-cache
--     no-op state on Vercel, which is the pre-A.3.b2 behavior.

CREATE TABLE IF NOT EXISTS public.gsc_url_inspections (
  tenant_id        text         NOT NULL,
  inspection_url   text         NOT NULL,
  site_url         text         NOT NULL,
  indexing_state   text,
  coverage_state   text,
  last_crawl_time  timestamptz,
  last_checked_at  timestamptz  NOT NULL,
  raw              jsonb        NOT NULL,
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, inspection_url)
);

COMMENT ON TABLE public.gsc_url_inspections IS 'A.3.b2 (2026-05-17): per-tenant Supabase-backed cache for the GSC URL Inspection API. Replaces the A.3.b1.alpha disk cache which was inert on Vercel. Composite PK (tenant_id, inspection_url) gives one row per tenant per inspected URL. Read path: gscUrlInspect() in src/lib/connectors/gsc/client.ts. Write path: same — upsert on successful API call. 24h TTL via last_checked_at.';

COMMENT ON COLUMN public.gsc_url_inspections.tenant_id IS 'Beacon tenant identifier (e.g. tenant-ritz-founder). Composite PK with inspection_url; tenant-isolation lives at the storage layer.';

COMMENT ON COLUMN public.gsc_url_inspections.inspection_url IS 'Canonical inspection URL the client asked the GSC API about (e.g. https://ritzbuilders.com/services/whole-home-remodel). Caller is responsible for canonicalization before lookup; this column stores verbatim what was inspected.';

COMMENT ON COLUMN public.gsc_url_inspections.site_url IS 'GSC property the inspection ran against (e.g. sc-domain:ritzbuilders.com or https://example.com/). Preserved for operator audit trail and to disambiguate when one tenant owns multiple GSC properties (multi-property is Section 8 J1 deferred).';

COMMENT ON COLUMN public.gsc_url_inspections.indexing_state IS 'Google indexing-state token from inspectionResult.indexStatusResult.indexingState (e.g. INDEXING_ALLOWED, BLOCKED_BY_ROBOTS_TXT, BLOCKED_BY_NOINDEX). Null when omitted by the API.';

COMMENT ON COLUMN public.gsc_url_inspections.coverage_state IS 'Human-readable coverage state from inspectionResult.indexStatusResult.coverageState (e.g. "Submitted and indexed", "Discovered - currently not indexed"). Null when omitted.';

COMMENT ON COLUMN public.gsc_url_inspections.last_crawl_time IS 'ISO timestamp Google last crawled the URL, from inspectionResult.indexStatusResult.lastCrawlTime. Null when never crawled or omitted.';

COMMENT ON COLUMN public.gsc_url_inspections.last_checked_at IS 'When Beacon recorded this result. 24h TTL gate compares this against now; entries older than 24h trigger a fresh API call on next inspection.';

COMMENT ON COLUMN public.gsc_url_inspections.raw IS 'Verbatim Google API response — operator triage only. Downstream consumers MUST NOT depend on this shape (Google may add fields).';

CREATE INDEX IF NOT EXISTS gsc_url_inspections_tenant_last_checked_idx
  ON public.gsc_url_inspections (tenant_id, last_checked_at DESC);

ALTER TABLE public.gsc_url_inspections ENABLE ROW LEVEL SECURITY;

-- Deny-all for authenticated clients. service_role bypasses RLS.
-- Customer surfaces never read this table; only server-side
-- operator-substrate paths via service_role.
CREATE POLICY "deny_authenticated" ON public.gsc_url_inspections
  AS PERMISSIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
