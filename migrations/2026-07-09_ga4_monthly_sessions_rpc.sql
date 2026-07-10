-- =====================================================================================
-- P0-A INVALID-FOR-SITEWIDE (2026-07-10). DO NOT REUSE THIS RPC AS A SITEWIDE TOTAL.
-- This function returns coalesce(sum(sessions)) grouped by month FROM ga4_url_traffic,
-- which is grained by (url, date). GA4 sessions are NOT additive across page paths - one
-- visit that touches several pages appears in several rows - so this monthly total is
-- materially inflated and was showing a FALSE sitewide monthly-visits number on the
-- product (e.g. "June: 12,862 visits"). The app no longer calls this RPC; the monthly
-- north star (src/domains/north-star/*) now shows an honest reconciliation state plus
-- proven Search Console clicks. Wave 2 must build a property-grain GA4 rollup (a real
-- sitewide sessions total from GA4's own aggregation) to REPLACE this, not reuse it.
-- =====================================================================================
--
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
