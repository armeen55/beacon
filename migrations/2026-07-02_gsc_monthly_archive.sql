-- 2026-07-02 - gsc_monthly_archive: permanent monthly rollup of GSC demand (BEACON_500 item 21).
--
-- Google Search Console only retains ~16 months of daily detail. gsc_daily_rows
-- already syncs that daily detail but is bound by GSC's own retention window, so
-- anything older eventually falls out of what Google will re-serve. This table is
-- Beacon's OWN permanent memory: one row per (tenant, query, month) with summed
-- impressions/clicks and the page that took the most impressions that month.
-- Once written, a month's row never needs GSC again, so Beacon keeps demand
-- history forever even after Google's window slides past it.
--
-- Written by src/domains/seasonal/archive-rollup.ts, which reads gsc_daily_rows
-- in bounded monthly chunks (never one unbounded read) and UPSERTs one row per
-- (tenant, query, month) so re-running the rollup for a month it already has is
-- a no-op churn, not a duplicate.
--
-- Additive + idempotent. RLS mirrors the peer tables (deny anon; authenticated
-- via is_tenant_member; the service-role client bypasses RLS).

CREATE TABLE IF NOT EXISTS public.gsc_monthly_archive (
  tenant_id   text    NOT NULL,
  query       text    NOT NULL,
  -- First day of the month this row summarizes (e.g. 2026-03-01 for March 2026).
  month       date    NOT NULL,
  impressions integer NOT NULL DEFAULT 0,
  clicks      integer NOT NULL DEFAULT 0,
  -- The page that took the most impressions for this query in this month.
  top_page    text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, query, month)
);

CREATE INDEX IF NOT EXISTS gsc_monthly_archive_tenant_month_idx
  ON public.gsc_monthly_archive (tenant_id, month);

ALTER TABLE public.gsc_monthly_archive ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.gsc_monthly_archive;
CREATE POLICY deny_anon ON public.gsc_monthly_archive AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.gsc_monthly_archive;
CREATE POLICY tenant_authenticated_rw ON public.gsc_monthly_archive AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
