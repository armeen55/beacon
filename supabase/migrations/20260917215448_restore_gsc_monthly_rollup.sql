-- THE MONTHLY ROLLUP THE HISTORY READ STANDS ON, restored. It was dropped with the legacy tables on 2026-09-15 while
-- gsc_unit_history and the sync's refresh_gsc_month call still depended on it, and a direct read over 1.27M daily
-- rows runs 12 seconds per drive. One row per tenant, month and query; refreshed for the current and previous month
-- by every sync, exactly as the sync already asks.
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

CREATE OR REPLACE FUNCTION public.gsc_unit_history(p_tenant_id text, p_early_from date, p_early_to date, p_recent_from date, p_limit integer DEFAULT 2000)
 RETURNS TABLE(query text, early_clicks bigint, early_impressions bigint, early_position numeric, recent_clicks bigint, recent_impressions bigint, recent_position numeric, early_top_page text, recent_top_page text, early_page_position numeric, recent_page_position numeric, early_page_share numeric, recent_page_share numeric)
 LANGUAGE sql
 STABLE
AS $function$
-- THE CANDIDATES ARE CHOSEN BEFORE THE EXPENSIVE WORK, not after: the result was always ordered by early clicks and capped.
with candidates as (
  select a.query, sum(a.clicks)::bigint c
  from public.gsc_monthly_archive a
  where a.tenant_id = p_tenant_id
    and a.month >= date_trunc('month', p_early_from)::date and a.month < date_trunc('month', p_early_to)::date
  group by a.query
  order by sum(a.clicks) desc
  limit p_limit
),
rows as (
  select a.query, a.clicks, a.impressions, a.position, a.top_page, a.top_page_share, a.top_page_position,
         case when a.month >= date_trunc('month', p_recent_from)::date then 'recent'
              when a.month >= date_trunc('month', p_early_from)::date and a.month < date_trunc('month', p_early_to)::date then 'early' end side
  from public.gsc_monthly_archive a
  join candidates c on c.query = a.query
  where a.tenant_id = p_tenant_id
),
agg as (
  select rows.query, rows.side, sum(rows.clicks)::bigint c, sum(rows.impressions)::bigint i,
         case when sum(rows.impressions) > 0 then (sum(rows.position * rows.impressions) / sum(rows.impressions))::numeric end p
  from rows where rows.side is not null group by rows.query, rows.side
),
tops as (
  select distinct on (rows.query, rows.side) rows.query, rows.side, rows.top_page,
         regexp_replace(coalesce(rows.top_page, ''), '^https?://(www\.)?', '') as page_key
  from rows where rows.side is not null and rows.top_page is not null
  order by rows.query, rows.side, rows.clicks desc, rows.impressions desc
),
page_true as (
  select r.query, r.side,
         (sum(r.top_page_position * r.impressions * coalesce(r.top_page_share, 0))
           filter (where r.top_page_position is not null)
           / nullif(sum(r.impressions * coalesce(r.top_page_share, 0)) filter (where r.top_page_position is not null), 0))::numeric as pos,
         (sum(r.impressions * r.top_page_share) / nullif(sum(r.impressions), 0))::numeric as share
  from (select rows.*, regexp_replace(coalesce(rows.top_page, ''), '^https?://(www\.)?', '') as page_key
        from rows where rows.side is not null) r
  join tops tr on tr.query = r.query and tr.side = 'recent' and tr.page_key = r.page_key
  group by r.query, r.side
)
select q.query, coalesce(e.c,0), coalesce(e.i,0), e.p, coalesce(rc.c,0), coalesce(rc.i,0), rc.p,
       te.top_page, tr.top_page, pe.pos, pr.pos, pe.share, pr.share
from candidates q
left join agg e on e.query = q.query and e.side='early'
left join agg rc on rc.query = q.query and rc.side='recent'
left join tops te on te.query = q.query and te.side='early'
left join tops tr on tr.query = q.query and tr.side='recent'
left join page_true pe on pe.query = q.query and pe.side='early'
left join page_true pr on pr.query = q.query and pr.side='recent'
order by q.c desc;
$function$;
NOTIFY pgrst, 'reload schema';;
