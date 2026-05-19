-- Migration: 2026-05-19_ga4_url_traffic.sql
-- Author:    Armeen Aminzadeh (operator) + Claude
-- Applied:   2026-05-19 — operator-approved apply via linked Supabase CLI.
-- Project:   jdegznovgysxyweknewh (beacon)
-- Phase:     Section 9 / Slice 9.A2α — first Section-9 migration.
--            GA4 Data API cache for per-tenant per-URL per-day
--            traffic metrics. Powers Mode A outcome attribution
--            (Section 6 scope-discipline + K4 sample-size guard).
--
-- Why this migration exists:
--   Slice 9.A2α adds a typed `runGa4UrlTrafficReport` wrapper around
--   the GA4 Data API. The `data-api.ts` module talks directly to
--   Google's Data API endpoint at
--     POST analyticsdata.googleapis.com/v1beta/properties/{id}:runReport
--   and narrows the response into `Ga4UrlTrafficRow[]`. Customer
--   surfaces never call the Data API on page load (architecture
--   invariant `ga4-no-page-load-call`); customer surfaces (Slice
--   9.A2β) read pre-computed Mode A copy off the cached rows in
--   this table.
--
--   This is THE FIRST Section-9 migration. Mode B / Mode C / GBP
--   insights / CallRail outcome read models will land as separate
--   later migrations (each a sibling table, not an ALTER to this
--   one — keep migrations additive).
--
-- Operator-substrate posture:
--   Customer surfaces NEVER read this table directly. The flow is:
--     • operator-only `/diagnostics/outcome-attribution` reads
--       the table via the Supabase admin client.
--     • (future Slice 9.A2β) Changes detail Act 3 reads the table
--       via a tenant-scoped pure-compute Mode A read model
--       (mode-a-cited-here-traffic-here.ts).
--   The Mode A read model is server-side only (`import "server-only"`),
--   wraps the table read in `unstable_cache` with the tenant id as
--   part of the cache key, and returns the customer-safe `ModeAResult`
--   discriminated union. No raw row ever crosses the operator-
--   substrate boundary.
--
-- Sequencing model A (operator-locked, mirrors 9.A1α JSONB extension):
--   New client code (`data-api.ts`) writes to this table on
--   on-demand operator-triggered refresh. Reads soft-fail on
--   `42P01` (undefined_table) so the deploy window where code
--   lands before this migration runs is harmless (operator
--   diagnostic shows empty table; no customer impact). The first
--   write after the migration applies populates the table.
--
-- K-block + H-block scope discipline (locked):
--   • K4 sample-size guard: Mode A only renders customer copy when
--     ≥ 7 days post-live AND (≥ 5 sessions OR ≥ 1 qualified call).
--     The table stores raw daily rows; the read model applies the
--     guard.
--   • K5 customer copy: "received N sessions and M calls in the N
--     days since going live". NEVER "drove" / "caused" / "$" /
--     "revenue" / "dollars". Pinned by future 9.A2β forbidden-vocab
--     invariant.
--   • H7 derive-on-read: customer Mode A copy is computed at render
--     time from rows in this cache; not materialized further.
--   • Section 6 Mode C silence: brand-level outcomes never attributed
--     to a specific change. This table is per-URL; cross-tenant /
--     brand-level rollups are out of scope.
--
-- Constraints (operator-locked):
--   * ADDITIVE ONLY — new table, no ALTERs to existing tables.
--   * No data mutation in this migration. Table starts empty.
--   * RLS deny-all for authenticated. service_role bypasses RLS.
--     Customer surfaces never read this table directly.
--   * Composite PK (tenant_id, url, date) enforces per-tenant per-URL
--     per-day one-row-max. Tenant-isolation lives at the storage
--     layer (PK + RLS).
--   * `raw` JSONB is optional — stores verbatim Data API row for
--     operator triage; downstream consumers MUST NOT depend on this
--     shape (Google may add fields).
--   * `last_synced_at` is the TTL anchor — composite-PK upsert on
--     every fresh fetch updates it forward; the read model can use
--     this column to decide whether to trigger a refresh.
--   * Secondary index on (tenant_id, last_synced_at) supports the
--     refresh-stale-rows query pattern.
--   * Rollback: DROP TABLE IF EXISTS public.ga4_url_traffic CASCADE.
--     Reverts cleanly — no FK references. Future `runGa4UrlTrafficReport`
--     calls revert to soft-fail-on-undefined-table cache misses;
--     customer surfaces would just show no Mode A copy (silent
--     fail-safe, no customer impact).

