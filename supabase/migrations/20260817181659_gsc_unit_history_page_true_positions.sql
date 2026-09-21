drop function if exists public.gsc_unit_history(text, date, date, date, integer);
create function public.gsc_unit_history(p_tenant_id text, p_early_from date, p_early_to date, p_recent_from date, p_limit integer default 2000)
returns table(query text, early_clicks bigint, early_impressions bigint, early_position numeric,
              recent_clicks bigint, recent_impressions bigint, recent_position numeric,
              early_top_page text, recent_top_page text,
              early_page_position numeric, recent_page_position numeric,
              early_page_share numeric, recent_page_share numeric)
language sql stable as $function$
-- Computed off gsc_daily_rows because only the daily rows carry the page dimension. The blended per-query
-- position averages every page the site ranks with; a second owned page entering the results drags that
-- average and can manufacture an apparent ranking loss. The *_page_* columns are the CURRENT top page's own
-- position and impressions share per window, so a page-specific diagnosis reads that page's own history.
with r as (
  select d.query, d.page, d.clicks, d.impressions, d.position,
         case when d.date >= p_recent_from then 'recent'
              when d.date >= p_early_from and d.date < p_early_to then 'early' end as side
  from public.gsc_daily_rows d
  where d.tenant_id = p_tenant_id and d.date >= p_early_from
),
agg as (
  select r.query, r.side, sum(r.clicks)::bigint c, sum(r.impressions)::bigint i,
         case when sum(r.impressions) > 0 then sum(r.position * r.impressions) / sum(r.impressions) end p
  from r where r.side is not null group by r.query, r.side
),
pages as (
  select r.query, r.side, r.page, sum(r.clicks) c, sum(r.impressions) i,
         case when sum(r.impressions) > 0 then sum(r.position * r.impressions) / sum(r.impressions) end p
  from r where r.side is not null group by r.query, r.side, r.page
),
tops as (
  select distinct on (pages.query, pages.side) pages.query, pages.side, pages.page
  from pages order by pages.query, pages.side, pages.c desc, pages.i desc
)
select q.query,
       coalesce(e.c, 0), coalesce(e.i, 0), e.p,
       coalesce(rc.c, 0), coalesce(rc.i, 0), rc.p,
       te.page, tr.page,
       pe.p, pr.p,
       case when coalesce(e.i, 0) > 0 and pe.i is not null then pe.i::numeric / e.i end,
       case when coalesce(rc.i, 0) > 0 and pr.i is not null then pr.i::numeric / rc.i end
from (select distinct agg.query from agg) q
left join agg e  on e.query = q.query and e.side = 'early'
left join agg rc on rc.query = q.query and rc.side = 'recent'
left join tops te on te.query = q.query and te.side = 'early'
left join tops tr on tr.query = q.query and tr.side = 'recent'
left join pages pe on pe.query = q.query and pe.side = 'early'  and pe.page = tr.page
left join pages pr on pr.query = q.query and pr.side = 'recent' and pr.page = tr.page
order by coalesce(e.c, 0) desc
limit p_limit;
$function$;;
