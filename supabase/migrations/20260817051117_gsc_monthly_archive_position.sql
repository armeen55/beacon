-- The archive gains the impressions-weighted position, so a decline can be decomposed into ranking loss
-- versus snippet loss without touching the 1.2M daily rows.
alter table public.gsc_monthly_archive add column if not exists position numeric;

create or replace function public.refresh_gsc_month(p_tenant_id text, p_month date)
returns integer language sql volatile as $$
with agg as (
  select r.query, sum(r.clicks)::bigint clicks, sum(r.impressions)::bigint impressions,
         case when sum(r.impressions) > 0 then sum(r.position * r.impressions) / sum(r.impressions) end pos
  from public.gsc_daily_rows r
  where r.tenant_id = p_tenant_id and r.date >= date_trunc('month', p_month)::date
    and r.date < (date_trunc('month', p_month) + interval '1 month')::date
  group by r.query
),
tops as (
  select distinct on (t.query) t.query, t.page
  from (select r.query, r.page, sum(r.clicks) c, sum(r.impressions) i from public.gsc_daily_rows r
        where r.tenant_id = p_tenant_id and r.date >= date_trunc('month', p_month)::date
          and r.date < (date_trunc('month', p_month) + interval '1 month')::date
        group by r.query, r.page) t
  order by t.query, t.c desc, t.i desc
),
up as (
  insert into public.gsc_monthly_archive (tenant_id, query, month, impressions, clicks, top_page, position, updated_at)
  select p_tenant_id, a.query, date_trunc('month', p_month)::date, a.impressions, a.clicks, tp.page, a.pos, now()
  from agg a left join tops tp on tp.query = a.query
  on conflict (tenant_id, query, month)
  do update set impressions = excluded.impressions, clicks = excluded.clicks,
                top_page = excluded.top_page, position = excluded.position, updated_at = now()
  returning 1
)
select coalesce(count(*), 0)::integer from up;
$$;

create or replace function public.gsc_unit_history(
  p_tenant_id text, p_early_from date, p_early_to date, p_recent_from date, p_limit int default 2000
) returns table(
  query text, early_clicks bigint, early_impressions bigint, early_position numeric,
  recent_clicks bigint, recent_impressions bigint, recent_position numeric,
  early_top_page text, recent_top_page text
) language sql stable as $$
with rows as (
  select a.query, a.month, a.clicks, a.impressions, a.top_page, a.position
  from public.gsc_monthly_archive a where a.tenant_id = p_tenant_id
),
early as (
  select rows.query, sum(rows.clicks) c, sum(rows.impressions) i,
         case when sum(rows.impressions) > 0 then sum(rows.position * rows.impressions) / sum(rows.impressions) end p
  from rows
  where rows.month >= date_trunc('month', p_early_from)::date and rows.month < date_trunc('month', p_early_to)::date
  group by rows.query
),
recent as (
  select rows.query, sum(rows.clicks) c, sum(rows.impressions) i,
         case when sum(rows.impressions) > 0 then sum(rows.position * rows.impressions) / sum(rows.impressions) end p
  from rows where rows.month >= date_trunc('month', p_recent_from)::date group by rows.query
),
early_pages as (
  select distinct on (rows.query) rows.query, rows.top_page from rows
  where rows.month >= date_trunc('month', p_early_from)::date and rows.month < date_trunc('month', p_early_to)::date
    and rows.top_page is not null
  order by rows.query, rows.clicks desc, rows.impressions desc
),
recent_pages as (
  select distinct on (rows.query) rows.query, rows.top_page from rows
  where rows.month >= date_trunc('month', p_recent_from)::date and rows.top_page is not null
  order by rows.query, rows.clicks desc, rows.impressions desc
)
select coalesce(e.query, r.query) as query,
       coalesce(e.c, 0)::bigint, coalesce(e.i, 0)::bigint, e.p,
       coalesce(r.c, 0)::bigint, coalesce(r.i, 0)::bigint, r.p,
       ep.top_page, rp.top_page
from early e
full join recent r on e.query = r.query
left join early_pages ep on ep.query = coalesce(e.query, r.query)
left join recent_pages rp on rp.query = coalesce(e.query, r.query)
order by coalesce(e.c, 0) desc
limit p_limit;
$$;;
