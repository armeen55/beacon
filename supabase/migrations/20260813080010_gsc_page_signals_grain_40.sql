-- 2026-08-13: same function, one number: rn <= 40 (was 10). Decision was reasoning over ~59 percent
-- of impressions; this lifts the server grain to the reader cap. Additive replace, same signature.
create or replace function gsc_page_signals_v1(p_tenant text, p_since date)
returns table(
  page text,
  clicks bigint,
  impressions bigint,
  pos_weighted double precision,
  top_queries jsonb
)
language sql
stable
as $$
  with per_pq as (
    select
      page,
      query,
      sum(clicks)::bigint        as clicks,
      sum(impressions)::bigint   as impressions,
      sum(position * impressions)::double precision as pos_w
    from gsc_daily_rows
    where tenant_id = p_tenant
      and is_final = true
      and date >= p_since
    group by page, query
  ),
  ranked as (
    select page, query, clicks, impressions, pos_w,
           row_number() over (partition by page order by impressions desc, query asc) as rn
    from per_pq
  ),
  top as (
    select page,
           jsonb_agg(
             jsonb_build_object(
               'query', query,
               'clicks', clicks,
               'impressions', impressions,
               'position', case when impressions > 0 then pos_w / impressions else 0 end
             )
             order by impressions desc, query asc
           ) filter (where rn <= 40) as top_queries
    from ranked
    group by page
  ),
  per_page as (
    select page,
           sum(clicks)::bigint      as clicks,
           sum(impressions)::bigint as impressions,
           sum(pos_w)::double precision as pos_w
    from per_pq
    group by page
  )
  select pp.page, pp.clicks, pp.impressions, pp.pos_w as pos_weighted,
         coalesce(t.top_queries, '[]'::jsonb) as top_queries
  from per_page pp
  left join top t using (page);
$$;;