CREATE TABLE IF NOT EXISTS public.ga4_url_traffic (
  tenant_id         text         NOT NULL,
  url               text         NOT NULL,
  date              date         NOT NULL,
  sessions          integer      NOT NULL DEFAULT 0,
  engaged_sessions  integer      NOT NULL DEFAULT 0,
  conversions       integer      NOT NULL DEFAULT 0,
  last_synced_at    timestamptz  NOT NULL DEFAULT now(),
  raw               jsonb,
  updated_at        timestamptz  NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, url, date)
);

COMMENT ON TABLE public.ga4_url_traffic IS 'Slice 9.A2α (2026-05-19): per-tenant Supabase-backed cache for the GA4 Data API runReport endpoint. Composite PK (tenant_id, url, date) gives one row per tenant per URL per day. Customer surfaces NEVER read this directly; operator-substrate only via mode-a-cited-here-traffic-here.ts (Slice 9.A2β consumer). Powers Mode A outcome attribution per K4 sample-size guard + K5 customer copy locks.';

COMMENT ON COLUMN public.ga4_url_traffic.tenant_id IS 'Beacon tenant identifier (e.g. tenant-ritz-founder). Composite PK with (url, date); tenant-isolation lives at the storage layer plus RLS deny-all.';

COMMENT ON COLUMN public.ga4_url_traffic.url IS 'Page path or full URL as returned by GA4''s pagePath dimension. Caller is responsible for canonicalization before lookup to match against recommended_edits.target_url.';

COMMENT ON COLUMN public.ga4_url_traffic.date IS 'UTC date the metric values are for (NOT the fetch time). Date type, not timestamp — daily granularity is the locked grain.';

COMMENT ON COLUMN public.ga4_url_traffic.sessions IS 'Daily sessions count from GA4 metric "sessions". Stored as integer (GA4 returns strings; data-api.ts parses).';

COMMENT ON COLUMN public.ga4_url_traffic.engaged_sessions IS 'Daily engaged sessions count from GA4 metric "engagedSessions". Stored as integer.';

COMMENT ON COLUMN public.ga4_url_traffic.conversions IS 'Daily conversion count from GA4 metric "conversions". Stored as integer. NOT surfaced in K5 customer copy ("received N sessions and M calls" only). Operator-substrate triage only.';

COMMENT ON COLUMN public.ga4_url_traffic.last_synced_at IS 'When Beacon recorded this row. TTL anchor for the operator-diagnostic refresh decision (default 24h). Updated on every composite-PK upsert.';

COMMENT ON COLUMN public.ga4_url_traffic.raw IS 'Verbatim GA4 Data API row payload — operator triage only. Downstream consumers MUST NOT depend on this shape (Google may add fields).';

CREATE INDEX IF NOT EXISTS ga4_url_traffic_tenant_synced_idx
  ON public.ga4_url_traffic (tenant_id, last_synced_at DESC);

ALTER TABLE public.ga4_url_traffic ENABLE ROW LEVEL SECURITY;

-- Deny-all for authenticated clients. service_role bypasses RLS.
-- Customer surfaces never read this table; only server-side
-- operator-substrate paths via service_role.
CREATE POLICY "deny_authenticated" ON public.ga4_url_traffic
  AS PERMISSIVE FOR ALL TO authenticated
  USING (false) WITH CHECK (false);
