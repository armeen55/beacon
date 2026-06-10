-- Migration: 2026-06-09_call_url_attribution.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   PENDING — operator-applied on deploy via linked Supabase
--            CLI (NOT applied from the build environment). Reads soft-fail
--            on 42P01 until then → qualifiedCallCount stays 0 (today's
--            behavior), so the pre-migration window is harmless.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     §9.B — CallRail call attribution. Closes the outcome loop's
--            last mile (cited → recommended → traffic → CALL). Per-tenant
--            per-URL per-day qualified + total call counts, keyed on the
--            canonical landing URL so the existing Mode A engine
--            (post_live_qualified_calls / K4 ≥1-call branch) lights up.
--
-- Sibling of ga4_url_traffic (2026-05-19); same grain + posture:
--   * ADDITIVE ONLY — new table, no ALTERs.
--   * RLS deny-all for authenticated; service_role bypasses. Customer
--     surfaces never read this directly — operator-substrate only; the
--     Mode A read model sums it server-side.
--   * Composite PK (tenant_id, url, date) — one row per tenant per
--     canonical URL per UTC day (latest upsert wins).
--   * Rollback: DROP TABLE IF EXISTS public.call_url_attribution CASCADE.

CREATE TABLE IF NOT EXISTS public.call_url_attribution (
  tenant_id        text         NOT NULL,
  url              text         NOT NULL,
  date             date         NOT NULL,
  qualified_calls  integer      NOT NULL DEFAULT 0,
  total_calls      integer      NOT NULL DEFAULT 0,
  last_synced_at   timestamptz  NOT NULL DEFAULT now(),
  raw              jsonb,
  updated_at       timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, url, date)
);

COMMENT ON TABLE public.call_url_attribution IS '§9.B (2026-06-09): per-tenant CallRail call attribution cache. Composite PK (tenant_id, url, date) — qualified + total inbound calls per canonical landing URL per UTC day. Operator-substrate only; the Mode A read model sums qualified_calls per target URL since live_at into post_live_qualified_calls (K4 >=1-call branch). url is canonical (canonicalizeCitationUrl) to match recommended_edits.target_url.';
COMMENT ON COLUMN public.call_url_attribution.url IS 'Canonical landing-page URL (via canonicalizeCitationUrl) — matches the Mode A target_url join key.';
COMMENT ON COLUMN public.call_url_attribution.qualified_calls IS 'Calls CallRail scored good_lead OR answered with duration >= rule threshold. Feeds Mode A post_live_qualified_calls.';
COMMENT ON COLUMN public.call_url_attribution.total_calls IS 'All attributed calls for the URL/day (qualified + unqualified). Operator triage.';

CREATE INDEX IF NOT EXISTS call_url_attribution_tenant_synced_idx
  ON public.call_url_attribution (tenant_id, last_synced_at DESC);

ALTER TABLE public.call_url_attribution ENABLE ROW LEVEL SECURITY;

CREATE POLICY "deny_authenticated" ON public.call_url_attribution
  AS PERMISSIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
