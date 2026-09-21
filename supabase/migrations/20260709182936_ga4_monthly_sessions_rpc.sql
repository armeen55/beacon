-- Operator spec 2026-07-09 A-3 (north star): monthly sitewide GA4 sessions per tenant.
-- Mirrors gsc_page_totals_v1: sql STABLE, pinned search_path, service_role-only EXECUTE.
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
grant execute on function public.ga4_monthly_sessions_v1(text, date) to service_role;;
