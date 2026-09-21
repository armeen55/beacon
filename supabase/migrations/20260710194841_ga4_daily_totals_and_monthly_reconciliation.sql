-- 2026-07-10 - ga4_daily_totals + ga4_monthly_reconciliation: the TRUE sitewide GA4
-- series at the correct grain (Wave 2 lane A of the product-truth addendum).
-- Additive + idempotent; RLS mirrors peer tables; reversible via DROP TABLE.

CREATE TABLE IF NOT EXISTS public.ga4_daily_totals (
  tenant_id         text        NOT NULL,
  property_id       text        NOT NULL,
  date              date        NOT NULL,
  sessions          integer     NOT NULL DEFAULT 0,
  engaged_sessions  integer     NOT NULL DEFAULT 0,
  property_timezone text,
  truncated         boolean     NOT NULL DEFAULT false,
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

CREATE TABLE IF NOT EXISTS public.ga4_monthly_reconciliation (
  tenant_id        text        NOT NULL,
  property_id      text        NOT NULL,
  checked_at       timestamptz NOT NULL DEFAULT now(),
  status           text        NOT NULL,
  tolerance_pct    numeric     NOT NULL DEFAULT 1,
  latest_sync_at   timestamptz,
  reconciled_through date,
  per_month        jsonb       NOT NULL DEFAULT '[]'::jsonb,
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, property_id)
);

ALTER TABLE public.ga4_monthly_reconciliation ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.ga4_monthly_reconciliation;
CREATE POLICY deny_anon ON public.ga4_monthly_reconciliation AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.ga4_monthly_reconciliation;
CREATE POLICY tenant_authenticated_rw ON public.ga4_monthly_reconciliation AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));;
