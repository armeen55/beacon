-- 2026-07-10 - ga4_daily_totals + ga4_monthly_reconciliation: the TRUE sitewide GA4
-- series at the correct grain (Wave 2 lane A of the product-truth addendum).
--
-- WHY THIS EXISTS. Wave 1 proved the old sitewide-visits number was false: it summed
-- GA4 sessions across rows of ga4_url_traffic, which is grained by (url, date). GA4
-- sessions are NOT additive across page paths - one visit that touches several pages
-- shows up in several page rows - so that sum materially inflated the real visit count
-- (see the INVALID-FOR-SITEWIDE banner on migrations/2026-07-09_ga4_monthly_sessions_rpc.sql).
--
-- The fix is to store GA4's OWN sitewide aggregation at a grain that IS additive across
-- rows: ONE row per (tenant, property, day) holding the sessions GA4 itself counted for
-- that whole property that day (a date-only runReport, no pagePath dimension). A session
-- belongs to exactly one day, and days are disjoint, so summing daily rows across
-- DISTINCT days is additive-safe - the same property gsc_daily_totals relies on. "visits"
-- means GA4 sessions throughout this system (defined in code alongside the report).
--
-- TIMEZONE. GA4 buckets the `date` dimension in the PROPERTY's own reporting timezone by
-- default in its runReport responses. We capture that timezone (property_timezone, read
-- from the report response metadata) so month boundaries are honestly the property's, not
-- an assumed UTC. The rollup buckets on the stored date string as GA4 returned it.
--
-- is_final is deliberately OMITTED. GA4's runReport does not cheaply return a per-day
-- freshness/final marker (its data can still shift for ~48h). Rather than fake a final
-- flag, correctness is enforced by the reconciliation gate below: the north-star card
-- shows visits ONLY when a DIRECT month-grain GA4 report matches this daily rollup within
-- tolerance. `truncated` records that the pull that wrote a row was a partial (paginated)
-- pull, so an incomplete day is never mistaken for a clean one.
--
-- Written by src/lib/connectors/ga4/persist-sitewide-sessions.ts (a SEPARATE Data API
-- report from the per-page traffic sync, so a failure here never touches ga4_url_traffic
-- and vice versa). Idempotent UPSERT on (tenant_id, property_id, date) so overlapping or
-- repeated syncs can never inflate a day.
--
-- Additive + idempotent. RLS mirrors the peer tables (deny anon; authenticated via
-- is_tenant_member; the service-role client the app uses bypasses RLS). Reversible via
-- DROP TABLE; touches no existing data. NOT APPLIED here - the architect applies this via
-- the Supabase MCP at integration. Until then every read soft-fails on PGRST205/42P01
-- (treated as table-missing) and the north-star card keeps holding the visits number back.

CREATE TABLE IF NOT EXISTS public.ga4_daily_totals (
  tenant_id         text        NOT NULL,
  property_id       text        NOT NULL,
  -- The calendar day, in the PROPERTY's reporting timezone (see property_timezone).
  date              date        NOT NULL,
  -- GA4's own sitewide session count for the whole property that day (date-only report).
  sessions          integer     NOT NULL DEFAULT 0,
  engaged_sessions  integer     NOT NULL DEFAULT 0,
  -- The property's reporting timezone GA4 bucketed this date in (e.g. "America/Los_Angeles").
  property_timezone text,
  -- TRUE when the pull that wrote this row was a PARTIAL (paginated/capped) GA4 result.
  truncated         boolean     NOT NULL DEFAULT false,
  -- When the GA4 report run that produced this row happened.
  source_run_at     timestamptz,
  synced_at         timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, property_id, date)
);

CREATE INDEX IF NOT EXISTS ga4_daily_totals_tenant_date_idx
  ON public.ga4_daily_totals (tenant_id, date);

ALTER TABLE public.ga4_daily_totals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.ga4_daily_totals;
CREATE POLICY deny_anon ON public.ga4_daily_totals AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.ga4_daily_totals;
CREATE POLICY tenant_authenticated_rw ON public.ga4_daily_totals AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));

-- --------------------------------------------------------------------------------------
-- ga4_monthly_reconciliation: the RECONCILIATION MARKER that gates the visits number.
--
-- reconcileGa4MonthlySeries(tenantId) fetches a DIRECT month-grain GA4 report (yearMonth
-- dimension) and compares it, month by full month, against the daily rollup above. It
-- writes one latest-wins row per (tenant, property) recording the verdict. The north-star
-- card may show visits ONLY when status='pass' AND checked_at is newer than the rollup's
-- latest synced_at (latest_sync_at) - otherwise the shipped hold-back line stays. A
-- 'mismatch' verdict drives an honest alert ("the visits number does not add up yet"),
-- never a confident claim. With GA4 disconnected the reconcile writes status='not_connected'
-- (reusing the connector-health reason), never a fake pass.
--
-- Kept in this same migration because it exists only to make ga4_daily_totals safe to
-- show. Typed + tenant-keyed (not a file store) so it stays correct in the cron fan-out,
-- which has no ambient tenant context. Additive + idempotent; reversible via DROP TABLE.
CREATE TABLE IF NOT EXISTS public.ga4_monthly_reconciliation (
  tenant_id        text        NOT NULL,
  property_id      text        NOT NULL,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  -- 'pass' | 'mismatch' | 'not_connected' | 'error'.
  status           text        NOT NULL,
  -- The per-month tolerance the check used, in percent (e.g. 1 = within 1%).
  tolerance_pct    numeric     NOT NULL DEFAULT 1,
  -- The rollup's max synced_at this reconciliation checked against; the card requires
  -- checked_at to be at least this fresh before trusting a 'pass'.
  latest_sync_at   timestamptz,
  -- The last FULL month the check confirmed (first day of month), null on a non-pass.
  reconciled_through date,
  -- [{ month, stored_sessions, direct_sessions, delta_pct, within_tolerance }].
  per_month        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, property_id)
);

ALTER TABLE public.ga4_monthly_reconciliation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.ga4_monthly_reconciliation;
CREATE POLICY deny_anon ON public.ga4_monthly_reconciliation AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.ga4_monthly_reconciliation;
CREATE POLICY tenant_authenticated_rw ON public.ga4_monthly_reconciliation AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
