alter table public.gsc_monthly_archive
  add column if not exists top_page_share numeric,
  add column if not exists top_page_position numeric;

create or replace function public.refresh_gsc_month(p_tenant_id text, p_month date) returns integer language sql as $function$
with agg as (
  select r.query, sum(r.clicks)::bigint clicks, sum(r.impressions)::bigint impressions,
         case when sum(r.impressions) > 0 then sum(r.position * r.impressions) / sum(r.impressions) end pos
  from public.gsc_daily_rows r
  where r.tenant_id = p_tenant_id and r.date >= date_trunc('month', p_month)::date
    and r.date < (date_trunc('month', p_month) + interval '1 month')::date
  group by r.query
),
pages as (
  select r.query, r.page, sum(r.clicks) c, sum(r.impressions) i,
         case when sum(r.impressions) > 0 then sum(r.position * r.impressions) / sum(r.impressions) end p
  from public.gsc_daily_rows r
  where r.tenant_id = p_tenant_id and r.date >= date_trunc('month', p_month)::date
    and r.date < (date_trunc('month', p_month) + interval '1 month')::date
  group by r.query, r.page
),
tops as (
  select distinct on (pages.query) pages.query, pages.page, pages.p as top_pos,
         case when a.impressions > 0 then least(pages.i::numeric / a.impressions, 1) end as top_share
  from pages join agg a on a.query = pages.query
  order by pages.query, pages.c desc, pages.i desc
),
up as (
  insert into public.gsc_monthly_archive (tenant_id, query, month, impressions, clicks, top_page, position, top_page_share, top_page_position, updated_at)
  select p_tenant_id, a.query, date_trunc('month', p_month)::date, a.impressions, a.clicks, tp.page, a.pos, tp.top_share, tp.top_pos, now()
  from agg a left join tops tp on tp.query = a.query
  on conflict (tenant_id, query, month)
  do update set impressions = excluded.impressions, clicks = excluded.clicks,
                top_page = excluded.top_page, position = excluded.position,
                top_page_share = excluded.top_page_share, top_page_position = excluded.top_page_position, updated_at = now()
  returning 1
)
select coalesce(count(*), 0)::integer from up;
$function$;

drop function if exists public.gsc_unit_history(text, date, date, date, integer);
create function public.gsc_unit_history(p_tenant_id text, p_early_from date, p_early_to date, p_recent_from date, p_limit integer default 2000)
returns table(query text, early_clicks bigint, early_impressions bigint, early_position numeric,
              recent_clicks bigint, recent_impressions bigint, recent_position numeric,
              early_top_page text, recent_top_page text,
              early_page_position numeric, recent_page_position numeric,
              early_page_share numeric, recent_page_share numeric)
language sql stable as $function$
-- Reads ONLY the monthly archive, which refresh_gsc_month precomputes per month, so the read stays under
-- the API statement timeout that killed the daily-row version silently (every unit then carried no history
-- and the recovery producer minted nothing). The *_page_* columns are the CURRENT top page's own position
-- and impressions share, aggregated over exactly the window months that page led; months another page led
-- contribute nothing to them, and a leadership change across windows is the swap the reader already refuses.
with rows as (
  select a.query, a.clicks, a.impressions, a.position, a.top_page, a.top_page_share, a.top_page_position,
         case when a.month >= date_trunc('month', p_recent_from)::date then 'recent'
              when a.month >= date_trunc('month', p_early_from)::date and a.month < date_trunc('month', p_early_to)::date then 'early' end side
  from public.gsc_monthly_archive a where a.tenant_id = p_tenant_id
),
agg as (
  select rows.query, rows.side, sum(rows.clicks)::bigint c, sum(rows.impressions)::bigint i,
         case when sum(rows.impressions) > 0 then sum(rows.position * rows.impressions) / sum(rows.impressions) end p
  from rows where rows.side is not null group by rows.query, rows.side
),
tops as (
  select distinct on (rows.query, rows.side) rows.query, rows.side, rows.top_page
  from rows where rows.side is not null and rows.top_page is not null
  order by rows.query, rows.side, rows.clicks desc, rows.impressions desc
),
page_true as (
  select rows.query, rows.side,
         sum(rows.top_page_position * rows.impressions * coalesce(rows.top_page_share, 0))
           filter (where rows.top_page_position is not null)
           / nullif(sum(rows.impressions * coalesce(rows.top_page_share, 0))
           filter (where rows.top_page_position is not null), 0) as pos,
         sum(rows.impressions * rows.top_page_share) / nullif(sum(rows.impressions), 0) as share
  from rows join tops tr on tr.query = rows.query and tr.side = 'recent'
  where rows.side is not null
    and regexp_replace(coalesce(rows.top_page,''), '^https?://(www\.)?', '') = regexp_replace(coalesce(tr.top_page,''), '^https?://(www\.)?', '')
  group by rows.query, rows.side
)
select q.query, coalesce(e.c,0), coalesce(e.i,0), e.p, coalesce(rc.c,0), coalesce(rc.i,0), rc.p,
       te.top_page, tr.top_page, pe.pos, pr.pos, pe.share, pr.share
from (select distinct agg.query from agg) q
left join agg e on e.query = q.query and e.side='early'
left join agg rc on rc.query = q.query and rc.side='recent'
left join tops te on te.query = q.query and te.side='early'
left join tops tr on tr.query = q.query and tr.side='recent'
left join page_true pe on pe.query = q.query and pe.side='early'
left join page_true pr on pr.query = q.query and pr.side='recent'
order by coalesce(e.c,0) desc limit p_limit;
$function$;;
