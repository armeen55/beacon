-- THE COMPLETE PAGE-QUERY UNIVERSE for Decision. The signals RPC keeps the top 40 queries per page for the
-- surfaces, and Decision was judging ownership and corroboration on that slice: about a quarter of the
-- account's real page-query pairs. This returns the WHOLE 90-day aggregation as flat rows, strongest pairs
-- first so a bounded client read keeps the head honestly, paginated by the caller. Additive; invoker
-- semantics with service-role-only execution from birth, unlike the writer this program had to harden.
create or replace function gsc_query_universe_v1(p_tenant text, p_since date)
returns table(query text, page text, clicks bigint, impressions bigint, "position" double precision)
language sql
stable
as $$
  select query, page,
         sum(clicks)::bigint as clicks,
         sum(impressions)::bigint as impressions,
         case when sum(impressions) > 0 then sum(position * impressions) / sum(impressions) else 0 end as "position"
  from gsc_daily_rows
  where tenant_id = p_tenant and is_final = true and date >= p_since
  group by query, page
  order by sum(impressions) desc, query asc, page asc;
$$;

revoke all on function public.gsc_query_universe_v1(text, date) from public;
revoke all on function public.gsc_query_universe_v1(text, date) from anon;
revoke all on function public.gsc_query_universe_v1(text, date) from authenticated;
grant execute on function public.gsc_query_universe_v1(text, date) to service_role;
