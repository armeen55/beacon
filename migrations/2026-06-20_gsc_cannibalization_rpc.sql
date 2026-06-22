-- 2026-06-20: GSC-native cannibalization aggregate RPC.
--
-- WHY: Beacon detects keyword cannibalization only off SEMrush (empty for
-- most tenants), while GSC's query x page data already shows it directly:
-- queries where 2+ of the tenant's own URLs co-rank split clicks and confuse
-- the engine about the canonical page. This needs ZERO third-party data.
--
-- Returns, per query where >= 2 owned URLs co-rank with combined impressions
-- >= p_min_impr, the per-URL rollup (clicks, impressions, impressions-weighted
-- position). The app groups these into cannibalization cases (preferred =
-- best position, cannibals = the rest) and emits a consolidate/internal-link
-- directive. Server-side GROUP BY so the 80k-row client cap can never truncate.
--
-- Mirrors the gsc_page_signals_v1 / gsc_page_totals_v1 contract exactly:
-- LANGUAGE sql STABLE, search_path pinned, SECURITY INVOKER (app calls via
-- service_role with an explicit p_tenant filter), EXECUTE revoked from
-- public/anon/authenticated and granted to service_role only. pos_weighted =
-- Sum(position*impressions); the caller divides by impressions, same as the
-- other GSC RPCs. Additive + reversible (DROP FUNCTION); touches no data.

create or replace function public.gsc_cannibalization_v1(
    p_tenant text,
    p_since date,
    p_min_impr int default 100
  )
  returns table(
    query text,
    url text,
    clicks bigint,
    impressions bigint,
    pos_weighted double precision
  )
  language sql
  stable
  set search_path to 'pg_catalog', 'public'
as $function$
  with per as (
    select query,
           page as url,
           coalesce(sum(clicks), 0)::bigint                          as clicks,
           coalesce(sum(impressions), 0)::bigint                     as impressions,
           coalesce(sum(position * impressions), 0)::double precision as pos_weighted
    from gsc_daily_rows
    where tenant_id = p_tenant
      and is_final = true
      and date >= p_since
      and query is not null
      and query <> ''
      -- Search-operator queries (site:/inurl:/etc.) make Google list the whole
      -- site sequentially #1,#2,#3… which looks like every page competing for
      -- one query. That is the operator browsing their own site, NOT
      -- cannibalization. Exclude so they never produce a bogus case. The app
      -- loader mirrors this filter (groupCannibalizationRows) for defense.
      and query !~* '^\s*(site|inurl|intitle|allintitle|allinurl|cache|related|link|filetype|ext)\s*:'
    group by query, page
  ),
  q as (
    select per.query
    from per
    group by per.query
    having count(*) >= 2
       and sum(per.impressions) >= p_min_impr
  )
  select per.query, per.url, per.clicks, per.impressions, per.pos_weighted
  from per
  join q on q.query = per.query;
$function$;

revoke execute on function public.gsc_cannibalization_v1(text, date, int)
  from public, anon, authenticated;
grant execute on function public.gsc_cannibalization_v1(text, date, int)
  to service_role;
