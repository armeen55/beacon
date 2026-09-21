-- Per-query two-window aggregate over gsc_daily_rows, with the top-earning page per window.
-- The demand-unit builder reads this instead of pulling sixteen months of raw rows into memory.
create or replace function public.gsc_unit_history(
  p_tenant_id text, p_early_from date, p_early_to date, p_recent_from date, p_limit int default 2000
) returns table(
  query text, early_clicks bigint, early_impressions bigint, early_position numeric,
  recent_clicks bigint, recent_impressions bigint, recent_position numeric,
  early_top_page text, recent_top_page text
) language sql stable as $$
with rows as (
  select r.query, r.page, r.date, r.clicks, r.impressions, r.position
  from public.gsc_daily_rows r where r.tenant_id = p_tenant_id
),
early as (
  select rows.query, sum(rows.clicks) c, sum(rows.impressions) i,
         case when sum(rows.impressions) > 0 then sum(rows.position * rows.impressions) / sum(rows.impressions) end p
  from rows where rows.date >= p_early_from and rows.date < p_early_to group by rows.query
),
recent as (
  select rows.query, sum(rows.clicks) c, sum(rows.impressions) i,
         case when sum(rows.impressions) > 0 then sum(rows.position * rows.impressions) / sum(rows.impressions) end p
  from rows where rows.date >= p_recent_from group by rows.query
),
early_pages as (
  select distinct on (t.query) t.query, t.page
  from (select rows.query, rows.page, sum(rows.clicks) c, sum(rows.impressions) i from rows
        where rows.date >= p_early_from and rows.date < p_early_to group by rows.query, rows.page) t
  order by t.query, t.c desc, t.i desc
),
recent_pages as (
  select distinct on (t.query) t.query, t.page
  from (select rows.query, rows.page, sum(rows.clicks) c, sum(rows.impressions) i from rows
        where rows.date >= p_recent_from group by rows.query, rows.page) t
  order by t.query, t.c desc, t.i desc
)
select coalesce(e.query, r.query) as query,
       coalesce(e.c, 0)::bigint, coalesce(e.i, 0)::bigint, e.p,
       coalesce(r.c, 0)::bigint, coalesce(r.i, 0)::bigint, r.p,
       ep.page, rp.page
from early e
full join recent r on e.query = r.query
left join early_pages ep on ep.query = coalesce(e.query, r.query)
left join recent_pages rp on rp.query = coalesce(e.query, r.query)
order by coalesce(e.c, 0) desc
limit p_limit;
$$;;
