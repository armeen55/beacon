-- 2026-07-01 - revenue_facts: the honest dollar substrate (BEACON_500 item 3).
--
-- One row per (tenant, page, day, source) of dollar value. Two producer classes:
--   * source='unit_economics' - the operator's rate (ad RPM or dollars per lead)
--     applied to REAL measured GA4 traffic. basis text says so plainly
--     ("your rate x real traffic"); this is NEVER presented as a measured payout.
--   * source='ad_network' / 'affiliate' - a real report from a money source
--     (AdSense/Mediavine/affiliate). Ships dark until the operator connects
--     credentials; when rows exist, basis='measured'.
--   * source='operator_manual' - a number the operator typed in by hand.
--
-- Scoreboards and verdict surfaces READ this table instead of CPC proxies.
-- Additive + idempotent. RLS mirrors the peer tables (deny anon; authenticated
-- via is_tenant_member; the service-role client bypasses RLS).

CREATE TABLE IF NOT EXISTS public.revenue_facts (
  tenant_id   text        NOT NULL,
  page_path   text        NOT NULL,
  day         date        NOT NULL,
  source      text        NOT NULL CHECK (source IN ('ad_network','unit_economics','affiliate','operator_manual')),
  revenue_usd numeric     NOT NULL,
  basis       text        NOT NULL,
  metadata    jsonb       NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, page_path, day, source)
);

CREATE INDEX IF NOT EXISTS revenue_facts_tenant_day_idx
  ON public.revenue_facts (tenant_id, day);

ALTER TABLE public.revenue_facts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS deny_anon ON public.revenue_facts;
CREATE POLICY deny_anon ON public.revenue_facts AS PERMISSIVE FOR ALL TO anon USING (false) WITH CHECK (false);
DROP POLICY IF EXISTS tenant_authenticated_rw ON public.revenue_facts;
CREATE POLICY tenant_authenticated_rw ON public.revenue_facts AS PERMISSIVE FOR ALL TO authenticated
  USING (is_tenant_member(tenant_id)) WITH CHECK (is_tenant_member(tenant_id));
