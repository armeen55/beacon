drop function if exists public.gsc_unit_history(text, date, date, date, integer);
create function public.gsc_unit_history(p_tenant_id text, p_early_from date, p_early_to date, p_recent_from date, p_limit integer default 2000)
returns table(query text, early_clicks bigint, early_impressions bigint, early_position numeric,
              recent_clicks bigint, recent_impressions bigint, recent_position numeric,
              early_top_page text, recent_top_page text,
              early_page_position numeric, recent_page_position numeric,
              early_page_share numeric, recent_page_share numeric)
language sql stable as $function$
-- THE CANDIDATES ARE CHOSEN BEFORE THE EXPENSIVE WORK, not after. The first version aggregated the page-true
-- position and share for all 71,000 of this account's queries and then kept the top 2,000, which spilled to
-- disk on every join and ran 8.5 seconds: past the API statement timeout, where the read fails silently and
-- every producer downstream sees an account with no history. Narrowing first is the same answer for a
-- fraction of the work, because the result was always ordered by early clicks and capped anyway.
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
         case when sum(rows.impressions) > 0 then sum(rows.position * rows.impressions) / sum(rows.impressions) end p
  from rows where rows.side is not null group by rows.query, rows.side
),
tops as (
  select distinct on (rows.query, rows.side) rows.query, rows.side, rows.top_page,
         regexp_replace(coalesce(rows.top_page, ''), '^https?://(www\.)?', '') as page_key
  from rows where rows.side is not null and rows.top_page is not null
  order by rows.query, rows.side, rows.clicks desc, rows.impressions desc
),
-- The current top page's OWN position and share, over exactly the window months that page led.
page_true as (
  select r.query, r.side,
         sum(r.top_page_position * r.impressions * coalesce(r.top_page_share, 0))
           filter (where r.top_page_position is not null)
           / nullif(sum(r.impressions * coalesce(r.top_page_share, 0)) filter (where r.top_page_position is not null), 0) as pos,
         sum(r.impressions * r.top_page_share) / nullif(sum(r.impressions), 0) as share
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
$function$;;
