create or replace function public.gsc_cannibalization_v1(
    p_tenant text, p_since date, p_min_impr int default 100
  )
  returns table(query text, url text, clicks bigint, impressions bigint, pos_weighted double precision)
  language sql stable set search_path to 'pg_catalog', 'public'
as $function$
  with per as (
    select query, page as url,
           coalesce(sum(clicks), 0)::bigint as clicks,
           coalesce(sum(impressions), 0)::bigint as impressions,
           coalesce(sum(position * impressions), 0)::double precision as pos_weighted
    from gsc_daily_rows
    where tenant_id = p_tenant and is_final = true and date >= p_since
      and query is not null and query <> ''
    group by query, page
  ),
  q as (
    select per.query from per group by per.query
    having count(*) >= 2 and sum(per.impressions) >= p_min_impr
  )
  select per.query, per.url, per.clicks, per.impressions, per.pos_weighted
  from per join q on q.query = per.query;
$function$;
revoke execute on function public.gsc_cannibalization_v1(text, date, int) from public, anon, authenticated;
grant execute on function public.gsc_cannibalization_v1(text, date, int) to service_role;;
