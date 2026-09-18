-- 2026-09-17: restore the monthly rollup the 2026-09-15 drop took by mistake. gsc_monthly_archive and refresh_gsc_month
-- were named by no source STRING, but gsc_unit_history (the one history read behind every demand-recovery finding)
-- selects from the table, and the GSC sync and deep backfill call refresh_gsc_month after every pull. Since the drop,
-- every drive logged "history read failed; units carry none" and read no collapse at all. A direct read over the
-- 1.27M daily rows measured 12.2 seconds per drive; the rollup answers the same question in 0.6. Applied to production
-- through the Supabase MCP on 2026-09-17 and backfilled for every month on file (2025-04 to 2026-09, both accounts).
CREATE TABLE IF NOT EXISTS public.gsc_monthly_archive (
  tenant_id text NOT NULL,
  month date NOT NULL,
  query text NOT NULL,
  clicks bigint NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  position double precision,
  top_page text,
  top_page_share double precision,
  top_page_position double precision,
  refreshed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, month, query)
);
CREATE INDEX IF NOT EXISTS gsc_monthly_archive_tenant_month_clicks_idx ON public.gsc_monthly_archive (tenant_id, month, clicks DESC);
ALTER TABLE public.gsc_monthly_archive ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.gsc_monthly_archive FROM anon, authenticated;
GRANT ALL ON public.gsc_monthly_archive TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_gsc_month(p_tenant_id text, p_month date)
RETURNS void LANGUAGE plpgsql VOLATILE AS $function$
DECLARE v_start date := date_trunc('month', p_month)::date; v_stop date := (date_trunc('month', p_month) + interval '1 month')::date;
BEGIN
  DELETE FROM public.gsc_monthly_archive a WHERE a.tenant_id = p_tenant_id AND a.month = v_start;
  INSERT INTO public.gsc_monthly_archive (tenant_id, month, query, clicks, impressions, position, top_page, top_page_share, top_page_position, refreshed_at)
  WITH q AS (
    SELECT d.query, sum(d.clicks)::bigint clicks, sum(d.impressions)::bigint impressions,
           CASE WHEN sum(d.impressions) > 0 THEN sum(d.position * d.impressions) / sum(d.impressions) END position
    FROM public.gsc_daily_rows d WHERE d.tenant_id = p_tenant_id AND d.date >= v_start AND d.date < v_stop GROUP BY d.query),
  p AS (
    SELECT d.query, d.page, sum(d.clicks)::bigint clicks, sum(d.impressions)::bigint impressions,
           CASE WHEN sum(d.impressions) > 0 THEN sum(d.position * d.impressions) / sum(d.impressions) END position
    FROM public.gsc_daily_rows d WHERE d.tenant_id = p_tenant_id AND d.date >= v_start AND d.date < v_stop GROUP BY d.query, d.page),
  top AS (SELECT DISTINCT ON (p.query) p.query, p.page, p.impressions, p.position FROM p ORDER BY p.query, p.clicks DESC, p.impressions DESC)
  SELECT p_tenant_id, v_start, q.query, q.clicks, q.impressions, q.position, t.page,
         CASE WHEN q.impressions > 0 THEN t.impressions::double precision / q.impressions END, t.position, now()
  FROM q LEFT JOIN top t ON t.query = q.query;
END $function$;
-- gsc_unit_history (the read the demand-unit loader calls, live on production and never recorded in this folder) selects from this table and stands unchanged.
-- One-time backfill, run by hand:
-- select public.refresh_gsc_month(t.tenant_id, m::date) from (select distinct tenant_id from gsc_daily_rows) t, generate_series('2025-04-01'::date, '2026-09-01'::date, interval '1 month') m;
NOTIFY pgrst, 'reload schema';
