-- Operator spec 2026-07-09 A-3 (the north star): Beacon's revival goal is measured in
-- MONTHLY VISITORS ("weekly won't cut it" - peak 20k/mo, goal back into the 10s), but no
-- sitewide GA4 rollup exists; ga4_url_traffic is per (url, date) and ~55k rows/90d for
-- Iranopedia, far too heavy to sum in app code on a page render.
--
-- ONE server-side GROUP BY: monthly sitewide sessions per tenant. Mirrors the proven
-- gsc_page_totals_v1 contract: LANGUAGE sql STABLE, search_path pinned, EXECUTE revoked
-- from public/anon/authenticated and granted to service_role only (the app calls it via
-- the admin client with an explicit p_tenant filter).
--
-- Additive + reversible (DROP FUNCTION); touches no data.

create or replace function public.ga4_monthly_sessions_v1(p_tenant text, p_since date)
  returns table(
    month date,
    sessions bigint,
    engaged_sessions bigint
  )
  language sql
  stable
  set search_path to 'pg_catalog', 'public'
as $function$
  select date_trunc('month', date)::date            as month,
         coalesce(sum(sessions), 0)::bigint          as sessions,
         coalesce(sum(engaged_sessions), 0)::bigint  as engaged_sessions
  from ga4_url_traffic
  where tenant_id = p_tenant
    and date >= p_since
  group by 1
  order by 1
$function$;

revoke execute on function public.ga4_monthly_sessions_v1(text, date) from public;
revoke execute on function public.ga4_monthly_sessions_v1(text, date) from anon;
revoke execute on function public.ga4_monthly_sessions_v1(text, date) from authenticated;
grant execute on function public.ga4_monthly_sessions_v1(text, date) to service_role;
