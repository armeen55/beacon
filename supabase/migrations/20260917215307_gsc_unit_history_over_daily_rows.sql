-- THE HISTORY READ STANDS ON THE DAILY ROWS THEMSELVES. The monthly archive it used to roll up was dropped with the
-- legacy tables on 2026-09-15 and every demand-recovery reading since has come back empty ("history read failed; units
-- carry none", every drive). Same signature, same columns, exact date windows instead of month rounding, and the
-- candidates are still chosen before the expensive work (top p_limit queries by early clicks) so the join never spills.
CREATE OR REPLACE FUNCTION public.gsc_unit_history(p_tenant_id text, p_early_from date, p_early_to date, p_recent_from date, p_limit integer DEFAULT 2000)
 RETURNS TABLE(query text, early_clicks bigint, early_impressions bigint, early_position numeric, recent_clicks bigint, recent_impressions bigint, recent_position numeric, early_top_page text, recent_top_page text, early_page_position numeric, recent_page_position numeric, early_page_share numeric, recent_page_share numeric)
 LANGUAGE sql
 STABLE
AS $function$
with candidates as (
  select d.query, sum(d.clicks)::bigint c
  from public.gsc_daily_rows d
  where d.tenant_id = p_tenant_id and d.date >= p_early_from and d.date < p_early_to
  group by d.query
  order by sum(d.clicks) desc
  limit p_limit
),
rows as (
  select d.query, d.page, d.clicks, d.impressions, d.position,
         case when d.date >= p_recent_from then 'recent'
              when d.date >= p_early_from and d.date < p_early_to then 'early' end side
  from public.gsc_daily_rows d
  join candidates c on c.query = d.query
  where d.tenant_id = p_tenant_id and d.date >= p_early_from
),
agg as (
  select rows.query, rows.side, sum(rows.clicks)::bigint c, sum(rows.impressions)::bigint i,
         case when sum(rows.impressions) > 0 then (sum(rows.position * rows.impressions) / sum(rows.impressions))::numeric end p
  from rows where rows.side is not null group by rows.query, rows.side
),
pages as (
  select rows.query, rows.side, rows.page, sum(rows.clicks)::bigint c, sum(rows.impressions)::bigint i,
         case when sum(rows.impressions) > 0 then (sum(rows.position * rows.impressions) / sum(rows.impressions))::numeric end p,
         regexp_replace(coalesce(rows.page, ''), '^https?://(www\.)?', '') as page_key
  from rows where rows.side is not null group by rows.query, rows.side, rows.page
),
tops as (
  select distinct on (pages.query, pages.side) pages.query, pages.side, pages.page as top_page, pages.page_key
  from pages order by pages.query, pages.side, pages.c desc, pages.i desc
),
-- The current top page's OWN position and share on each side, so a page that lost the query to a sibling reads as a loss.
page_true as (
  select p.query, p.side, p.p as pos, (p.i::numeric / nullif(a.i, 0)) as share
  from pages p
  join tops tr on tr.query = p.query and tr.side = 'recent' and tr.page_key = p.page_key
  join agg a on a.query = p.query and a.side = p.side
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
